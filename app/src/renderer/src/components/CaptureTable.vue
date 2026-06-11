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
          <h2>Captures</h2>
          <span
            v-if="analysis"
            class="link-badge"
            :class="{ warn: analysis.summary.unusedCaptures }"
            :title="analysis.summary.unusedCaptures
              ? `${analysis.summary.unusedCaptures} capture(s) could not be placed onto the tape and are not in the merged output.`
              : 'Every capture the engine placed is represented on the tape map above.'"
          >
            <component :is="analysis.summary.unusedCaptures ? Unlink : Link2" :size="12" />
            {{ analysis.summary.unusedCaptures ? `${analysis.summary.unusedCaptures} unplaced` : 'All linked' }}
          </span>
        </div>
        <p v-if="analysis">{{ analysis.captures.length }} lanes | {{ analysis.segments.length || 'DV frame merge' }} output segments</p>
        <p v-else>{{ captures.length }} files in workspace</p>
      </div>
      <button class="panel-action" type="button" title="Collapse captures" @click="emit('collapse')">
        <ChevronsDown :size="15" />
      </button>
    </div>

    <div v-if="analysis" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Tape TC</th>
            <th>Recording time</th>
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
            <th>File</th>
            <th>Format</th>
            <th>Size</th>
            <th>Index</th>
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
            <td><span class="index-status" :class="capture.status">{{ capture.status }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>

  </section>
</template>
