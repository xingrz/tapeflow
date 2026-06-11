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

const request = computed(() => thumbnailRequest(props.analysis, props.spot))

watch(
  () => [props.analysis.dir, props.spot.id, request.value?.file, request.value?.seconds] as const,
  () => void load(),
  { immediate: true }
)

async function load(): Promise<void> {
  dataUrl.value = ''
  error.value = ''
  const req = request.value
  if (!req) return
  loading.value = true
  try {
    const thumb = await window.api.thumbnail(props.analysis.dir, req.file, req.seconds)
    dataUrl.value = thumb.dataUrl
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
    :title="dataUrl ? 'Click to enlarge' : error || 'No frame for this spot'"
    @click.stop="onClick"
  >
    <img v-if="dataUrl" :src="dataUrl" alt="" />
    <span v-else-if="loading" class="thumb-loading">Loading</span>
    <span v-else class="thumb-empty">
      <ImageOff :size="18" />
    </span>
  </div>
</template>
