import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, parse, resolve } from 'node:path'
import { Sidecar } from './sidecar'

let win: BrowserWindow | null = null
let sidecar: Sidecar | null = null

const HDV_EXTS = new Set(['.m2t', '.m2ts', '.mts', '.ts', '.tts', '.trp', '.tp', '.mpg', '.mpeg'])
const DV_EXTS = new Set(['.dv', '.dif'])

/**
 * Repo root. In dev `app.getAppPath()` is the `app/` directory, so the root is its parent.
 * (Release will bundle a frozen sidecar binary instead of invoking Python - handled later.)
 */
function repoRoot(): string {
  return resolve(app.getAppPath(), '..')
}

function startSidecar(): void {
  const root = repoRoot()
  const python = process.env.TAPEFLOW_PYTHON || 'python3'
  sidecar = new Sidecar(python, ['-m', 'tapeflow_engine'], {
    cwd: root,
    env: { ...process.env, PYTHONPATH: join(root, 'engine', 'src') }
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
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
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
