/// <reference types="vite/client" />
import type { TapeAnalysis, Capabilities, BuildResult, Thumbnail } from './types'

declare global {
  interface Window {
    api: {
      pickDir: () => Promise<string | null>
      pickSave: (defaultName?: string) => Promise<string | null>
      capabilities: () => Promise<Capabilities>
      analyze: (dir: string) => Promise<TapeAnalysis>
      build: (dir: string, output: string) => Promise<BuildResult>
      thumbnail: (dir: string, file: string, seconds: number) => Promise<Thumbnail>
      // copy dropped capture files into the working dir; returns the copied basenames
      ingest: (dir: string, srcPaths: string[]) => Promise<string[]>
      onProgress: (cb: (p: unknown) => void) => () => void
    }
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}
