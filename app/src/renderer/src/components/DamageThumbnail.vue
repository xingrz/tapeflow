<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ImageOff } from '@lucide/vue'
import type { DamageSpot, TapeAnalysis } from '../types'
import { thumbnailRequest } from '../utils/analysis'

const props = defineProps<{
  analysis: TapeAnalysis
  spot: DamageSpot
}>()

const emit = defineEmits<{
  enlarge: []
}>()

const loading = ref(false)
const error = ref('')
const dataUrl = ref('')
const highlighted = ref(false)

const request = computed(() => thumbnailRequest(props.analysis, props.spot))

watch(
  () => [props.analysis.dir, props.spot.id, request.value?.file, request.value?.seconds] as const,
  () => void load(),
  { immediate: true }
)

async function load(): Promise<void> {
  dataUrl.value = ''
  error.value = ''
  highlighted.value = false
  const req = request.value
  if (!req) return
  loading.value = true
  try {
    // DV frames come back with the error-concealment regions highlighted (dvplay); HDV is plain
    const thumb = await window.api.damageFrame(
      props.analysis.dir,
      req.file,
      req.seconds,
      props.analysis.fps
    )
    dataUrl.value = thumb.dataUrl
    highlighted.value = !!thumb.highlighted
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function onClick(): void {
  if (dataUrl.value) emit('enlarge')
}
</script>

<template>
  <div
    class="thumb"
    :class="{ empty: !dataUrl, clickable: !!dataUrl }"
    :title="dataUrl ? (highlighted ? $t('thumb.highlighted') : $t('thumb.enlarge')) : error || $t('thumb.noFrame')"
    @click.stop="onClick"
  >
    <img v-if="dataUrl" :src="dataUrl" alt="" />
    <span v-else-if="loading" class="thumb-loading">{{ $t('thumb.loading') }}</span>
    <span v-else class="thumb-empty">
      <ImageOff :size="18" />
    </span>
  </div>
</template>
