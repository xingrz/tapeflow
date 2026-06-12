import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, delimiter, extname, join, parse, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { Sidecar } from './sidecar'

let win: BrowserWindow | null = null
let sidecar: Sidecar | null = null

/** The PATH the user's login shell sees, or null. A macOS/Linux app launched from Finder/Dock
 *  inherits launchd's minimal PATH (no Homebrew/MacPorts), so the shell PATH is where ffmpeg /
 *  dvrescue actually live. Best-effort: a sentinel isolates PATH from any rc-file stdout noise,
 *  with a short timeout and a clean fall-through on failure. */
function loginShellPath(): string | null {
  if (process.platform === 'win32') return null
  try {
    const shellBin = process.env.SHELL || '/bin/zsh'
    const out = execFileSync(shellBin, ['-lic', "printf '<<<%s>>>' \"$PATH\""], {
      timeout: 3000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const m = out.match(/<<<([^>]*)>>>/)
    return m && m[1] ? m[1] : null
  } catch {
    return null
  }
}

/** PATH for the sidecar: the inherited PATH, plus the login-shell PATH, plus the well-known install
 *  dirs — so `which ffmpeg` / `which dvrescue` succeed in a packaged app even when launched from the
 *  Dock (where the inherited PATH is just /usr/bin:/bin:/usr/sbin:/sbin). De-duped, order preserved. */
function sidecarPath(): string {
  const seen = new Set<string>()
  const dirs: string[] = []
  const add = (p?: string | null): void => {
    for (const d of (p ?? '').split(delimiter)) {
      if (d && !seen.has(d)) {
        seen.add(d)
        dirs.push(d)
      }
    }
  }
  add(process.env.PATH)
  if (process.platform !== 'win32') {
    add(loginShellPath())
    ;['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/local/sbin',
      '/opt/local/bin', '/usr/bin', '/bin'].forEach(add)
    if (process.env.HOME) add(`${process.env.HOME}/.local/bin`)
  }
  return dirs.join(delimiter)
}

const HDV_EXTS = new Set(['.m2t', '.m2ts', '.mts', '.ts', '.tts', '.trp', '.tp', '.mpg', '.mpeg'])
const DV_EXTS = new Set(['.dv', '.dif'])

/** Repo root. In dev `app.getAppPath()` is the `app/` directory, so the root is its parent. */
function repoRoot(): string {
  return resolve(app.getAppPath(), '..')
}

function startSidecar(): void {
  // ffmpeg / dvrescue are external (resolved on PATH at runtime). A Dock-launched macOS app gets
  // launchd's minimal PATH, so enrich it with the login-shell + well-known dirs (see sidecarPath).
  const env = { ...process.env, PATH: sidecarPath() }
  if (app.isPackaged) {
    // Release: spawn the frozen sidecar binary bundled under resources/ (PyInstaller onedir with
    // the engines baked in), so end users need no Python.
    const exe = process.platform === 'win32' ? 'tapeflow-engine.exe' : 'tapeflow-engine'
    const bin = join(process.resourcesPath, 'tapeflow-engine', exe)
    sidecar = new Sidecar(bin, [], { env })
    return
  }
  // Dev: run the sidecar from source via the system Python; _bootstrap adds the engine submodules.
  const root = repoRoot()
  const python = process.env.TAPEFLOW_PYTHON || 'python3'
  sidecar = new Sidecar(python, ['-m', 'tapeflow_engine'], {
    cwd: root,
    env: { ...env, PYTHONPATH: join(root, 'engine', 'src') }
  })
}

function emptyState(): object {
  return { schema: 'tapeflow.state/1', entries: {} }
}

function stateFile(dir: string): string {
  return join(dir, '.tapeflow', 'state.json')
}

async function listCaptures(dir: string): Promise<object[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const captures: object[] = []
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.endsWith('.idx.jsonl')) continue
    const ext = extname(entry.name).toLowerCase()
    const format = HDV_EXTS.has(ext) ? 'hdv' : DV_EXTS.has(ext) ? 'dv' : null
    if (!format) continue
    const s = await stat(join(dir, entry.name))
    captures.push({
      file: entry.name,
      stem: parse(entry.name).name,
      format,
      sizeBytes: s.size,
      mtimeMs: s.mtimeMs
    })
  }
  return captures.sort((a, b) => {
    const am = Number((a as any).mtimeMs)
    const bm = Number((b as any).mtimeMs)
    return am - bm || String((a as any).file).localeCompare(String((b as any).file))
  })
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#0e1211',
    // Fuse the system chrome into our dark UI: macOS keeps inset traffic lights over the topbar;
    // Windows/Linux draw the native min/max/close as an overlay tinted to match the topbar.
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac
      ? {}
      : { titleBarOverlay: { color: '#0e1211', symbolColor: '#e6ebe8', height: 38 } }),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  startSidecar()

  const onProgress = (p: unknown) => win?.webContents.send('progress', p)

  ipcMain.handle('pickDir', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('pickSave', async (_e, defaultName?: string) => {
    const r = await dialog.showSaveDialog(win!, { defaultPath: defaultName })
    return r.canceled ? null : (r.filePath ?? null)
  })
  // Open the workspace folder in the OS file manager (Finder / Explorer / Files).
  ipcMain.handle('revealDir', (_e, dir: string) => shell.openPath(dir))
  ipcMain.handle('capabilities', () => sidecar!.call('capabilities'))
  ipcMain.handle('analyze', (_e, dir: string) => sidecar!.call('analyze', { dir }, onProgress))
  ipcMain.handle('build', (_e, dir: string, output: string) =>
    sidecar!.call('build', { dir, output }, onProgress)
  )
  ipcMain.handle('thumbnail', (_e, dir: string, file: string, seconds: number, maxWidth?: number) =>
    sidecar!.call('thumbnail', { dir, file, seconds, maxWidth })
  )
  ipcMain.handle('listCaptures', (_e, dir: string) => listCaptures(dir))
  // Drag-drop ingest: copy dropped capture files into the working dir (Node fs, in main), so the
  // renderer can then re-analyze. Returns the copied basenames.
  ipcMain.handle('ingest', async (_e, dir: string, srcPaths: string[]) => {
    const copied: string[] = []
    for (const src of srcPaths) {
      const name = basename(src)
      await copyFile(src, join(dir, name))
      copied.push(name)
    }
    return copied
  })
  ipcMain.handle('loadState', async (_e, dir: string) => {
    try {
      const raw = await readFile(stateFile(dir), 'utf8')
      const parsed = JSON.parse(raw)
      return parsed?.schema === 'tapeflow.state/1' ? parsed : emptyState()
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return emptyState()
      throw e
    }
  })
  ipcMain.handle('saveState', async (_e, dir: string, state: unknown) => {
    const path = stateFile(dir)
    await mkdir(join(dir, '.tapeflow'), { recursive: true })
    await writeFile(path, JSON.stringify(state, null, 2) + '\n', 'utf8')
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  sidecar?.dispose()
  if (process.platform !== 'darwin') app.quit()
})
