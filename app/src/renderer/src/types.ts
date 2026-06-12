// The unified contract the renderer binds to: tapeflow.analysis/1 (see AGENTS.md). The sidecar
// produces this by normalising whichever engine ran; the UI never sees engine-specific shapes.

export type DamageKind = 'dirty' | 'missing'

export interface DamageSpot {
  id: string
  kind: DamageKind // dirty = covered but every copy damaged (improvable); missing = no copy at all
  axis: [number, number] // opaque per-engine tape coordinate; for layout only - label with tc/rec
  tcStart: string | null
  tcEnd: string | null
  recStart: string | null
  recEnd: string | null
  durationFrames: number
  coverage: string[] // capture tags with some frame here; [] => nothing to improve on
  copies: number
  severity: string
  // precise damaged sub-spans within this spot (for the map); the spot extent (tcStart/tcEnd) is
  // the coalesced re-capture cue. Empty for `missing` gaps (drawn by axis).
  runs: CaptureDamage[]
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
  // where THIS capture is itself damaged (regardless of whether another copy is clean there)
  damage: CaptureDamage[]
  // the TC segments this capture actually holds — split at internal drops, so the lane shows real
  // gaps instead of one solid bar (a continuity break can drop content). axis = physical span (DV)
  ranges: { tcStart: string | null; tcEnd: string | null; axis?: [number, number] }[]
}

// one damaged run within a single capture, by tape TC (axis = its physical span, for axis layout)
export interface CaptureDamage {
  tcStart: string | null
  tcEnd: string | null
  severity?: string
  axis?: [number, number]
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
    // sampled (tape TC -> wall clock) curve so the ruler shows each position's true recording time
    // (the wall clock jumps at pauses / different-day footage). Empty -> fall back to linear.
    recAnchors?: { tc: string; rec: string }[]
    // multi-session tape (record-run tc restarts at a seam): laid out on the PHYSICAL axis instead
    // of tc. axisAnchors is the sampled (physical position -> tc, rec) curve for ruler labels; seams
    // are the physical positions of recording-session boundaries (drawn as markers).
    multiSession?: boolean
    axisAnchors?: { axis: number; tc: string; rec: string }[]
    seams?: number[]
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

export interface ToolInfo {
  present: boolean
  version: string | null
}

export interface Capabilities {
  version: string
  engines: Record<string, boolean>
  tools: Record<string, ToolInfo>
}

export interface Progress {
  phase: string
  done?: number
  total?: number
  file?: string
  cached?: boolean
  tool?: string
}

export interface WorkspaceCapture {
  file: string
  stem: string
  format: 'hdv' | 'dv'
  sizeBytes: number
  mtimeMs: number
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

export type ChecklistStatus = 'outstanding' | 'accepted' | 'covered'

export interface ChecklistEntry {
  key: string
  status: ChecklistStatus
  kind: DamageKind
  tcStart: string | null
  tcEnd: string | null
  recStart: string | null
  recEnd: string | null
  durationFrames: number
  updatedAt: string
}

export interface ChecklistState {
  schema: 'tapeflow.state/1'
  entries: Record<string, ChecklistEntry>
}
