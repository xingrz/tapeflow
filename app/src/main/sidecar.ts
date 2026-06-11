import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'

type Pending = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  onProgress?: (p: unknown) => void
}

/**
 * A JSON-RPC 2.0 client over the Python sidecar's stdio (newline-delimited JSON).
 *
 * The sidecar handles one request at a time and streams `progress` notifications while a request
 * runs; since there is at most one in-flight call, progress is routed to every pending call (i.e.
 * the current one). Responses are matched by id.
 */
export class Sidecar {
  private proc: ChildProcess
  private rl: Interface
  private nextId = 1
  private pending = new Map<number, Pending>()

  constructor(command: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv }) {
    this.proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd: opts.cwd, env: opts.env })
    this.proc.stderr?.on('data', (d: Buffer) => console.error('[sidecar]', d.toString().trimEnd()))
    this.proc.on('exit', (code) => {
      const err = new Error(`sidecar exited (code ${code})`)
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
    })
    this.rl = createInterface({ input: this.proc.stdout! })
    this.rl.on('line', (line) => this.onLine(line))
  }

  private onLine(line: string): void {
    line = line.trim()
    if (!line) return
    let msg: any
    try {
      msg = JSON.parse(line)
    } catch {
      console.error('[sidecar] unparseable line:', line)
      return
    }
    if (msg.id == null && msg.method) {
      if (msg.method === 'progress') {
        for (const p of this.pending.values()) p.onProgress?.(msg.params)
      }
      return
    }
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error.message ?? 'rpc error'))
    else p.resolve(msg.result)
  }

  call<T = unknown>(method: string, params?: unknown, onProgress?: (p: unknown) => void): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress })
      this.proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }) + '\n')
    })
  }

  dispose(): void {
    this.rl.close()
    this.proc.kill()
  }
}
