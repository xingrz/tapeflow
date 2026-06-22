<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronsRight, Clipboard, RotateCcw } from '@lucide/vue'
import type { DamageSpot, TapeAnalysis } from '../types'
import type { DamageView } from '../stores/workflow'
import DamageThumbnail from './DamageThumbnail.vue'
import DamageLightbox from './DamageLightbox.vue'
import { formatDurationFrames } from '../utils/format'
import { formatRecordingTime } from '../utils/timecode'

const props = defineProps<{
  analysis: TapeAnalysis | null
  damageViews: DamageView[]
  selectedKey: string | null
}>()

// A 'decode' spot carries its sub-kind (residual/stitch/transport/unexplained) in `severity`; localise
// it plus the right next step. Other kinds use the engine's own severity text.
function severityText(view: DamageView): string {
  if (view.spot.kind === 'decode') {
    const sub = view.spot.severity
    const step = sub === 'unexplained' ? 'investigate' : 'recapture'
    return `${t('verify.spotKind.' + sub)} · ${t('verify.spotHint.' + step)}`
  }
  return view.spot.severity || t('recapture.damage')
}

const emit = defineEmits<{
  select: [key: string]
  accept: [view: DamageView, accepted: boolean]
  collapse: []
}>()

const { t } = useI18n()
const list = ref<HTMLElement | null>(null)

const sortedViews = computed(() =>
  [...props.damageViews].sort((a, b) => {
    if (a.status === 'accepted' && b.status !== 'accepted') return 1
    if (a.status !== 'accepted' && b.status === 'accepted') return -1
    return a.spot.axis[0] - b.spot.axis[0]
  })
)

watch(
  () => props.selectedKey,
  () => void nextTick(scrollSelectedIntoView)
)

function coverageLabel(view: DamageView): string {
  if (view.spot.copies === 0) return t('recapture.copiesRequired')
  return t('recapture.dirtyCopies', view.spot.copies)
}

const copiedKey = ref<string | null>(null)
let copyTimer: ReturnType<typeof setTimeout> | undefined

async function copyTc(view: DamageView): Promise<void> {
  const value = view.spot.tcStart
  if (!value) return
  try {
    await navigator.clipboard?.writeText(value)
    copiedKey.value = view.key
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copiedKey.value = null
    }, 1200)
  } catch {
    /* clipboard unavailable — ignore */
  }
}

const lightboxSpot = ref<DamageSpot | null>(null)

onUnmounted(() => clearTimeout(copyTimer))

function scrollSelectedIntoView(): void {
  if (!props.selectedKey || !list.value) return
  const row = list.value.querySelector<HTMLElement>(`[data-key="${CSS.escape(props.selectedKey)}"]`)
  row?.scrollIntoView({ block: 'nearest' })
}
</script>

<template>
  <aside class="panel damage-sidebar" aria-label="Re-capture list">
    <div class="panel-title-row">
      <div>
        <h2>{{ $t('recapture.title') }}</h2>
        <p v-if="damageViews.length">{{ $t('recapture.regions', { count: damageViews.length }) }}</p>
        <p v-else>{{ $t('recapture.noRegions') }}</p>
      </div>
      <button class="panel-action" type="button" :title="$t('recapture.collapse')" @click="emit('collapse')">
        <ChevronsRight :size="15" />
      </button>
    </div>

    <div v-if="sortedViews.length" ref="list" class="damage-list">
      <article
        v-for="view in sortedViews"
        :key="view.key"
        :data-key="view.key"
        class="damage-card"
        :class="{
          selected: selectedKey === view.key,
          accepted: view.status === 'accepted',
          missing: view.spot.kind === 'missing',
          decode: view.spot.kind === 'decode'
        }"
        @click="emit('select', view.key)"
      >
        <DamageThumbnail
          v-if="analysis"
          :analysis="analysis"
          :spot="view.spot"
          @enlarge="lightboxSpot = view.spot"
        />
        <div v-else class="thumb empty" />
        <div class="damage-main">
          <div class="damage-topline">
            <button
              class="tc-copy"
              :class="{ copied: copiedKey === view.key }"
              type="button"
              :title="copiedKey === view.key ? $t('recapture.copied') : $t('recapture.copy')"
              @click.stop="copyTc(view)"
            >
              <span>{{ view.spot.tcStart ?? $t('recapture.noTc') }}</span>
              <component :is="copiedKey === view.key ? Check : Clipboard" :size="14" />
            </button>
            <span class="status-pill" :class="view.spot.kind">{{ $t(`kind.${view.spot.kind}`) }}</span>
            <button
              class="plain-action"
              type="button"
              :title="view.status === 'accepted' ? $t('recapture.markOutstanding') : $t('recapture.acceptUnrecoverable')"
              @click.stop="emit('accept', view, view.status !== 'accepted')"
            >
              <component :is="view.status === 'accepted' ? RotateCcw : Check" :size="13" />
              {{ view.status === 'accepted' ? $t('recapture.undo') : $t('recapture.accept') }}
            </button>
          </div>
          <div class="damage-meta">
            <span>{{ formatRecordingTime(view.spot.recStart) }}</span>
            <span>{{ formatDurationFrames(view.spot.durationFrames, analysis?.fps ?? 25) }}</span>
            <span>{{ coverageLabel(view) }}</span>
          </div>
          <div class="severity-line">{{ severityText(view) }}</div>
        </div>
      </article>
    </div>

    <div v-else class="empty-state compact">
      <Check :size="20" />
      <p>{{ $t('recapture.nothing') }}</p>
    </div>
  </aside>

  <DamageLightbox
    v-if="lightboxSpot && analysis"
    :analysis="analysis"
    :spot="lightboxSpot"
    @close="lightboxSpot = null"
  />
</template>
