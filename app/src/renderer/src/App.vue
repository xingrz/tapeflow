<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronsLeft,
  ChevronsUp,
  Download,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  Settings,
  UploadCloud,
  X
} from '@lucide/vue'
import BuildPanel from './components/BuildPanel.vue'
import CaptureTable from './components/CaptureTable.vue'
import DamageSidebar from './components/DamageSidebar.vue'
import TapeMap from './components/TapeMap.vue'
import { useWorkflowStore, type DamageView } from './stores/workflow'
import { formatDurationFrames } from './utils/format'
import { LANG_PREFS, langPref, setLangPref, type LangPref } from './i18n'

const workflow = useWorkflowStore()
const settingsOpen = ref(false)
const langChoice = ref<LangPref>(langPref())
function applyLang(): void {
  setLangPref(langChoice.value)
}

// just the workspace folder's own name (the full path is the tooltip) — the topbar shows this
// centred instead of a long, cramped path
const dirName = computed(() => {
  const d = workflow.dir
  if (!d) return ''
  const parts = d.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || d
})

// external tools (ffmpeg / dvrescue) and their detected versions, for the Settings dialog
const toolList = computed(() =>
  Object.entries(workflow.caps?.tools ?? {}).map(([name, info]) => ({
    name,
    present: info.present,
    version: info.version
  }))
)
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
      <div class="topbar-actions" aria-label="Workspace actions">
        <button class="icon-button accent" type="button" :title="$t('app.chooseDir')" :disabled="workflow.busy" @click="workflow.pickDir">
          <FolderOpen :size="16" />
        </button>
        <button class="icon-button" type="button" :title="$t('app.reAnalyse')" :disabled="!workflow.dir || workflow.busy" @click="workflow.analyze">
          <RefreshCw :size="16" />
        </button>
        <button class="icon-button" type="button" :title="$t('app.exportMerged')" :disabled="!workflow.canExport" @click="workflow.exportMerged">
          <Download :size="16" />
        </button>
      </div>

      <div class="topbar-center">
        <template v-if="workflow.busy && workflow.progressText">
          <Loader2 :size="14" class="spin" />
          <span class="center-progress">{{ workflow.progressText }}</span>
        </template>
        <template v-else-if="workflow.dir">
          <span class="path-name" :title="workflow.dir">
            <HardDrive :size="13" />
            {{ dirName }}
          </span>
          <button class="icon-button ghost" type="button" :title="$t('app.revealDir')" @click="workflow.revealDir">
            <ExternalLink :size="14" />
          </button>
        </template>
      </div>

      <div class="topbar-end">
        <button class="icon-button" type="button" :title="$t('app.settings')" @click="settingsOpen = true">
          <Settings :size="16" />
        </button>
      </div>
    </header>

    <p v-if="workflow.error" class="error-banner">
      <AlertTriangle :size="17" />
      <span>{{ workflow.error }}</span>
    </p>

    <section v-if="workflow.building" class="build-progress" aria-label="Export progress">
      <Loader2 :size="18" class="spin" />
      <div class="build-progress-body">
        <strong>{{ workflow.buildProgress == null ? $t('build.verifying') : $t('build.building') }}</strong>
        <div class="progress-track">
          <div
            class="progress-fill"
            :class="{ indeterminate: workflow.buildProgress == null }"
            :style="workflow.buildProgress == null ? undefined : { width: `${Math.round(workflow.buildProgress * 100)}%` }"
          />
        </div>
      </div>
      <span v-if="workflow.buildProgress != null" class="build-progress-pct">
        {{ Math.round(workflow.buildProgress * 100) }}%
      </span>
    </section>

    <BuildPanel
      v-if="workflow.buildResult"
      :result="workflow.buildResult"
      @dismiss="workflow.dismissBuildResult"
    />

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
            {{ $t('verdict.queued', { count: workflow.captureViews.length }) }}
            <span v-if="workflow.busy">| {{ workflow.progressText || $t('verdict.analysing') }}</span>
          </p>
        </div>
        <div class="verdict-metrics">
          <span><strong>{{ workflow.outstandingDamage.length }}</strong> {{ $t('metrics.outstanding') }}</span>
          <span><strong>{{ workflow.dirtyDamage.length }}</strong> {{ $t('metrics.dirty') }}</span>
          <span><strong>{{ missingDuration }}</strong> {{ $t('metrics.missing') }}</span>
          <span><strong>{{ workflow.captureViews.length }}</strong> {{ $t('metrics.captures') }}</span>
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
            :title="$t('app.resizeCaptures')"
            @pointerdown="startCapturesResize"
          />

          <section v-if="capturesCollapsed" class="collapsed-pane bottom">
            <button class="collapse-button" type="button" :title="$t('app.showCaptures')" @click="capturesCollapsed = false">
              <ChevronsUp :size="15" />
              {{ $t('captures.show') }}
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

        <div class="split-handle vertical" :title="$t('app.resizeRecapture')" @pointerdown="startRightResize" />

        <section v-if="rightCollapsed" class="collapsed-pane right">
          <button class="collapse-button vertical-label" type="button" :title="$t('app.showRecapture')" @click="rightCollapsed = false">
            <ChevronsLeft :size="15" />
            {{ $t('recapture.show') }}
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
      <h2>{{ $t('empty.title') }}</h2>
      <p>{{ $t('empty.body') }}</p>
      <button class="primary-action" type="button" :disabled="workflow.busy" @click="workflow.pickDir">
        <FolderOpen :size="17" />
        {{ $t('app.chooseDir') }}
      </button>
    </section>

    <div v-if="dragActive" class="drop-overlay">
      <UploadCloud :size="34" />
      <strong>{{ workflow.dir ? $t('drop.ingest') : $t('drop.chooseFirst') }}</strong>
      <span>{{ workflow.dir ? $t('drop.willCopy') : $t('drop.needWorkspace') }}</span>
    </div>

    <Teleport to="body">
      <div v-if="settingsOpen" class="modal-overlay" @click="settingsOpen = false">
        <div class="modal-panel" @click.stop>
          <div class="modal-head">
            <h2>{{ $t('settings.title') }}</h2>
            <button class="banner-close" type="button" :title="$t('settings.close')" @click="settingsOpen = false">
              <X :size="16" />
            </button>
          </div>
          <div class="setting-row">
            <span class="setting-label">{{ $t('settings.language') }}</span>
            <div class="setting-options">
              <label v-for="p in LANG_PREFS" :key="p" class="radio-option" :class="{ active: langChoice === p }">
                <input v-model="langChoice" type="radio" :value="p" @change="applyLang" />
                <span>{{ $t(`lang.${p}`) }}</span>
              </label>
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-label">{{ $t('settings.tools') }}</span>
            <p class="setting-hint">{{ $t('settings.toolsHint') }}</p>
            <div class="tool-list">
              <div v-for="tool in toolList" :key="tool.name" class="tool-line">
                <span class="tool-name">{{ tool.name }}</span>
                <span class="tool-ver" :class="{ missing: !tool.present }">
                  <component :is="tool.present ? CheckCircle2 : AlertTriangle" :size="13" />
                  {{ tool.present ? (tool.version || $t('settings.toolPresent')) : $t('settings.toolMissing') }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </main>
</template>
