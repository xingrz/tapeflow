// The unified contract the renderer binds to: tapeflow.analysis/1 (see AGENTS.md). The sidecar
// produces this by normalising whichever engine ran; the UI never sees engine-specific shapes.

export type DamageKind = 'dirty' | 'missing'

export interface DamageSpot {
  id: string
  kind: DamageKind // dirty = covered but every copy damaged (improvable); missing = no copy at all
  axis: [number, number] // opaque per-engine tape coordinate; for layout only — label with tc/rec
  tcStart: string | null
  tcEnd: string | null
  recStart: string | null
  recEnd: string | null
  durationFrames: number
  coverage: string[] // capture tags with some frame here; [] => nothing to improve on
  copies: number
  severity: string
}

export interface HealthRun {
  from: number
  to: number
  state: string
}

export interface Capture {
  tag: string
  file: string
  axis: [number, number]
  tcSpan: [string | null, string | null]
  recSpan: [string | null, string | null]
  health: HealthRun[]
}

export interface Segment {
  tag: string
  axis: [number, number]
  tcSpan: [string | null, string | null]
  recSpan: [string | null, string | null]
  gapBefore: boolean
}

export interface TapeAnalysis {
  schema: string
  format: 'hdv' | 'dv'
  dir: string
  fps: number
  complete: boolean
  buildable: boolean
  tape: {
    tcStart: string | null
    tcEnd: string | null
    recStart: string | null
    recEnd: string | null
    durationFrames: number
    title: string
  }
  summary: {
    recaptureSpots: number
    missingFrames: number
    unusedCaptures: number
  }
  captures: Capture[]
  segments: Segment[]
  damage: DamageSpot[]
  divergences: unknown[]
}

export interface Capabilities {
  version: string
  engines: Record<string, boolean>
  tools: Record<string, boolean>
}

export interface Progress {
  phase: string
  done?: number
  total?: number
  file?: string
  cached?: boolean
  tool?: string
}

export interface BuildVerify {
  aux: boolean
  recHead: string | null
  tcHead: string | null
  recTail: string | null
  tcTail: string | null
  ccOk: boolean
  cc: number
  expectedCc: number
  tei: number
  expectedTei: number
  decodeErrors: number | null
  unexplainedDecode: number | null
  decodeGate: boolean | null
}

export interface BuildResult {
  output: string
  format: 'hdv' | 'dv'
  ok: boolean
  sizeBytes: number
  verify: BuildVerify | null // HDV self-check; null for DV (the merge is dvrescue's)
}

export interface Thumbnail {
  file: string
  seconds: number
  dataUrl: string // a PNG data: URL
}
