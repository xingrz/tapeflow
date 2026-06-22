import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  BuildResult,
  Capabilities,
  ChecklistState,
  DamageSpot,
  DecodeErrorSpot,
  Progress,
  TapeAnalysis,
  WorkspaceCapture
} from '../types'
import {
  currentSpotByKey,
  damageKey,
  emptyChecklist,
  entryFromSpot,
  reconcileChecklist,
  statusForSpot
} from '../utils/analysis'
import { formatDurationFrames, formatProgress } from '../utils/format'
import { tcToSeconds } from '../utils/timecode'
import { t } from '../i18n'

export interface DamageView {
  spot: DamageSpot
  key: string
  status: 'outstanding' | 'accepted' | 'covered'
}

export type CaptureIndexStatus = 'pending' | 'indexing' | 'indexed' | 'cached'

export interface WorkspaceCaptureView extends WorkspaceCapture {
  status: CaptureIndexStatus
  progress: number // 0..1 byte progress while this file is being indexed
}

// A file's stage in the preparation pipeline shown in the progress modal. A row appears only when
// real work begins — a dropped file being 'copying', or a non-cached file's byte-level 'indexing' —
// so pre-existing cache hits never get a row. DV indexing is one opaque dvrescue merge with no byte
// progress, so it shows as an indeterminate 'merging' step.
export type TaskStage = 'pending' | 'copying' | 'indexing' | 'merging' | 'done'

export interface TaskView {
  file: string
  stage: TaskStage
  progress: number // 0..1
  bytesPerSec: number // 0 when unknown
  etaSec: number | null // null when unknown / indeterminate
  determinate: boolean
}

export const useWorkflowStore = defineStore('workflow', () => {
  const caps = ref<Capabilities | null>(null)
  const dir = ref<string | null>(null)
  const analysis = ref<TapeAnalysis | null>(null)
  const checklist = ref<ChecklistState>(emptyChecklist())
  const progress = ref('')
  const error = ref('')
  const busy = ref(false)
  const building = ref(false)
  const buildProgress = ref<number | null>(null) // 0..1, or null = indeterminate (verifying)
  const buildResult = ref<BuildResult | null>(null)
  // WHERE the LAST export still decoded badly (HDV verify). Persisted in state.json and bound to the
  // export, NOT the analysis: it survives a re-analyse and is only rewritten by the next export (when
  // ffmpeg either still trips there or no longer does). The result-bar markers read from this.
  const decodeSpots = ref<DecodeErrorSpot[]>([])
  const selectedDamageKey = ref<string | null>(null)
  const ingestMessage = ref('')
  const workspaceCaptures = ref<WorkspaceCapture[]>([])
  const captureStatuses = ref<Record<string, CaptureIndexStatus>>({})
  const captureProgress = ref<Record<string, number>>({})

  // Preparation tasks (copy / index) shown in the blocking progress modal.
  const tasks = ref<Record<string, TaskView>>({})
  const taskOrder = ref<string[]>([])
  const taskModalOpen = ref(false)
  // HDV announces its batch size up front so the modal shows "done / total" instead of fragments
  // trickling in one row at a time. indexTotal = 0 means no batch to count (DV, or pre-analyse).
  const indexTotal = ref(0)
  const indexDone = ref(0) // counts every fragment that finished — cached hits too — so it reaches total
  const taskSamples: Record<string, { bytes: number; t: number; speed: number }> = {}
  // synthetic task-row key for the opaque DV merge step — DV runs as one dvrescue subprocess with
  // no per-file progress, so its row can't be keyed by a filename like HDV's are. A leading NUL
  // can't occur in a real filename, so the key never collides; written as the \u0000 escape (not
  // a raw NUL byte) so this source file stays plain text for git diff / grep.
  const DV_MERGE = '\u0000merge'
  let taskModalTimer: ReturnType<typeof setTimeout> | null = null
  let taskModalPending = false // armed for a delayed open; the debounce starts at the first real row

  let unsubscribeProgress: (() => void) | null = null
  let indexingFile: string | null = null // the file the byte-level 'indexing' events belong to
  // the fragments this run will actually index (from index-plan's pre-check); rows + the done-count
  // are limited to these, so cached files this round neither show nor inflate the total
  let indexPlanned = new Set<string>()

  const damageViews = computed<DamageView[]>(() => {
    if (!analysis.value) return []
    return analysis.value.damage.map((spot) => ({
      spot,
      key: damageKey(spot),
      status: statusForSpot(checklist.value, spot)
    }))
  })

  const outstandingDamage = computed(() =>
    damageViews.value.filter((view) => view.status !== 'accepted')
  )

  const acceptedDamage = computed(() => damageViews.value.filter((view) => view.status === 'accepted'))

  const missingDamage = computed(() =>
    outstandingDamage.value.filter((view) => view.spot.kind === 'missing')
  )

  const dirtyDamage = computed(() =>
    outstandingDamage.value.filter((view) => view.spot.kind === 'dirty')
  )

  const coveredEntries = computed(() =>
    Object.values(checklist.value.entries).filter((entry) => entry.status === 'covered')
  )

  const selectedDamage = computed(() => currentSpotByKey(analysis.value, selectedDamageKey.value))

  const canExport = computed(() => Boolean(analysis.value?.buildable && !busy.value))

  const verdictText = computed(() => {
    const a = analysis.value
    if (!a && dir.value && busy.value) return t('verdict.analysing')
    if (!a && dir.value) return t('verdict.selected')
    if (!a) return t('verdict.choosePrompt')
    if (a.complete) return t('verdict.complete')
    const spotCount = outstandingDamage.value.length
    const accepted = acceptedDamage.value.length
    const missingFrames = missingDamage.value.reduce((sum, view) => sum + view.spot.durationFrames, 0)
    const parts = [
      t('verdict.spots', spotCount),
      missingFrames
        ? t('verdict.missingEntirely', { dur: formatDurationFrames(missingFrames, a.fps) })
        : null,
      accepted ? t('verdict.accepted', { count: accepted }) : null,
      a.summary.unusedCaptures ? t('verdict.unplaced', { count: a.summary.unusedCaptures }) : null
    ].filter(Boolean)
    return parts.join(' | ')
  })

  const progressText = computed(() => (busy.value ? progress.value || 'Working' : ingestMessage.value))

  const captureViews = computed<WorkspaceCaptureView[]>(() =>
    workspaceCaptures.value.map((capture) => ({
      ...capture,
      status: captureStatuses.value[capture.file] ?? 'pending',
      progress: captureProgress.value[capture.file] ?? 0
    }))
  )

  const taskList = computed<TaskView[]>(() => taskOrder.value.map((k) => tasks.value[k]).filter(Boolean))

  // ---- progress modal tasks (copy + index), with speed / ETA from the byte stream ----
  // One row per file, keyed by the file itself, so a dropped file's row transitions copying ->
  // indexing -> done in place (one pipeline). The DV merge is one synthetic row (no per-file bytes).

  function upsertTask(file: string, view: TaskView): void {
    if (!taskOrder.value.includes(file)) taskOrder.value = [...taskOrder.value, file]
    tasks.value = { ...tasks.value, [file]: view }
    // First real-work row of a delayed-open run: start the debounce now (not at analyse start), so an
    // all-cached pass — which creates no rows — never opens the modal, even when align/plan is slow.
    if (taskModalPending && !taskModalOpen.value && !taskModalTimer) {
      taskModalTimer = setTimeout(() => {
        taskModalTimer = null
        taskModalPending = false
        taskModalOpen.value = true
      }, 250)
    }
  }

  function setTaskBytes(file: string, stage: TaskStage, done: number, total: number): void {
    const sampleKey = `${stage}:${file}`
    const now = performance.now()
    const prev = taskSamples[sampleKey]
    let speed = prev?.speed ?? 0
    if (prev && now > prev.t && done >= prev.bytes) {
      const inst = (done - prev.bytes) / ((now - prev.t) / 1000)
      speed = prev.speed > 0 ? prev.speed * 0.6 + inst * 0.4 : inst // smoothed
    }
    taskSamples[sampleKey] = { bytes: done, t: now, speed }
    const remaining = Math.max(0, total - done)
    upsertTask(file, {
      file,
      stage,
      progress: total > 0 ? Math.min(1, done / total) : 0,
      bytesPerSec: Math.max(0, speed),
      etaSec: speed > 1024 && remaining > 0 ? remaining / speed : null,
      determinate: total > 0
    })
  }

  function setTaskStage(file: string, stage: TaskStage): void {
    upsertTask(file, {
      file,
      stage,
      progress: stage === 'done' ? 1 : 0,
      bytesPerSec: 0,
      etaSec: null,
      determinate: stage === 'done'
    })
  }

  function updateTasks(p: Progress): void {
    if (p.phase === 'copying' && p.file) {
      setTaskBytes(p.file, 'copying', p.done ?? 0, p.total ?? 0)
    } else if (p.phase === 'indexing' && indexingFile && p.total) {
      // byte progress of the current file — moves its (pre-seeded) row from pending into indexing.
      setTaskBytes(indexingFile, 'indexing', p.done ?? 0, p.total)
    } else if (p.phase === 'indexed' && p.file) {
      const key = matchCapture(p.file)?.file ?? p.file
      // count and complete only the fragments this run planned to index; a cached file that did no
      // work isn't in the plan, so it neither counts nor shows. (the taskOrder check also completes
      // a dragged file's copy row, which lives outside the index plan.)
      if (indexPlanned.has(key)) indexDone.value += 1
      if (indexPlanned.has(key) || taskOrder.value.includes(key)) setTaskStage(key, 'done')
    } else if (p.phase === 'merging') {
      setTaskStage(DV_MERGE, 'merging')
    } else if (p.phase === 'index-plan') {
      // the to-index set (cached fragments already excluded), sent before the per-file rows: seed a
      // pending row for each so the whole list and the total show at once instead of trickling in.
      indexPlanned = new Set((p.files ?? []).map((f) => matchCapture(f)?.file ?? f))
      indexTotal.value = p.total ?? indexPlanned.size
      indexDone.value = 0
      for (const key of indexPlanned) setTaskStage(key, 'pending')
    }
  }

  function beginTaskModal(immediate: boolean): void {
    if (taskModalOpen.value || taskModalTimer || taskModalPending) {
      if (immediate && !taskModalOpen.value) {
        if (taskModalTimer) clearTimeout(taskModalTimer)
        taskModalTimer = null
        taskModalPending = false
        taskModalOpen.value = true
      }
      return // already managing this run; keep the accumulated tasks
    }
    tasks.value = {}
    taskOrder.value = []
    indexTotal.value = 0 // a fresh run; the count resets until HDV's index-plan arrives (DV sends none)
    indexDone.value = 0
    indexPlanned = new Set()
    for (const k of Object.keys(taskSamples)) delete taskSamples[k]
    if (immediate) {
      taskModalOpen.value = true
    } else {
      // Arm a delayed open, but don't start the timer here: the debounce begins when the first
      // real-work row appears (see upsertTask), so an all-cached pass with no rows never opens the
      // modal — even if align/plan is slow — and a quick single-file run finishes before it shows.
      taskModalPending = true
    }
  }

  function endTaskModal(): void {
    if (taskModalTimer) {
      clearTimeout(taskModalTimer)
      taskModalTimer = null
    }
    taskModalPending = false
    taskModalOpen.value = false
    tasks.value = {}
    taskOrder.value = []
    indexTotal.value = 0
    indexDone.value = 0
    indexPlanned = new Set()
  }

  async function init(): Promise<void> {
    if (!unsubscribeProgress) {
      unsubscribeProgress = window.api.onProgress((p) => {
        const pr = p as Progress
        const text = formatProgress(pr)
        if (text) progress.value = text
        if (pr.phase === 'building' || pr.phase === 'verifying') {
          buildProgress.value =
            pr.phase === 'verifying' || !pr.total ? null : Math.min(1, (pr.done ?? 0) / pr.total)
        } else {
          updateCaptureProgress(pr)
          updateTasks(pr)
        }
      })
    }
    try {
      caps.value = await window.api.capabilities()
    } catch (e) {
      error.value = toMessage(e)
    }
  }

  function dispose(): void {
    unsubscribeProgress?.()
    unsubscribeProgress = null
  }

  async function pickDir(): Promise<void> {
    if (busy.value) return
    const picked = await window.api.pickDir()
    if (!picked) return
    dir.value = picked
    analysis.value = null
    selectedDamageKey.value = null
    buildResult.value = null
    checklist.value = emptyChecklist()
    await discoverWorkspaceCaptures()
    await loadChecklist()
    await analyze()
  }

  async function analyze(): Promise<void> {
    if (!dir.value || busy.value) return
    busy.value = true
    error.value = ''
    buildResult.value = null
    ingestMessage.value = ''
    progress.value = t('progress.starting')
    markAllCaptures('pending')
    beginTaskModal(false) // delayed-open; a cached re-analyse finishes too fast to flash the modal
    // No up-front seeding: rows are created lazily as real work is seen (a file copied, or byte-level
    // indexing of a non-cached file), so a re-analyse of an already-indexed workspace surfaces only
    // the files actually (re)indexed or dragged this round — pre-existing cache hits never appear.
    try {
      const result = await window.api.analyze(dir.value)
      // Re-stat every file (incl. ones dragged in this round): the GUI orders captures by real mtime,
      // and reusing the pre-analyse map would leave new files with no mtime — pinning them to the top
      // of the captures panel (0) and the bottom of the tape map (NaN). listCaptures gives every file
      // its true mtime so both panels agree.
      const onDisk = new Map(
        (await window.api.listCaptures(dir.value)).map((item) => [item.file, item])
      )
      // merge the last export's decode spots in BEFORE reconcile, so they're tracked like any damage
      const sortedResult = withDecodeDamage(sortAnalysisCaptures(result, onDisk), decodeSpots.value)
      analysis.value = sortedResult
      workspaceCaptures.value = result.captures.map((capture) => ({
        file: capture.file,
        stem: capture.tag,
        format: result.format,
        sizeBytes: onDisk.get(capture.file)?.sizeBytes ?? 0,
        mtimeMs: onDisk.get(capture.file)?.mtimeMs ?? Number.NaN
      })).sort(compareWorkspaceCaptures)
      finalizeCaptureStatuses()
      checklist.value = reconcileChecklist(checklist.value, sortedResult)
      await saveChecklist()
      selectFirstActionable()
    } catch (e) {
      error.value = toMessage(e)
      analysis.value = null
    } finally {
      busy.value = false
      progress.value = ''
      endTaskModal()
    }
  }

  async function exportMerged(): Promise<void> {
    if (!analysis.value || !dir.value || busy.value) return
    const ext = analysis.value.format === 'hdv' ? '.m2t' : '.dv'
    // default the export name to the working folder's own name plus the completeness marker,
    // e.g. "<workspace folder> (TF99%-3).dv"
    const base =
      (dir.value || '').split(/[\\/]/).filter(Boolean).pop() || `tapeflow-${analysis.value.format}`
    const output = await window.api.pickSave(`${base} ${analysis.value.archive.tag}${ext}`)
    if (!output) return
    busy.value = true
    building.value = true
    buildProgress.value = null
    error.value = ''
    buildResult.value = null
    ingestMessage.value = ''
    progress.value = t('progress.exporting')
    try {
      buildResult.value = await window.api.build(dir.value, output)
      // This export (re)defines the persistent decode spots: overwrite them (HDV verify locates them; a
      // clean export or DV clears them) and merge into the current analysis so they appear as damage
      // cards/markers right away and survive a later re-analyse. Persist alongside the checklist.
      decodeSpots.value = buildResult.value?.verify?.decodeErrorSpots ?? []
      if (analysis.value) {
        analysis.value = withDecodeDamage(analysis.value, decodeSpots.value)
        checklist.value = reconcileChecklist(checklist.value, analysis.value)
      }
      await saveChecklist()
    } catch (e) {
      error.value = toMessage(e)
    } finally {
      busy.value = false
      building.value = false
      buildProgress.value = null
      progress.value = ''
    }
  }

  function dismissBuildResult(): void {
    buildResult.value = null
  }

  async function revealDir(): Promise<void> {
    if (dir.value) await window.api.revealDir(dir.value)
  }

  async function ingestFiles(files: File[]): Promise<void> {
    if (!dir.value) {
      error.value = t('errors.chooseDirFirst')
      return
    }
    if (busy.value || files.length === 0) return
    // Read the OS path in the renderer's own world - a dropped File carries `.path` here (Electron
    // <=31). Do NOT pass the File across the contextBridge: it's a DOM host object and contextBridge
    // can't clone it ("An object could not be cloned"). On Electron 32+ switch to webUtils
    // .getPathForFile exposed from the preload (File.path was removed there).
    const paths = files.map((file) => (file as File & { path?: string }).path ?? '').filter(Boolean)
    if (paths.length === 0) {
      error.value = t('errors.noPaths')
      return
    }
    busy.value = true
    error.value = ''
    buildResult.value = null
    progress.value = t('progress.copying', { count: paths.length })
    beginTaskModal(true) // a multi-GB copy is slow; show the modal at once (no flash risk here)
    try {
      const copied = await window.api.ingest(dir.value, paths)
      ingestMessage.value = t('progress.copied', { files: copied.join(', ') })
      await discoverWorkspaceCaptures()
    } catch (e) {
      error.value = toMessage(e)
      busy.value = false
      progress.value = ''
      endTaskModal()
      return
    }
    busy.value = false
    progress.value = ''
    await analyze() // keeps the modal open (copy rows -> index rows) and closes it when done
  }

  async function setAccepted(spot: DamageSpot, accepted: boolean): Promise<void> {
    const key = damageKey(spot)
    checklist.value.entries[key] = entryFromSpot(spot, accepted ? 'accepted' : 'outstanding')
    await saveChecklist()
  }

  function selectDamage(key: string | null): void {
    selectedDamageKey.value = key
  }

  async function loadChecklist(): Promise<void> {
    if (!dir.value) {
      checklist.value = emptyChecklist()
      decodeSpots.value = []
      return
    }
    try {
      // state.json carries the checklist plus the last export's decode-error spots alongside it; older
      // files predate the field and simply restore none.
      const { decodeSpots: saved, ...rest } = await window.api.loadState(dir.value)
      checklist.value = rest as ChecklistState
      decodeSpots.value = Array.isArray(saved) ? saved : []
    } catch (e) {
      error.value = toMessage(e)
      checklist.value = emptyChecklist()
      decodeSpots.value = []
    }
  }

  async function discoverWorkspaceCaptures(): Promise<void> {
    if (!dir.value) {
      workspaceCaptures.value = []
      captureStatuses.value = {}
      return
    }
    try {
      workspaceCaptures.value = (await window.api.listCaptures(dir.value)).sort(compareWorkspaceCaptures)
      markAllCaptures('pending')
    } catch (e) {
      workspaceCaptures.value = []
      captureStatuses.value = {}
      error.value = toMessage(e)
    }
  }

  async function saveChecklist(): Promise<void> {
    if (!dir.value) return
    // Both halves must be plain objects: a Vue reactive proxy can't cross the IPC structured-clone
    // boundary ("An object could not be cloned"). plainChecklist already deep-copies the checklist;
    // decodeSpots needs the same.
    await window.api.saveState(dir.value, {
      ...plainChecklist(checklist.value),
      decodeSpots: JSON.parse(JSON.stringify(decodeSpots.value)) as DecodeErrorSpot[]
    })
  }

  function selectFirstActionable(): void {
    if (!analysis.value) {
      selectedDamageKey.value = null
      return
    }
    if (
      selectedDamageKey.value &&
      damageViews.value.some((view) => view.key === selectedDamageKey.value)
    ) {
      return
    }
    selectedDamageKey.value = outstandingDamage.value[0]?.key ?? damageViews.value[0]?.key ?? null
  }

  function markAllCaptures(status: CaptureIndexStatus): void {
    const next: Record<string, CaptureIndexStatus> = {}
    for (const capture of workspaceCaptures.value) next[capture.file] = status
    captureStatuses.value = next
    if (status === 'pending') {
      captureProgress.value = {}
      indexingFile = null
    }
  }

  function matchCapture(file: string): WorkspaceCapture | undefined {
    return workspaceCaptures.value.find(
      (capture) => capture.file === file || capture.stem === file || capture.file.startsWith(`${file}.`)
    )
  }

  // Per-file index status/progress is driven by per-file START ('index-start') and FINISH
  // ('indexed') events, which carry the file. The 'indexing' phase carries BYTE progress of the
  // CURRENT file but no filename, so it's attributed to the last 'index-start' file — it must never
  // touch per-file STATUS (that was the bug that marked every file "indexed" at once).
  function updateCaptureProgress(p: Progress): void {
    if (!workspaceCaptures.value.length) return
    if (p.phase === 'indexing') {
      if (indexingFile && p.total) {
        captureProgress.value = {
          ...captureProgress.value,
          [indexingFile]: Math.min(1, (p.done ?? 0) / p.total)
        }
      }
      return
    }
    if (!p.file) return
    const matched = matchCapture(p.file)
    if (!matched) return
    if (p.phase === 'index-start') {
      indexingFile = matched.file
      captureProgress.value = { ...captureProgress.value, [matched.file]: 0 }
      captureStatuses.value = { ...captureStatuses.value, [matched.file]: 'indexing' }
    } else if (p.phase === 'indexed') {
      captureProgress.value = { ...captureProgress.value, [matched.file]: 1 }
      captureStatuses.value = {
        ...captureStatuses.value,
        [matched.file]: p.cached ? 'cached' : 'indexed'
      }
    }
  }

  // After analysis completes, settle every capture to its final state (keep 'cached' as-is).
  function finalizeCaptureStatuses(): void {
    const next: Record<string, CaptureIndexStatus> = {}
    for (const capture of workspaceCaptures.value) {
      next[capture.file] = captureStatuses.value[capture.file] === 'cached' ? 'cached' : 'indexed'
    }
    captureStatuses.value = next
  }

  return {
    caps,
    dir,
    analysis,
    checklist,
    progress,
    progressText,
    error,
    busy,
    building,
    buildProgress,
    buildResult,
    decodeSpots,
    selectedDamageKey,
    selectedDamage,
    workspaceCaptures,
    captureViews,
    taskList,
    taskModalOpen,
    indexTotal,
    indexDone,
    damageViews,
    outstandingDamage,
    acceptedDamage,
    missingDamage,
    dirtyDamage,
    coveredEntries,
    canExport,
    verdictText,
    init,
    dispose,
    pickDir,
    analyze,
    exportMerged,
    dismissBuildResult,
    revealDir,
    ingestFiles,
    setAccepted,
    selectDamage,
    discoverWorkspaceCaptures
  }
})

function toMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function plainChecklist(state: ChecklistState): ChecklistState {
  return JSON.parse(JSON.stringify(state)) as ChecklistState
}

// Synthesise a last-export decode-error spot into a DamageSpot so it is treated exactly like analysis
// damage (card, thumbnail, selection, accept/undo, map) — decode damage only surfaces at final decode
// but is, in effect, a place that may need another capture pass.
function decodeToDamage(spot: DecodeErrorSpot, analysis: TapeAnalysis): DamageSpot {
  const at = tcToSeconds(spot.tc, analysis.fps)
  const covering = analysis.captures.filter((c) => {
    const s = tcToSeconds(c.tcSpan[0], analysis.fps)
    const e = tcToSeconds(c.tcSpan[1], analysis.fps)
    return at != null && s != null && e != null && at >= s && at <= e
  })
  // place it on the engine's OWN axis (interpolated through a covering capture) so it sorts and lays
  // out alongside real damage instead of on a different scale
  const host = covering[0]
  let pos = at ?? 0
  if (host) {
    const t0 = tcToSeconds(host.tcSpan[0], analysis.fps)
    const t1 = tcToSeconds(host.tcSpan[1], analysis.fps)
    pos =
      at != null && t0 != null && t1 != null && t1 > t0
        ? host.axis[0] + Math.min(1, Math.max(0, (at - t0) / (t1 - t0))) * (host.axis[1] - host.axis[0])
        : host.axis[0]
  }
  return {
    id: `decode:${spot.frame}`,
    kind: 'decode',
    axis: [pos, pos],
    tcStart: spot.tc,
    tcEnd: spot.tc,
    recStart: spot.rec,
    recEnd: spot.rec,
    durationFrames: spot.count,
    coverage: covering.map((c) => c.tag),
    copies: covering.length,
    severity: spot.kind, // sub-kind (residual/stitch/transport/unexplained); the card localises it
    runs: []
  }
}

// analysis with the persisted decode spots merged into its damage. Idempotent: any prior synthesised
// decode is dropped first, so re-merging after a new export (or a re-analyse) just rebuilds them.
function withDecodeDamage(analysis: TapeAnalysis, decode: DecodeErrorSpot[]): TapeAnalysis {
  const base = analysis.damage.filter((d) => d.kind !== 'decode')
  return { ...analysis, damage: [...base, ...decode.map((s) => decodeToDamage(s, analysis))] }
}

function compareWorkspaceCaptures(a: WorkspaceCapture, b: WorkspaceCapture): number {
  const am = Number.isFinite(a.mtimeMs) ? a.mtimeMs : null
  const bm = Number.isFinite(b.mtimeMs) ? b.mtimeMs : null
  if (am != null && bm != null && am !== bm) return am - bm
  if (am != null && bm == null) return -1
  if (am == null && bm != null) return 1
  return a.file.localeCompare(b.file)
}

function sortAnalysisCaptures(
  analysis: TapeAnalysis,
  capturesByFile: Map<string, WorkspaceCapture>
): TapeAnalysis {
  const originalOrder = new Map(analysis.captures.map((capture, index) => [capture.tag, index]))
  return {
    ...analysis,
    captures: [...analysis.captures].sort((a, b) => {
      const known = compareWorkspaceCaptures(
        capturesByFile.get(a.file) ?? fallbackWorkspaceCapture(a.file, analysis.format),
        capturesByFile.get(b.file) ?? fallbackWorkspaceCapture(b.file, analysis.format)
      )
      return known || (originalOrder.get(a.tag) ?? 0) - (originalOrder.get(b.tag) ?? 0)
    })
  }
}

function fallbackWorkspaceCapture(file: string, format: TapeAnalysis['format']): WorkspaceCapture {
  return { file, stem: file.replace(/\.[^.]+$/, ''), format, sizeBytes: 0, mtimeMs: Number.NaN }
}
