import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { copyFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { Sidecar } from './sidecar'

let win: BrowserWindow | null = null
let sidecar: Sidecar | null = null

/**
 * Repo root. In dev `app.getAppPath()` is the `app/` directory, so the root is its parent.
 * (Release will bundle a frozen sidecar binary instead of invoking Python — handled later.)
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

function createWindow(): void {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: { preload: join(__dirname, '../preload/index.mjs'), sandbox: false }
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
  ipcMain.handle('thumbnail', (_e, dir: string, file: string, seconds: number) =>
    sidecar!.call('thumbnail', { dir, file, seconds })
  )
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

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  sidecar?.dispose()
  if (process.platform !== 'darwin') app.quit()
})
