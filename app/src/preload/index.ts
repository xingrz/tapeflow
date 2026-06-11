import { contextBridge, ipcRenderer } from 'electron'

// The only surface the renderer gets. It never touches the filesystem or the sidecar directly;
// main brokers everything. Mirrors window.api in src/renderer/src/env.d.ts.
contextBridge.exposeInMainWorld('api', {
  pickDir: () => ipcRenderer.invoke('pickDir'),
  pickSave: (defaultName?: string) => ipcRenderer.invoke('pickSave', defaultName),
  capabilities: () => ipcRenderer.invoke('capabilities'),
  analyze: (dir: string) => ipcRenderer.invoke('analyze', dir),
  build: (dir: string, output: string) => ipcRenderer.invoke('build', dir, output),
  thumbnail: (dir: string, file: string, seconds: number) =>
    ipcRenderer.invoke('thumbnail', dir, file, seconds),
  ingest: (dir: string, srcPaths: string[]) => ipcRenderer.invoke('ingest', dir, srcPaths),
  onProgress: (cb: (p: unknown) => void) => {
    const handler = (_e: unknown, p: unknown) => cb(p)
    ipcRenderer.on('progress', handler)
    return () => ipcRenderer.removeListener('progress', handler)
  }
})
