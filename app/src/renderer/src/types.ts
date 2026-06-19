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

// Per-capture DV error-concealment profile (mined from dvrescue's -x XML; absent for HDV). How
// heavily and by which STA method this transfer is concealed, the even/odd DIF-sequence (azimuth-
// head) split, the full method distribution, and the audio side.
export interface ErrorProfile {
  framesSeen: number // total frames in the capture
  framesConcealed: number // frames carrying any concealed video block
  concealedFrac: number // 0..1 TRUE rate over all frames (framesConcealed / framesSeen)
  avgConcealedPct: number // 0..1, mean concealed blocks/frame over concealed frames
  evenSharePct: number // 0..1, share of concealed blocks on even DIF sequences (azimuth split)
  staCode: number // dominant concealment method code
  staMethod: string
  staHistogram: { code: number; method: string; frac: number }[] // full method distribution
  audioFramesConcealed: number // frames carrying a concealed (0x8000) audio block
  audioConcealedFrac: number // 0..1 over all frames
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
  errorProfile?: ErrorProfile
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

export type ArchiveTier = 'green' | 'yellow' | 'red'

// The archive completeness marker (the "TF tag") for the merged master, computed by the sidecar so
// the GUI badge, the default export name, and the CLI/skill all agree by construction. Completeness =
// the share of tape frames with NO residual damage after the merge (floored: only a true 100.0%
// reads as 100). `-N` in the tag is the residual spot count (dirty + missing). See AGENTS.md.
export interface Archive {
  tag: string // filename marker: "(TF99%-3)" / "(TF100%)"
  short: string // bare badge form: "99%-3" / "100%"
  pct: number // floored clean-frame percentage
  tier: ArchiveTier // green only at a true 100 (zero residual), yellow >= 90, red below
  totalSpots: number
  dirtySpots: number
  missingSpots: number
  cleanFrames: number
  dirtyFrames: number
  missingFrames: number
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
  archive: Archive // the TF completeness marker; the badge + default export name read this
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
  files?: string[] // index-plan: the basenames this run will actually index (cached ones excluded)
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
  // demuxer timestamp discontinuities at byte-exact capture splices — not content damage; affects
  // only some players' seeking. Surfaced so a sound merge is explained rather than warned about.
  seamDiscontinuities: number | null
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
  dataUrl: string // a PNG (plain) or JPEG (dvplay highlighted) data: URL
  highlighted?: boolean // true when the DV error-concealment regions are drawn (dvplay)
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
