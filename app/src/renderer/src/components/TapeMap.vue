<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Minus, Plus, Scan } from '@lucide/vue'
import type { Capture, CaptureDamage, DamageSpot, TapeAnalysis } from '../types'
import type { DamageView } from '../stores/workflow'
import { parseRecordingTime, recordingTimeAt, secondsToTc, tcToSeconds } from '../utils/timecode'

type DomainMode = 'tc' | 'axis'

interface Domain {
  mode: DomainMode
  min: number
  max: number
}

interface HitZone {
  key: string
  x0: number
  x1: number
  y0: number
  y1: number
}

interface Plot {
  x: number
  w: number
}

// The header (ruler + Result track) is a separate, sticky canvas pinned at the top of the scroll
// wrap; the capture lanes are a second, taller canvas that scrolls beneath it. Both share the
// horizontal domain (viewMin/viewMax) so columns stay aligned.
const HEADER_H = 60
const LANE_TOP = 10
const LANE_STEP = 22
const LANE_H = 11

const props = defineProps<{
  analysis: TapeAnalysis
  damageViews: DamageView[]
  selectedKey: string | null
}>()

const emit = defineEmits<{
  select: [key: string]
}>()

const { t, locale } = useI18n()

const wrap = ref<HTMLDivElement | null>(null)
const headerCanvas = ref<HTMLCanvasElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const width = ref(0)
const viewMin = ref(0)
const viewMax = ref(1)
const focusedCaptureTag = ref<string | null>(null)
const hitZones: HitZone[] = []

const lanesHeight = computed(() => LANE_TOP + props.analysis.captures.length * LANE_STEP + 8)

let ro: ResizeObserver | null = null
let dragging = false
let dragEl: HTMLElement | null = null
let dragStartX = 0
let dragStartMin = 0
let dragStartMax = 1
let moved = false

const domain = computed<Domain>(() => makeDomain(props.analysis))
// the raw-coordinate warning is only for a TRUE fallback (axis layout with no tc labels); the
// multi-session physical layout is intentional and still labels in tc, so it shows no warning
const axisFallback = computed(() => domain.value.mode === 'axis' && !hasAxisLabels.value)

defineExpose({
  focusDamage,
  focusCapture
})

watch(
  () => props.analysis,
  () => resetView(),
  { immediate: true }
)

watch(
  [width, viewMin, viewMax, lanesHeight, focusedCaptureTag, () => props.selectedKey, () => props.damageViews],
  () => void nextTick(draw),
  { deep: true }
)

// the canvas is drawn imperatively, so a locale switch must trigger a redraw to re-label it
watch(locale, () => draw())

onMounted(() => {
  colors = readMapColors()
  ro = new ResizeObserver((entries) => {
    width.value = Math.floor(entries[0]?.contentRect?.width ?? 0)
    draw()
  })
  if (wrap.value) ro.observe(wrap.value)
  window.addEventListener('pointerup', onPointerUp)
})

onUnmounted(() => {
  ro?.disconnect()
  window.removeEventListener('pointerup', onPointerUp)
})

function resetView(): void {
  focusedCaptureTag.value = null
  const d = domain.value
  // pad MUST equal clampView's pad so "fit" lands exactly on the full pannable extent — i.e. fully
  // zoomed out with zero horizontal scroll room (#8).
  const pad = Math.max((d.max - d.min) * 0.03, 0.001)
  viewMin.value = d.min - pad
  viewMax.value = d.max + pad
  clampView()
}

function zoomBy(multiplier: number): void {
  const center = (viewMin.value + viewMax.value) / 2
  setViewAround(center, (viewMax.value - viewMin.value) * multiplier)
}

function focusDamage(spot: DamageSpot): void {
  focusedCaptureTag.value = null
  const range = rangeForDamage(spot)
  if (range) panToRange(range)
  // reveal the first capture that covers this spot (the damage is drawn on its lane); a missing
  // spot has no covering capture, so scroll to the result track at the top
  scrollLaneIntoView(props.analysis.captures.findIndex((c) => spot.coverage.includes(c.tag)))
}

function focusCapture(tag: string): void {
  const capture = props.analysis.captures.find((item) => item.tag === tag || item.file === tag)
  focusedCaptureTag.value = capture?.tag ?? null
  const range = capture ? rangeForCapture(capture) : null
  if (range) panToRange(range)
  scrollLaneIntoView(props.analysis.captures.findIndex((item) => item.tag === capture?.tag))
}

// Pan to centre the target while KEEPING the current zoom (span) — locating must never change the
// zoom the user set (#6). clampView keeps it inside the domain near edges.
function panToRange(range: [number, number]): void {
  const center = (range[0] + range[1]) / 2
  setViewAround(center, viewMax.value - viewMin.value)
}

// Scroll the wrap so the lane is centred in the area BELOW the sticky header (#1/#2). index < 0 =>
// the result track at the very top.
function scrollLaneIntoView(index: number): void {
  const el = wrap.value
  if (!el) return
  if (index < 0) {
    el.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }
  const laneY = HEADER_H + LANE_TOP + index * LANE_STEP + LANE_H / 2
  const target = laneY - (HEADER_H + el.clientHeight) / 2
  const max = Math.max(0, HEADER_H + lanesHeight.value - el.clientHeight)
  el.scrollTo({ top: clamp(target, 0, max), behavior: 'smooth' })
}

function onWheel(e: WheelEvent): void {
  if (!width.value) return
  const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY)
  const zoomIntent = e.ctrlKey || e.metaKey || e.shiftKey
  if (!horizontal && !zoomIntent) return // plain vertical wheel -> let the wrap scroll natively
  e.preventDefault()

  if (horizontal && !zoomIntent) {
    panByPixels(e.deltaX)
    return
  }

  // zoom-to-cursor: keep the value under the pointer at the same screen x (#11)
  const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
  const plot = plotRect()
  const pointerX = clamp(e.clientX - rect.left, plot.x, plot.x + plot.w)
  const delta = e.deltaY || e.deltaX
  zoomAtPointer(pointerX, (viewMax.value - viewMin.value) * (delta > 0 ? 1.15 : 0.86))
}

function zoomAtPointer(pointerX: number, nextSpan: number): void {
  const plot = plotRect()
  const fraction = (pointerX - plot.x) / plot.w
  const pointer = viewMin.value + fraction * (viewMax.value - viewMin.value)
  const full = domain.value.max - domain.value.min
  const span = clamp(nextSpan, Math.max(full / 250, 0.01), full * 1.06)
  viewMin.value = pointer - fraction * span
  viewMax.value = viewMin.value + span
  clampView()
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  dragging = true
  moved = false
  dragStartX = e.clientX
  dragStartMin = viewMin.value
  dragStartMax = viewMax.value
  dragEl = e.currentTarget as HTMLElement
  dragEl.setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent): void {
  if (!dragging || !width.value) return
  const dx = e.clientX - dragStartX
  if (Math.abs(dx) > 2) moved = true
  const plot = plotRect()
  const span = dragStartMax - dragStartMin
  const delta = (dx / plot.w) * span
  viewMin.value = dragStartMin - delta
  viewMax.value = dragStartMax - delta
  clampView()
  draw()
}

function onPointerUp(e: PointerEvent): void {
  if (!dragging) return
  dragging = false
  try {
    dragEl?.releasePointerCapture(e.pointerId)
  } catch {
    /* pointer was not captured on this element */
  }
  dragEl = null
}

function onHeaderClick(e: MouseEvent): void {
  if (moved) return
  const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  const hit = hitZones.find((zone) => x >= zone.x0 && x <= zone.x1 && y >= zone.y0 && y <= zone.y1)
  if (hit) emit('select', hit.key)
}

function setViewAround(center: number, span: number): void {
  const full = domain.value.max - domain.value.min
  const next = clamp(span, Math.max(full / 250, 0.01), full * 1.06)
  viewMin.value = center - next / 2
  viewMax.value = center + next / 2
  clampView()
}

function panByPixels(px: number): void {
  const plot = plotRect()
  const span = viewMax.value - viewMin.value
  const delta = (px / plot.w) * span
  viewMin.value += delta
  viewMax.value += delta
  clampView()
}

function clampView(): void {
  const d = domain.value
  const full = d.max - d.min
  const pad = Math.max(full * 0.03, 0.001)
  const minAllowed = d.min - pad
  const maxAllowed = d.max + pad
  let min = viewMin.value
  let max = viewMax.value
  const span = max - min

  if (span >= maxAllowed - minAllowed) {
    viewMin.value = minAllowed
    viewMax.value = maxAllowed
    return
  }
  if (min < minAllowed) {
    max += minAllowed - min
    min = minAllowed
  }
  if (max > maxAllowed) {
    min -= max - maxAllowed
    max = maxAllowed
  }
  viewMin.value = min
  viewMax.value = max
}

// The canvas can't use CSS, so the map palette lives in --map-* vars and is read here. Re-read on
// mount (and a future theme toggle) so the canvas always matches the rest of the dark UI.
function readMapColors() {
  const s = getComputedStyle(document.documentElement)
  const v = (n: string): string => s.getPropertyValue(n).trim()
  return {
    canvasBg: v('--map-header-bg'),
    divider: v('--map-divider'),
    grid: v('--map-grid'),
    gridSoft: v('--map-grid-soft'),
    tcText: v('--map-tc-text'),
    recText: v('--map-rec-text'),
    axisText: v('--map-axis-text'),
    label: v('--map-label'),
    resultBg: v('--map-result-bg'),
    resultBgWarn: v('--map-result-bg-warn'),
    resultSeg: v('--map-result-seg'),
    lane: v('--map-lane'),
    laneBorder: v('--map-lane-border'),
    laneFocus: v('--map-lane-focus'),
    laneFocusEdge: v('--map-lane-focus-edge'),
    damage: v('--map-damage'),
    missing: v('--map-missing'),
    missingStripe: v('--map-missing-stripe'),
    residual: v('--map-residual'),
    selectFill: v('--map-select-fill'),
    selectEdge: v('--map-select-edge'),
    selectBox: v('--map-select-box')
  }
}
let colors = readMapColors()

function draw(): void {
  if (!width.value) return
  drawHeader()
  drawLanes()
}

function prepare(c: HTMLCanvasElement, h: number): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1
  const w = width.value
  c.width = Math.floor(w * dpr)
  c.height = Math.floor(h * dpr)
  c.style.height = `${h}px`
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = colors.canvasBg
  ctx.fillRect(0, 0, w, h)
  return ctx
}

function drawHeader(): void {
  const c = headerCanvas.value
  if (!c) return
  const ctx = prepare(c, HEADER_H)
  if (!ctx) return
  hitZones.length = 0
  drawRuler(ctx)
  drawResultTrack(ctx)
  drawSelectionEdges(ctx, 38, HEADER_H) // connect the selection band up through the result track
  ctx.strokeStyle = colors.divider
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, HEADER_H - 0.5)
  ctx.lineTo(width.value, HEADER_H - 0.5)
  ctx.stroke()
}

function drawLanes(): void {
  const c = canvas.value
  if (!c) return
  const ctx = prepare(c, lanesHeight.value)
  if (!ctx) return
  drawSelectionFill(ctx)
  drawCaptureLanes(ctx)
  drawSeams(ctx, 0, lanesHeight.value)
  drawSelectionEdges(ctx, 0, lanesHeight.value)
}

// The selected re-capture spot gets a VERTICAL band spanning every lane (the counterpart to a
// capture's horizontal selection band), so you can see which captures it crosses (#14).
function selectedClip(): { x: number; w: number } | null {
  if (!props.selectedKey) return null
  const view = props.damageViews.find((v) => v.key === props.selectedKey)
  if (!view) return null
  const range = rangeForDamage(view.spot)
  return range ? clippedXRange(range, 10) : null
}

function drawSelectionFill(ctx: CanvasRenderingContext2D): void {
  const clip = selectedClip()
  if (!clip) return
  ctx.fillStyle = colors.selectFill
  ctx.fillRect(clip.x, 0, clip.w, lanesHeight.value)
}

function drawSelectionEdges(ctx: CanvasRenderingContext2D, y0: number, y1: number): void {
  const clip = selectedClip()
  if (!clip) return
  ctx.save()
  ctx.strokeStyle = colors.selectEdge
  ctx.lineWidth = 1
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(clip.x + 0.5, y0)
  ctx.lineTo(clip.x + 0.5, y1)
  ctx.moveTo(clip.x + clip.w - 0.5, y0)
  ctx.lineTo(clip.x + clip.w - 0.5, y1)
  ctx.stroke()
  ctx.restore()
}

// The (tape TC -> wall clock) curve as numbers, parsed once per analysis: tc seconds + epoch ms,
// sorted by tc. The wall clock is non-linear (jumps at pauses / different-day footage), so the ruler
// reads it per position from this curve instead of extrapolating from one anchor.
const recAnchors = computed(() => {
  const fps = props.analysis.fps
  const pts: Array<{ tc: number; ms: number }> = []
  for (const a of props.analysis.tape.recAnchors ?? []) {
    const tc = tcToSeconds(a.tc, fps)
    const d = parseRecordingTime(a.rec)
    if (tc != null && d) pts.push({ tc, ms: d.getTime() })
  }
  pts.sort((p, q) => p.tc - q.tc)
  return pts
})

// Wall-clock label at a tape-TC position, interpolated from the curve. Snaps across a discontinuity
// (rec going backward = footage from another day, or a >1h forward gap = a long pause) so it never
// invents impossible in-between times. Falls back to the old linear extrapolation when there is no
// curve (e.g. DV).
function recLabelAt(tcSeconds: number): string | null {
  const pts = recAnchors.value
  if (!pts.length) {
    return recordingTimeAt(
      tcSeconds,
      tcToSeconds(props.analysis.tape.tcStart, props.analysis.fps),
      props.analysis.tape.recStart
    )
  }
  if (tcSeconds <= pts[0].tc) return fmtRec(pts[0].ms)
  if (tcSeconds >= pts[pts.length - 1].tc) return fmtRec(pts[pts.length - 1].ms)
  let lo = 0
  let hi = pts.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (pts[mid].tc <= tcSeconds) lo = mid
    else hi = mid
  }
  const a = pts[lo]
  const b = pts[hi]
  const dMs = b.ms - a.ms
  if (dMs < 0 || dMs > 3_600_000) {
    return fmtRec(tcSeconds - a.tc <= b.tc - tcSeconds ? a.ms : b.ms) // snap to the nearer side
  }
  const f = b.tc > a.tc ? (tcSeconds - a.tc) / (b.tc - a.tc) : 0
  return fmtRec(a.ms + f * dMs)
}

function fmtRec(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// The (physical position -> tc seconds, wall-clock ms) curve for a multi-session tape laid out on the
// physical axis: parsed once, sorted by position. The ruler reads tc and rec at each tick from this
// instead of from a single linear origin, so a session's restarted tc and its own recording day both
// read correctly.
const axisAnchors = computed(() => {
  const fps = props.analysis.fps
  const pts: Array<{ axis: number; tc: number | null; ms: number | null }> = []
  for (const a of props.analysis.tape.axisAnchors ?? []) {
    const tc = tcToSeconds(a.tc, fps)
    const d = parseRecordingTime(a.rec)
    pts.push({ axis: a.axis, tc: tc ?? null, ms: d ? d.getTime() : null })
  }
  pts.sort((p, q) => p.axis - q.axis)
  return pts
})

const hasAxisLabels = computed(() => domain.value.mode === 'axis' && axisAnchors.value.length > 0)

// tape tc + wall clock at a physical position, interpolated from the axisAnchors curve. Snaps across
// a discontinuity (tc or rec stepping backward = a new recording session) so it never invents an
// impossible in-between value. Returns nulls when there is no curve (raw axis-coordinate fallback).
function labelAtAxis(axisPos: number): { tc: string | null; rec: string | null } {
  const pts = axisAnchors.value
  if (!pts.length) return { tc: null, rec: null }
  if (axisPos <= pts[0].axis) return { tc: tcStr(pts[0].tc), rec: recStr(pts[0].ms) }
  const last = pts[pts.length - 1]
  if (axisPos >= last.axis) return { tc: tcStr(last.tc), rec: recStr(last.ms) }
  let lo = 0
  let hi = pts.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (pts[mid].axis <= axisPos) lo = mid
    else hi = mid
  }
  const a = pts[lo]
  const b = pts[hi]
  const f = b.axis > a.axis ? (axisPos - a.axis) / (b.axis - a.axis) : 0
  const nearer = axisPos - a.axis <= b.axis - axisPos ? a : b
  // tc: linear within a session; a backward step is a seam -> snap to the nearer side
  const tc =
    a.tc != null && b.tc != null && b.tc >= a.tc
      ? tcStr(a.tc + f * (b.tc - a.tc))
      : tcStr(nearer.tc)
  // rec: same, snapping when the wall clock jumps backward or by more than an hour (different day)
  const rec =
    a.ms != null && b.ms != null && b.ms - a.ms >= 0 && b.ms - a.ms <= 3_600_000
      ? recStr(a.ms + f * (b.ms - a.ms))
      : recStr(nearer.ms)
  return { tc, rec }
}

function tcStr(seconds: number | null): string | null {
  return seconds == null ? null : secondsToTc(seconds, props.analysis.fps)
}

function recStr(ms: number | null): string | null {
  return ms == null ? null : fmtRec(ms)
}

function drawRuler(ctx: CanvasRenderingContext2D): void {
  const plot = plotRect()
  const span = viewMax.value - viewMin.value
  // tc mode and the multi-session physical layout both print a tc (+rec) label, so reserve the wide
  // slot; only a raw-coordinate axis fallback uses the narrow numeric slot.
  const tcLabelled = domain.value.mode === 'tc' || hasAxisLabels.value
  const labelWidth = tcLabelled ? 126 : 64
  const targetTicks = Math.max(2, Math.floor(plot.w / labelWidth))
  const step = niceStep(span / targetTicks)
  const start = Math.ceil(viewMin.value / step) * step

  ctx.strokeStyle = colors.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(plot.x, 30)
  ctx.lineTo(plot.x + plot.w, 30)
  ctx.stroke()

  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textBaseline = 'top'

  for (let v = start; v <= viewMax.value + step * 0.1; v += step) {
    const x = xForValue(v)
    if (x < plot.x - 1 || x > plot.x + plot.w + 1) continue
    ctx.strokeStyle = colors.gridSoft
    ctx.beginPath()
    ctx.moveTo(x, 23)
    ctx.lineTo(x, 36)
    ctx.stroke()

    // tc mode reads tc from the position directly; physical layout reads tc+rec from axisAnchors;
    // a bare axis fallback prints the raw coordinate.
    let tcLabel: string
    let rec: string | null = null
    if (domain.value.mode === 'tc') {
      tcLabel = secondsToTc(v, props.analysis.fps)
      rec = recLabelAt(v)
    } else if (hasAxisLabels.value) {
      const at = labelAtAxis(v)
      tcLabel = at.tc ?? `${Math.round(v)}`
      rec = at.rec
    } else {
      tcLabel = `${Math.round(v)}`
    }
    ctx.fillStyle = colors.tcText
    ctx.fillText(tcLabel, clampedLabelX(ctx, tcLabel, x + 5, plot.x, plot.x + plot.w), 9)

    if (rec && plot.w >= 340) {
      const recLabel = rec.slice(11)
      ctx.fillStyle = colors.recText
      ctx.font = '10px system-ui, -apple-system, sans-serif'
      ctx.fillText(recLabel, clampedLabelX(ctx, recLabel, x + 5, plot.x, plot.x + plot.w), 22)
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'
    }
  }

  drawSeams(ctx, 20, HEADER_H)

  ctx.fillStyle = colors.axisText
  ctx.font = '11px system-ui, -apple-system, sans-serif'
  ctx.fillText(tcLabelled ? t('map.tapeTcClock') : t('map.tapeCoordinate'), 12, 16)
}

// Recording-session boundaries (a tc restart). Only present on a multi-session tape laid out on the
// physical axis; drawn as a thin dashed marker so you can see where one recording ends and the next
// (an overwrite, a different day, an over-capture) begins.
function drawSeams(ctx: CanvasRenderingContext2D, y0: number, y1: number): void {
  const seams = props.analysis.tape.seams
  if (domain.value.mode !== 'axis' || !seams || !seams.length) return
  const plot = plotRect()
  ctx.save()
  ctx.strokeStyle = colors.recText
  ctx.lineWidth = 1
  ctx.setLineDash([2, 2])
  for (const s of seams) {
    const x = xForValue(s)
    if (x < plot.x - 1 || x > plot.x + plot.w + 1) continue
    ctx.beginPath()
    ctx.moveTo(x + 0.5, y0)
    ctx.lineTo(x + 0.5, y1)
    ctx.stroke()
  }
  ctx.restore()
}

function drawResultTrack(ctx: CanvasRenderingContext2D): void {
  const plot = plotRect()
  const y = 43
  ctx.fillStyle = colors.label
  ctx.font = '600 11px system-ui, -apple-system, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.fillText(t('map.result'), 12, y + 6)

  ctx.fillStyle = props.analysis.complete ? colors.resultBg : colors.resultBgWarn
  roundedRect(ctx, plot.x, y, plot.w, 12, 2)
  ctx.fill()

  ctx.save()
  clipToPlot(ctx, plot, 0, HEADER_H)
  // Draw coverage as merged runs, not per-segment rectangles. Consecutive output segments meet at a
  // GOP boundary, but each is only drawn to its last-GOP TC, so a ~1-GOP sliver is left between
  // them that looks like a gap when zoomed in — the output is actually continuous there. Merging
  // touching segments makes covered tape read as one solid green bar; genuine holes (missing tape)
  // are larger, stay dark, and are drawn on top as the red/striped overlays below.
  ctx.fillStyle = colors.resultSeg
  for (const run of resultCoverageRuns()) {
    roundedRect(ctx, run.x, y + 2, run.w, 8, 2)
    ctx.fill()
  }
  ctx.restore()

  for (const view of props.damageViews) {
    drawDamageRegion(ctx, view.spot, view.key, y, 12, view.status === 'accepted', true)
  }
}

// Covered tape as merged x-runs (in screen space): adjacent output segments are coalesced so the
// result bar is continuous, with only genuine missing gaps left dark. Works in both TC and axis
// domains (axis segments already tile; TC ones leave the ~1-GOP sliver this closes).
function resultCoverageRuns(): Array<{ x: number; w: number }> {
  const fps = props.analysis.fps || 25
  // ~1 s in the active domain's units — enough to bridge a one-GOP seam, far short of a real gap
  const bridge = domain.value.mode === 'tc' ? 30 / fps : 1
  const intervals: Array<[number, number]> = []
  for (const segment of props.analysis.segments) {
    const range = rangeForTcOrAxis(segment.tcSpan, segment.axis)
    if (range) intervals.push(range)
  }
  intervals.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const [a, b] of intervals) {
    const last = merged[merged.length - 1]
    if (last && a <= last[1] + bridge) last[1] = Math.max(last[1], b)
    else merged.push([a, b])
  }
  const runs: Array<{ x: number; w: number }> = []
  for (const m of merged) {
    const clipped = clippedXRange(m)
    if (clipped) runs.push(clipped)
  }
  return runs
}

function drawCaptureLanes(ctx: CanvasRenderingContext2D): void {
  const plot = plotRect()
  props.analysis.captures.forEach((capture, index) => {
    const y = LANE_TOP + index * LANE_STEP
    const focused = focusedCaptureTag.value === capture.tag
    if (focused) {
      ctx.fillStyle = colors.laneFocus
      ctx.fillRect(6, y - 6, width.value - 12, LANE_STEP)
      ctx.strokeStyle = colors.laneFocusEdge
      ctx.strokeRect(plot.x - 1, y - 2, plot.w + 2, LANE_H + 4)
    }
    drawLaneLabel(ctx, capture, y)

    // Draw each covered segment separately — the spaces between them are the capture's internal
    // drops (a continuity break can drop content), so the lane stops pretending to cover them.
    for (const seg of laneSegments(capture)) {
      ctx.fillStyle = colors.lane
      roundedRect(ctx, seg.x, y, seg.w, LANE_H, 2)
      ctx.fill()
      ctx.strokeStyle = colors.laneBorder
      ctx.lineWidth = 1
      roundedRect(ctx, seg.x, y, seg.w, LANE_H, 2)
      ctx.stroke()
    }

    // where THIS capture has no footage (a coverage drop / internal TC discontinuity) — drawn in the
    // same red stripes as the result's `missing`, so "missing footage" reads consistently across the
    // result track and the lanes. Whether the merged output still covers it is shown by the result
    // track staying green there (another capture filled it).
    for (const gap of laneGaps(capture)) {
      ctx.fillStyle = colors.missing
      roundedRect(ctx, gap.x, y, gap.w, LANE_H, 2)
      ctx.fill()
      drawStripes(ctx, gap.x, y, gap.w, LANE_H, colors.missingStripe)
      ctx.strokeStyle = colors.missing
      ctx.lineWidth = 1
      roundedRect(ctx, gap.x, y, gap.w, LANE_H, 2)
      ctx.stroke()
    }

    // this capture's OWN damaged runs (where the material itself is bad), not just where the
    // merged result is still bad (#5)
    for (const dmg of capture.damage ?? []) {
      drawCaptureDamageRun(ctx, dmg, y + 2, LANE_H - 4)
    }
  })
}

function laneSegments(capture: Capture): Array<{ x: number; w: number }> {
  const out: Array<{ x: number; w: number }> = []
  // each covered run carries both its tc span (tc mode) and its physical axis span (DV physical
  // layout), so the lane draws its real held stretches in either mode — the gaps between are drops
  if (capture.ranges && capture.ranges.length) {
    for (const seg of capture.ranges) {
      const r = rangeForTcOrAxis([seg.tcStart, seg.tcEnd], seg.axis ?? capture.axis)
      const c = r ? clippedXRange(r, 2) : null
      if (c) out.push(c)
    }
    return out
  }
  const r = rangeForCapture(capture)
  const c = r ? clippedXRange(r) : null
  if (c) out.push(c)
  return out
}

// the drops BETWEEN a capture's covered segments — the tape it's missing internally
function laneGaps(capture: Capture): Array<{ x: number; w: number }> {
  const out: Array<{ x: number; w: number }> = []
  const r = capture.ranges
  if (!r || r.length < 2) return out
  for (let i = 0; i < r.length - 1; i++) {
    const a = r[i].axis
    const b = r[i + 1].axis
    const axisGap: [number, number] = a && b ? [a[1], b[0]] : capture.axis
    const range = rangeForTcOrAxis([r[i].tcEnd, r[i + 1].tcStart], axisGap)
    const c = range ? clippedXRange(range, 2) : null
    if (c) out.push(c)
  }
  return out
}

function drawCaptureDamageRun(ctx: CanvasRenderingContext2D, dmg: CaptureDamage, y: number, h: number): void {
  // tc mode reads the run's tc span; the physical (DV multi-session) layout reads its pf span, so a
  // capture damaged throughout shows mosaic along its whole lane there too
  const range = rangeForTcOrAxis([dmg.tcStart, dmg.tcEnd], dmg.axis ?? [Number.NaN, Number.NaN])
  if (!range) return
  const clipped = clippedXRange(range, 4)
  if (!clipped) return
  ctx.fillStyle = colors.damage
  roundedRect(ctx, clipped.x, y, clipped.w, h, 1)
  ctx.fill()
}

function drawLaneLabel(ctx: CanvasRenderingContext2D, capture: Capture, y: number): void {
  const plot = plotRect()
  const labelWidth = Math.max(42, plot.x - 22)
  ctx.save()
  ctx.beginPath()
  ctx.rect(10, y - 8, labelWidth, 18)
  ctx.clip()
  ctx.textBaseline = 'middle'
  ctx.fillStyle = colors.label
  ctx.font = '600 11px system-ui, -apple-system, sans-serif'
  ctx.fillText(fitText(ctx, capture.file || capture.tag, labelWidth), 12, y + 5)
  ctx.restore()
}

function drawDamageRegion(
  ctx: CanvasRenderingContext2D,
  spot: DamageSpot,
  key: string,
  y: number,
  h: number,
  accepted: boolean,
  interactive: boolean
): void {
  const range = rangeForDamage(spot)
  if (!range) return
  const clipped = clippedXRange(range, 6)
  if (!clipped) return
  const selected = props.selectedKey === key

  // Draw the PRECISE damaged sub-runs so the result track lines up with the per-capture lanes (a
  // re-capture spot bridges short clean gaps for the cue, but the map should show the real damage).
  // Missing gaps have no TC runs -> draw the whole extent.
  const pieces: Array<{ x: number; w: number }> = []
  if (spot.runs && spot.runs.length) {
    for (const run of spot.runs) {
      // each run carries its own physical axis span, so the scattered damage draws at the right
      // place on the physical layout (not the whole spot extent)
      const rr = rangeForTcOrAxis([run.tcStart, run.tcEnd], run.axis ?? spot.axis)
      const rc = rr ? clippedXRange(rr, 4) : null
      if (rc) pieces.push(rc)
    }
  }
  if (!pieces.length) pieces.push(clipped)

  ctx.save()
  ctx.globalAlpha = accepted ? 0.35 : 1
  for (const piece of pieces) {
    if (spot.kind === 'missing') {
      ctx.fillStyle = colors.missing
      roundedRect(ctx, piece.x, y, piece.w, h, 2)
      ctx.fill()
      drawStripes(ctx, piece.x, y, piece.w, h, colors.missingStripe)
    } else {
      ctx.fillStyle = colors.residual
      roundedRect(ctx, piece.x, y, piece.w, h, 2)
      ctx.fill()
    }
  }
  ctx.restore()

  if (selected) {
    ctx.strokeStyle = colors.selectBox
    ctx.lineWidth = 2
    roundedRect(ctx, clipped.x - 2, y - 3, clipped.w + 4, h + 6, 3)
    ctx.stroke()
  }

  if (interactive) {
    hitZones.push({ key, x0: clipped.x, x1: clipped.x + clipped.w, y0: y - 6, y1: y + h + 6 })
  }
}

function drawStripes(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color = colors.missingStripe
): void {
  ctx.save()
  ctx.beginPath()
  roundedRect(ctx, x, y, w, h, 2)
  ctx.clip()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.2
  for (let sx = x - h; sx < x + w + h; sx += 6) {
    ctx.beginPath()
    ctx.moveTo(sx, y + h)
    ctx.lineTo(sx + h, y)
    ctx.stroke()
  }
  ctx.restore()
}

function rangeForCapture(capture: Capture): [number, number] | null {
  return rangeForTcOrAxis(capture.tcSpan, capture.axis)
}

function rangeForDamage(spot: DamageSpot): [number, number] | null {
  return rangeForTcOrAxis([spot.tcStart, spot.tcEnd], spot.axis)
}

function rangeForTcOrAxis(tcSpan: [string | null, string | null], axis: [number, number]): [number, number] | null {
  if (domain.value.mode === 'tc') {
    const a = tcToSeconds(tcSpan[0], props.analysis.fps)
    const b = tcToSeconds(tcSpan[1], props.analysis.fps)
    if (a != null && b != null && b >= a) return normalizeRange(a, b)
  }
  return normalizeRange(axis[0], axis[1])
}

function normalizeRange(a: number, b: number): [number, number] | null {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  // a point (single GOP/frame, tcStart==tcEnd): keep it AT its TC and let clippedXRange give it a
  // minimum pixel width forward — don't inflate it ±0.5 s (that drew it fat and shifted left, so a
  // single-GOP damage spilled past the capture's coverage and looked misaligned).
  if (a === b) return [a, a]
  return a < b ? [a, b] : [b, a]
}

function xForValue(value: number): number {
  const plot = plotRect()
  return plot.x + ((value - viewMin.value) / (viewMax.value - viewMin.value)) * plot.w
}

function plotRect(): Plot {
  const left = width.value < 720 ? 124 : 166
  return { x: left, w: Math.max(40, width.value - left - 14) }
}

function clippedXRange(range: [number, number], minWidth = 2): { x: number; w: number } | null {
  const plot = plotRect()
  const rawX0 = xForValue(range[0])
  const rawX1 = xForValue(range[1])
  if (rawX1 < plot.x || rawX0 > plot.x + plot.w) return null
  const x0 = Math.max(plot.x, rawX0)
  const x1 = Math.min(plot.x + plot.w, rawX1)
  return { x: x0, w: Math.max(minWidth, x1 - x0) }
}

function clipToPlot(ctx: CanvasRenderingContext2D, plot: Plot, y: number, h: number): void {
  ctx.beginPath()
  ctx.rect(plot.x, y, plot.w, h)
  ctx.clip()
}

function clampedLabelX(
  ctx: CanvasRenderingContext2D,
  label: string,
  preferred: number,
  min: number,
  max: number
): number {
  const w = ctx.measureText(label).width
  return Math.max(min + 2, Math.min(preferred, max - w - 2))
}

function makeDomain(analysis: TapeAnalysis): Domain {
  const tcValues: number[] = []
  const addTc = (value: string | null) => {
    const seconds = tcToSeconds(value, analysis.fps)
    if (seconds != null) tcValues.push(seconds)
  }
  addTc(analysis.tape.tcStart)
  addTc(analysis.tape.tcEnd)
  for (const capture of analysis.captures) {
    addTc(capture.tcSpan[0])
    addTc(capture.tcSpan[1])
  }
  for (const spot of analysis.damage) {
    addTc(spot.tcStart)
    addTc(spot.tcEnd)
  }
  const tcDomain = domainFromValues(tcValues)

  const axisValues: number[] = []
  for (const capture of analysis.captures) axisValues.push(capture.axis[0], capture.axis[1])
  for (const segment of analysis.segments) axisValues.push(segment.axis[0], segment.axis[1])
  for (const spot of analysis.damage) axisValues.push(spot.axis[0], spot.axis[1])
  const axisDomain = domainFromValues(axisValues)

  // Lay out on the PHYSICAL axis only when the engine flags the tape as multi-session AND supplies
  // the per-position (tc, rec) anchor curve to label it (DV does both). tc restarts at a seam, so a
  // tc axis would overlap or scatter the sessions; the physical axis keeps them adjacent and the
  // ruler still reads tc via the anchors. Everything else — single-session DV, and all HDV (whose
  // engine already orders islands by PCR, so it never stretches) — keeps the tc axis as before.
  if (axisDomain && analysis.tape.multiSession === true && (analysis.tape.axisAnchors?.length ?? 0) > 0) {
    return { mode: 'axis', ...axisDomain }
  }

  if (tcDomain) return { mode: 'tc', ...tcDomain }
  return { mode: 'axis', ...(axisDomain ?? { min: 0, max: 1 }) }
}

function domainFromValues(values: number[]): { min: number; max: number } | null {
  const finite = values.filter(Number.isFinite)
  if (finite.length < 2) return null
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  return max > min ? { min, max } : null
}

function niceStep(raw: number): number {
  const exponent = Math.floor(Math.log10(Math.max(raw, 0.0001)))
  const base = Math.pow(10, exponent)
  const scaled = raw / base
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10
  return nice * base
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

function fitText(ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string {
  if (ctx.measureText(value).width <= maxWidth) return value
  const ellipsis = '...'
  let lo = 0
  let hi = value.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const candidate = `${value.slice(0, mid)}${ellipsis}`
    if (ctx.measureText(candidate).width <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return `${value.slice(0, lo)}${ellipsis}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
</script>

<template>
  <section class="panel timeline-panel" aria-label="Tape map">
    <div class="panel-title-row">
      <div>
        <h2>{{ $t('map.title') }}</h2>
        <p v-if="axisFallback" class="axis-warning">{{ $t('map.axisFallback') }}</p>
      </div>
      <div class="map-controls" aria-label="Map controls">
        <button class="icon-button" type="button" :title="$t('map.zoomOut')" @click="zoomBy(1.25)">
          <Minus :size="15" />
        </button>
        <button class="icon-button" type="button" :title="$t('map.fit')" @click="resetView">
          <Scan :size="15" />
        </button>
        <button class="icon-button" type="button" :title="$t('map.zoomIn')" @click="zoomBy(0.8)">
          <Plus :size="15" />
        </button>
      </div>
    </div>

    <div ref="wrap" class="canvas-wrap">
      <canvas
        ref="headerCanvas"
        class="tape-canvas tape-header"
        role="presentation"
        @wheel="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @click="onHeaderClick"
      />
      <canvas
        ref="canvas"
        class="tape-canvas tape-lanes"
        role="img"
        :aria-label="`Tape map with ${analysis.captures.length} capture lanes`"
        @wheel="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
      />
    </div>
  </section>
</template>
