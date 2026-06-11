<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronsLeft,
  ChevronsUp,
  Download,
  FolderOpen,
  HardDrive,
  RefreshCw,
  UploadCloud,
  XCircle
} from '@lucide/vue'
import BuildPanel from './components/BuildPanel.vue'
import CaptureTable from './components/CaptureTable.vue'
import DamageSidebar from './components/DamageSidebar.vue'
import TapeMap from './components/TapeMap.vue'
import { useWorkflowStore, type DamageView } from './stores/workflow'
import { formatDurationFrames, shortPath } from './utils/format'

const workflow = useWorkflowStore()
const dragActive = ref(false)
const tapeMapRef = ref<InstanceType<typeof TapeMap> | null>(null)
const workspaceRef = ref<HTMLElement | null>(null)
const leftPaneRef = ref<HTMLElement | null>(null)
const rightWidth = ref(360)
const capturesHeight = ref(220)
const rightCollapsed = ref(false)
const capturesCollapsed = ref(false)
let dragDepth = 0
let activeResize: 'right' | 'captures' | null = null

const missingDuration = computed(() => {
  const analysis = workflow.analysis
  if (!analysis) return '0 s'
  const frames = workflow.missingDamage.reduce((sum, view) => sum + view.spot.durationFrames, 0)
  return formatDurationFrames(frames, analysis.fps)
})

const hasWorkspace = computed(() => Boolean(workflow.dir || workflow.analysis))

const workspaceStyle = computed(() => ({
  gridTemplateColumns: rightCollapsed.value
    ? 'minmax(0, 1fr) 6px 34px'
    : `minmax(0, 1fr) 6px ${rightWidth.value}px`
}))

const leftPaneStyle = computed(() => ({
  gridTemplateRows: capturesCollapsed.value
    ? 'minmax(0, 1fr) 6px 34px'
    : `minmax(0, 1fr) 6px ${capturesHeight.value}px`
}))

onMounted(() => void workflow.init())
onUnmounted(() => {
  workflow.dispose()
  stopResize()
})

function onDragEnter(e: DragEvent): void {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragDepth += 1
  dragActive.value = true
}

function onDragOver(e: DragEvent): void {
  if (!hasFiles(e)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = workflow.dir ? 'copy' : 'none'
}

function onDragLeave(e: DragEvent): void {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragDepth = Math.max(0, dragDepth - 1)
  dragActive.value = dragDepth > 0
}

async function onDrop(e: DragEvent): Promise<void> {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragDepth = 0
  dragActive.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  await workflow.ingestFiles(files)
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
}

async function setAccepted(view: DamageView, accepted: boolean): Promise<void> {
  await workflow.setAccepted(view.spot, accepted)
}

function selectDamage(key: string): void {
  workflow.selectDamage(key)
  const view = workflow.damageViews.find((item) => item.key === key)
  if (view) tapeMapRef.value?.focusDamage(view.spot)
}

function selectCapture(tag: string): void {
  tapeMapRef.value?.focusCapture(tag)
}

function startRightResize(e: PointerEvent): void {
  if (rightCollapsed.value) return
  activeResize = 'right'
  beginResize(e)
}

function startCapturesResize(e: PointerEvent): void {
  if (capturesCollapsed.value) return
  activeResize = 'captures'
  beginResize(e)
}

function beginResize(e: PointerEvent): void {
  e.preventDefault()
  window.addEventListener('pointermove', onResize)
  window.addEventListener('pointerup', stopResize)
}

function onResize(e: PointerEvent): void {
  if (activeResize === 'right' && workspaceRef.value) {
    const rect = workspaceRef.value.getBoundingClientRect()
    rightWidth.value = clamp(rect.right - e.clientX, 280, Math.max(300, rect.width - 520))
  }
  if (activeResize === 'captures' && leftPaneRef.value) {
    const rect = leftPaneRef.value.getBoundingClientRect()
    capturesHeight.value = clamp(rect.bottom - e.clientY, 150, Math.max(180, rect.height - 220))
  }
}

function stopResize(): void {
  activeResize = null
  window.removeEventListener('pointermove', onResize)
  window.removeEventListener('pointerup', stopResize)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
</script>

<template>
  <main
    class="app-shell"
    :class="{ dragging: dragActive }"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">tf</div>
        <div>
          <h1>tapeflow</h1>
          <p>DV / HDV merge</p>
        </div>
      </div>

      <section class="action-bar" aria-label="Workspace actions">
        <button class="primary-action" type="button" :disabled="workflow.busy" @click="workflow.pickDir">
          <FolderOpen :size="15" />
          Choose directory
        </button>
        <button class="tool-button" type="button" :disabled="!workflow.dir || workflow.busy" @click="workflow.analyze">
          <RefreshCw :size="15" />
          Re-analyse
        </button>
        <button
          class="tool-button"
          type="button"
          :disabled="!workflow.canExport"
          @click="workflow.exportMerged"
        >
          <Download :size="15" />
          Export merged
        </button>
        <div class="path-chip">
          <HardDrive :size="14" />
          <span>{{ shortPath(workflow.dir) }}</span>
        </div>
        <div v-if="workflow.progressText" class="progress-chip">{{ workflow.progressText }}</div>
      </section>

      <div v-if="workflow.caps" class="cap-strip" aria-label="Capabilities">
        <span class="cap-chip" :class="{ ok: workflow.caps.engines.hdvmerge }">
          <component :is="workflow.caps.engines.hdvmerge ? CheckCircle2 : XCircle" :size="14" />
          hdvmerge
        </span>
        <span class="cap-chip" :class="{ ok: workflow.caps.engines.dvmerge }">
          <component :is="workflow.caps.engines.dvmerge ? CheckCircle2 : XCircle" :size="14" />
          dvmerge
        </span>
        <span class="cap-chip" :class="{ ok: workflow.caps.tools.ffmpeg }">
          <component :is="workflow.caps.tools.ffmpeg ? CheckCircle2 : AlertTriangle" :size="14" />
          ffmpeg
        </span>
        <span class="cap-chip" :class="{ ok: workflow.caps.tools.dvrescue }">
          <component :is="workflow.caps.tools.dvrescue ? CheckCircle2 : AlertTriangle" :size="14" />
          dvrescue
        </span>
      </div>
    </header>

    <p v-if="workflow.error" class="error-banner">
      <AlertTriangle :size="17" />
      <span>{{ workflow.error }}</span>
    </p>

    <BuildPanel v-if="workflow.buildResult" :result="workflow.buildResult" />

    <template v-if="hasWorkspace">
      <section
        class="verdict-band"
        :class="{ complete: workflow.analysis?.complete, warn: !workflow.analysis?.complete }"
      >
        <component :is="workflow.analysis?.complete ? CheckCircle2 : AlertTriangle" :size="24" />
        <div>
          <strong>{{ workflow.verdictText }}</strong>
          <p v-if="workflow.analysis">
            {{ workflow.analysis.tape.title || workflow.analysis.format.toUpperCase() }}
            | {{ workflow.analysis.format.toUpperCase() }} @ {{ workflow.analysis.fps }} fps
            | TC {{ workflow.analysis.tape.tcStart ?? '-' }} - {{ workflow.analysis.tape.tcEnd ?? '-' }}
            | {{ formatDurationFrames(workflow.analysis.tape.durationFrames, workflow.analysis.fps) }}
          </p>
          <p v-else>
            {{ workflow.captureViews.length }} capture files queued
            <span v-if="workflow.busy">| {{ workflow.progressText || 'Analysing' }}</span>
          </p>
        </div>
        <div class="verdict-metrics">
          <span><strong>{{ workflow.outstandingDamage.length }}</strong> outstanding</span>
          <span><strong>{{ workflow.dirtyDamage.length }}</strong> dirty</span>
          <span><strong>{{ missingDuration }}</strong> missing</span>
          <span><strong>{{ workflow.captureViews.length }}</strong> captures</span>
        </div>
      </section>

      <div ref="workspaceRef" class="workspace-grid" :style="workspaceStyle">
        <div ref="leftPaneRef" class="map-column" :style="leftPaneStyle">
          <TapeMap
            v-if="workflow.analysis"
            ref="tapeMapRef"
            :analysis="workflow.analysis"
            :damage-views="workflow.damageViews"
            :selected-key="workflow.selectedDamageKey"
            @select="selectDamage"
          />
          <section v-else class="panel analysis-placeholder">
            <h2>{{ workflow.busy ? 'Analysing workspace' : 'Workspace ready' }}</h2>
            <p>{{ workflow.progressText || 'Run analysis to build the tape map.' }}</p>
          </section>

          <div
            class="split-handle horizontal"
            title="Resize captures panel"
            @pointerdown="startCapturesResize"
          />

          <section v-if="capturesCollapsed" class="collapsed-pane bottom">
            <button class="collapse-button" type="button" title="Show captures" @click="capturesCollapsed = false">
              <ChevronsUp :size="15" />
              Captures
            </button>
          </section>
          <div v-else class="captures-shell">
            <CaptureTable
              :analysis="workflow.analysis"
              :captures="workflow.captureViews"
              @select-capture="selectCapture"
              @collapse="capturesCollapsed = true"
            />
          </div>
        </div>

        <div class="split-handle vertical" title="Resize re-capture panel" @pointerdown="startRightResize" />

        <section v-if="rightCollapsed" class="collapsed-pane right">
          <button class="collapse-button vertical-label" type="button" title="Show re-capture" @click="rightCollapsed = false">
            <ChevronsLeft :size="15" />
            Re-capture
          </button>
        </section>
        <div v-else class="sidebar-shell">
          <DamageSidebar
            :analysis="workflow.analysis"
            :damage-views="workflow.damageViews"
            :selected-key="workflow.selectedDamageKey"
            @select="selectDamage"
            @accept="setAccepted"
            @collapse="rightCollapsed = true"
          />
        </div>
      </div>
    </template>

    <section v-else class="empty-state">
      <UploadCloud :size="34" />
      <h2>Select a tape working directory</h2>
      <p>
        Analyse the overlapping captures for one physical tape, then drop new re-captures here to
        copy them into the workspace and re-run analysis.
      </p>
      <button class="primary-action" type="button" :disabled="workflow.busy" @click="workflow.pickDir">
        <FolderOpen :size="17" />
        Choose directory
      </button>
    </section>

    <div v-if="dragActive" class="drop-overlay">
      <UploadCloud :size="34" />
      <strong>{{ workflow.dir ? 'Drop captures to ingest' : 'Choose a working directory first' }}</strong>
      <span>{{ workflow.dir ? 'Files will be copied in, then analysis runs again.' : 'tapeflow needs a target tape workspace.' }}</span>
    </div>
  </main>
</template>
