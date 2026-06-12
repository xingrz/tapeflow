import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  BuildResult,
  Capabilities,
  ChecklistState,
  DamageSpot,
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
  const selectedDamageKey = ref<string | null>(null)
  const ingestMessage = ref('')
  const workspaceCaptures = ref<WorkspaceCapture[]>([])
  const captureStatuses = ref<Record<string, CaptureIndexStatus>>({})
  const captureProgress = ref<Record<string, number>>({})

  let unsubscribeProgress: (() => void) | null = null
  let indexingFile: string | null = null // the file the byte-level 'indexing' events belong to

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
    try {
      const result = await window.api.analyze(dir.value)
      const existing = new Map(workspaceCaptures.value.map((item) => [item.file, item]))
      const sortedResult = sortAnalysisCaptures(result, existing)
      analysis.value = sortedResult
      workspaceCaptures.value = result.captures.map((capture) => ({
        file: capture.file,
        stem: capture.tag,
        format: result.format,
        sizeBytes: existing.get(capture.file)?.sizeBytes ?? 0,
        mtimeMs: existing.get(capture.file)?.mtimeMs ?? 0
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
    }
  }

  async function exportMerged(): Promise<void> {
    if (!analysis.value || !dir.value || busy.value) return
    const ext = analysis.value.format === 'hdv' ? '.m2t' : '.dv'
    const title = analysis.value.tape.title || `tapeflow-${analysis.value.format}`
    const output = await window.api.pickSave(`${title}-merged${ext}`)
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
    try {
      const copied = await window.api.ingest(dir.value, paths)
      ingestMessage.value = t('progress.copied', { files: copied.join(', ') })
      await discoverWorkspaceCaptures()
    } catch (e) {
      error.value = toMessage(e)
      busy.value = false
      progress.value = ''
      return
    }
    busy.value = false
    progress.value = ''
    await analyze()
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
      return
    }
    try {
      checklist.value = await window.api.loadState(dir.value)
    } catch (e) {
      error.value = toMessage(e)
      checklist.value = emptyChecklist()
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
    await window.api.saveState(dir.value, plainChecklist(checklist.value))
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
    selectedDamageKey,
    selectedDamage,
    workspaceCaptures,
    captureViews,
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
