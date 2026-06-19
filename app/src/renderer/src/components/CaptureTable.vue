<script setup lang="ts">
import { computed } from 'vue'
import { ChevronsDown, Film, Link2, Unlink } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { Capture, ErrorProfile, TapeAnalysis } from '../types'
import type { WorkspaceCaptureView } from '../stores/workflow'
import { formatRecordingTime } from '../utils/timecode'

const props = defineProps<{
  analysis: TapeAnalysis | null
  captures: WorkspaceCaptureView[]
}>()

const emit = defineEmits<{
  selectCapture: [tag: string]
  collapse: []
}>()

const { t } = useI18n()

// A compact per-capture badge sitting after the filename: just the damage rate (or "clean"); the
// full description — in frame counts, not percentages — is the hover tooltip. DV only (HDV captures
// carry no concealment profile).
function quality(profile?: ErrorProfile): { text: string; level: 'clean' | 'light' | 'heavy'; title: string } | null {
  if (!profile) return null
  const seen = profile.framesSeen
  if (profile.concealedFrac <= 0) {
    return { text: t('captures.quality.clean'), level: 'clean',
             title: t('captures.quality.cleanTip', { seen }) }
  }
  // a non-zero rate that rounds to 0% shows "<1%", so a 1-frame dropout doesn't read as "0%"
  const r = Math.round(profile.concealedFrac * 100)
  const parts = [
    t('captures.quality.damagedTip', { concealed: profile.framesConcealed, seen }),
    t('captures.quality.method', { method: profile.staMethod })
  ]
  if (profile.audioFramesConcealed > 0) {
    parts.push(t('captures.quality.audioTip', { audio: profile.audioFramesConcealed }))
  }
  if (profile.evenSharePct >= 0.65) parts.push(t('captures.quality.headEven'))
  else if (profile.evenSharePct <= 0.35) parts.push(t('captures.quality.headOdd'))
  return { text: r === 0 ? '<1%' : `${r}%`, level: r >= 50 ? 'heavy' : 'light', title: parts.join(' · ') }
}

const sortedAnalysisCaptures = computed<Capture[]>(() => {
  if (!props.analysis) return []
  const originalOrder = new Map(props.analysis.captures.map((capture, index) => [capture.tag, index]))
  const mtimes = new Map(props.captures.map((capture) => [capture.file, capture.mtimeMs]))
  return [...props.analysis.captures].sort(
    (a, b) => compareMtime(mtimes.get(a.file), mtimes.get(b.file))
      || (originalOrder.get(a.tag) ?? 0) - (originalOrder.get(b.tag) ?? 0)
  )
})

// each row with its badge computed once (vs calling quality() repeatedly in the template)
const rows = computed(() =>
  sortedAnalysisCaptures.value.map((capture) => ({ capture, quality: quality(capture.errorProfile) }))
)

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
        <p v-if="analysis">{{ $t('captures.count', { count: analysis.captures.length }) }}</p>
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
            v-for="row in rows"
            :key="row.capture.tag"
            class="selectable-row"
            @click="emit('selectCapture', row.capture.tag)"
          >
            <td>
              <div class="file-cell">
                <Film :size="16" />
                <div class="file-meta">
                  <strong :title="captureTitle(row.capture.file, row.capture.tag)">{{ row.capture.file }}</strong>
                  <span
                    v-if="row.quality"
                    class="cap-quality"
                    :class="row.quality.level"
                    :title="row.quality.title"
                  >{{ row.quality.text }}</span>
                </div>
              </div>
            </td>
            <td class="mono">{{ row.capture.tcSpan[0] ?? '-' }} - {{ row.capture.tcSpan[1] ?? '-' }}</td>
            <td class="mono">{{ formatRecordingTime(row.capture.recSpan[0]) }} - {{ formatRecordingTime(row.capture.recSpan[1]) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

  </section>
</template>

<style scoped>
/* filename + its quality badge on one line; the name ellipsizes, the badge stays put */
.file-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.file-meta strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* a small pill matching the app's badge family (link-badge / archive-badge): green = clean,
   amber = some damage, red = heavily concealed — so the column scans at a glance */
.cap-quality {
  flex: none;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 0 7px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.7;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  cursor: help;
}
.cap-quality.clean {
  border-color: var(--accent-border);
  background: var(--accent-bg);
  color: var(--accent);
}
.cap-quality.light {
  border-color: var(--warn-border);
  background: var(--warn-bg);
  color: var(--warn);
}
.cap-quality.heavy {
  border-color: var(--danger-border);
  background: var(--danger-bg);
  color: var(--danger);
}
</style>
