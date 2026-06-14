<script setup lang="ts">
import { computed } from 'vue'
import { ChevronsDown, Film, Link2, Unlink } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { Capture, ErrorProfile, TapeAnalysis } from '../types'
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

const { t } = useI18n()

// A compact per-capture quality chip from the DV error-concealment profile: how heavily concealed
// (persistent vs intermittent), and an azimuth-head bias note when the damage favours one field.
function quality(profile?: ErrorProfile): { text: string; level: 'warn' | 'note'; title: string } | null {
  if (!profile || profile.concealedFrac <= 0) return null
  const pct = (v: number): string => `${Math.round(v * 100)}%`
  const persistent = profile.concealedFrac >= 0.7
  const text = persistent
    ? t('captures.quality.persistent', { pct: pct(profile.avgConcealedPct) })
    : t('captures.quality.intermittent', { pct: pct(profile.concealedFrac) })
  const bias =
    profile.evenSharePct >= 0.65
      ? t('captures.quality.headEven')
      : profile.evenSharePct <= 0.35
        ? t('captures.quality.headOdd')
        : ''
  const title = t('captures.quality.tip', {
    method: profile.staMethod,
    concealed: profile.framesConcealed,
    seen: profile.framesSeen,
    even: pct(profile.evenSharePct)
  })
  return { text: bias ? `${text} · ${bias}` : text, level: persistent ? 'warn' : 'note', title }
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
                  <span
                    v-if="quality(capture.errorProfile)"
                    class="cap-quality"
                    :class="quality(capture.errorProfile)!.level"
                    :title="quality(capture.errorProfile)!.title"
                  >{{ quality(capture.errorProfile)!.text }}</span>
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

<style scoped>
.cap-quality {
  display: inline-block;
  margin-top: 2px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1.5;
  white-space: nowrap;
  cursor: help;
}
.cap-quality.warn {
  color: var(--warn, #e0a23a);
  background: color-mix(in srgb, var(--warn, #e0a23a) 16%, transparent);
}
.cap-quality.note {
  color: var(--text-muted, #9aa6a0);
  background: color-mix(in srgb, var(--text-muted, #9aa6a0) 14%, transparent);
}
</style>
