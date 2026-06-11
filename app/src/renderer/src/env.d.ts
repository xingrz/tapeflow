/// <reference types="vite/client" />
import type { TapeAnalysis, Capabilities } from './types'

declare global {
  interface Window {
    api: {
      pickDir: () => Promise<string | null>
      capabilities: () => Promise<Capabilities>
      analyze: (dir: string) => Promise<TapeAnalysis>
      onProgress: (cb: (p: unknown) => void) => () => void
    }
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}
