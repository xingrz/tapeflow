<script setup lang="ts">
import { computed } from 'vue'
import { ChevronsDown, Film, Link2, Unlink } from '@lucide/vue'
import type { Capture, TapeAnalysis } from '../types'
import type { WorkspaceCaptureView } from '../stores/workflow'
import { formatBytes } from '../utils/format'
import { formatRecordingTime } from '../utils/timecode'

const props = defineProps<{
  analysis: TapeAnalysis | null
  captures: WorkspaceCaptureView[]
}>()

const emit = defineEmits<{
  selectCapture: [tag: string]
  collapse: []
}>()

const sortedAnalysisCaptures = computed<Capture[]>(() => {
  if (!props.analysis) return []
  const originalOrder = new Map(props.analysis.captures.map((capture, index) => [capture.tag, index]))
  const mtimes = new Map(props.captures.map((capture) => [capture.file, capture.mtimeMs]))
  return [...props.analysis.captures].sort(
    (a, b) => compareMtime(mtimes.get(a.file), mtimes.get(b.file))
      || (originalOrder.get(a.tag) ?? 0) - (originalOrder.get(b.tag) ?? 0)
  )
})

function captureTitle(file: string, tag?: string): string {
  if (!tag || tag === file || tag === stem(file)) return file
  return `${file} (${tag})`
}

function stem(file: string): string {
  return file.replace(/\.[^.]+$/, '')
}

function compareMtime(a: number | undefined, b: number | undefined): number {
  const af = Number.isFinite(a) ? a as number : null
  const bf = Number.isFinite(b) ? b as number : null
  if (af != null && bf != null && af !== bf) return af - bf
  if (af != null && bf == null) return -1
  if (af == null && bf != null) return 1
  return 0
}
</script>

<template>
  <section class="panel capture-panel" aria-label="Captures">
    <div class="panel-title-row">
      <div>
        <div class="heading-line">
          <h2>{{ $t('captures.title') }}</h2>
          <span
            v-if="analysis"
            class="link-badge"
            :class="{ warn: analysis.summary.unusedCaptures }"
            :title="analysis.summary.unusedCaptures
              ? $t('captures.unplacedTip', { count: analysis.summary.unusedCaptures })
              : $t('captures.linkedTip')"
          >
            <component :is="analysis.summary.unusedCaptures ? Unlink : Link2" :size="12" />
            {{ analysis.summary.unusedCaptures ? $t('captures.unplaced', { count: analysis.summary.unusedCaptures }) : $t('captures.allLinked') }}
          </span>
        </div>
        <p v-if="analysis">{{ analysis.segments.length
          ? $t('captures.lanesSegments', { lanes: analysis.captures.length, segments: analysis.segments.length })
          : $t('captures.lanesDvMerge', { lanes: analysis.captures.length }) }}</p>
        <p v-else>{{ $t('captures.filesInWorkspace', { count: captures.length }) }}</p>
      </div>
      <button class="panel-action" type="button" :title="$t('captures.collapse')" @click="emit('collapse')">
        <ChevronsDown :size="15" />
      </button>
    </div>

    <div v-if="analysis" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ $t('captures.file') }}</th>
            <th>{{ $t('captures.tapeTc') }}</th>
            <th>{{ $t('captures.recordingTime') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="capture in sortedAnalysisCaptures"
            :key="capture.tag"
            class="selectable-row"
            @click="emit('selectCapture', capture.tag)"
          >
            <td>
              <div class="file-cell">
                <Film :size="16" />
                <div>
                  <strong :title="captureTitle(capture.file, capture.tag)">{{ capture.file }}</strong>
                </div>
              </div>
            </td>
            <td class="mono">{{ capture.tcSpan[0] ?? '-' }} - {{ capture.tcSpan[1] ?? '-' }}</td>
            <td class="mono">{{ formatRecordingTime(capture.recSpan[0]) }} - {{ formatRecordingTime(capture.recSpan[1]) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ $t('captures.file') }}</th>
            <th>{{ $t('captures.format') }}</th>
            <th>{{ $t('captures.size') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="capture in captures" :key="capture.file">
            <td>
              <div class="file-cell">
                <Film :size="16" />
                <div>
                  <strong :title="capture.file">{{ capture.file }}</strong>
                </div>
              </div>
            </td>
            <td>{{ capture.format.toUpperCase() }}</td>
            <td>{{ formatBytes(capture.sizeBytes) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

  </section>
</template>
