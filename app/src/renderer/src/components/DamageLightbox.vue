<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from '@lucide/vue'
import type { DamageSpot, TapeAnalysis } from '../types'
import { thumbnailRequest } from '../utils/analysis'

const props = defineProps<{
  analysis: TapeAnalysis
  spot: DamageSpot
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

const annotatedUrl = ref('') // plain frame + outline/tint over the concealed regions
const plainUrl = ref('') // the untouched frame, shown while comparing
const canCompare = ref(false)
const comparing = ref(false)
const failed = ref(false)

const label = ref('')

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image decode failed'))
    img.src = url
  })
}

// dvplay paints error-concealment as pure yellow (255,255,18). Derive that mask from the
// highlighted frame, then draw it onto the *plain* frame as a 2px bright outline + light tint
// (with a dark outer halo for contrast on any footage) so the damaged region is marked without
// the solid fill hiding what it actually looks like.
function annotate(hi: HTMLImageElement, plain: HTMLImageElement): string | null {
  const w = hi.naturalWidth || hi.width
  const h = hi.naturalHeight || hi.height
  if (!w || !h) return null
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  ctx.drawImage(hi, 0, 0, w, h)
  const hiData = ctx.getImageData(0, 0, w, h).data
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(plain, 0, 0, w, h) // scale the plain frame onto the highlighted frame's grid
  const baseImg = ctx.getImageData(0, 0, w, h)
  const base = baseImg.data

  const n = w * h
  const mask = new Uint8Array(n)
  let hits = 0
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    // pure dvplay yellow, and genuinely different from the plain decode (so naturally
    // yellow footage that ffmpeg also shows yellow there isn't mistaken for damage)
    if (
      hiData[i] > 235 &&
      hiData[i + 1] > 235 &&
      hiData[i + 2] < 70 &&
      Math.abs(hiData[i] - base[i]) +
        Math.abs(hiData[i + 1] - base[i + 1]) +
        Math.abs(hiData[i + 2] - base[i + 2]) >
        90
    ) {
      mask[p] = 1
      hits++
    }
  }
  if (!hits) return null // dvplay flagged the spot but this exact frame is clean — show plain

  const R = 2
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      let hasMasked = false
      let hasUnmasked = false
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) {
            hasUnmasked = true
          } else if (mask[yy * w + xx]) {
            hasMasked = true
          } else {
            hasUnmasked = true
          }
        }
      }
      const i = p * 4
      if (mask[p]) {
        if (hasUnmasked) {
          // inner border band -> bright yellow outline
          base[i] = 255
          base[i + 1] = 221
          base[i + 2] = 0
        } else {
          // interior -> light tint, the (concealed) content still shows through
          base[i] = base[i] * 0.8 + 51
          base[i + 1] = base[i + 1] * 0.8 + 45
          base[i + 2] = base[i + 2] * 0.8
        }
      } else if (hasMasked) {
        // just outside the region -> dark halo so the outline reads on bright footage too
        base[i] = base[i] * 0.35
        base[i + 1] = base[i + 1] * 0.35
        base[i + 2] = base[i + 2] * 0.35
      }
    }
  }
  ctx.putImageData(baseImg, 0, 0)
  return cv.toDataURL('image/jpeg', 0.92)
}

async function build(): Promise<void> {
  annotatedUrl.value = ''
  plainUrl.value = ''
  canCompare.value = false
  comparing.value = false
  failed.value = false
  label.value = `${props.spot.tcStart ?? ''} · ${props.spot.severity || t('recapture.damage')}`

  const req = thumbnailRequest(props.analysis, props.spot)
  if (!req) {
    failed.value = true
    return
  }
  try {
    const hi = await window.api.damageFrame(props.analysis.dir, req.file, req.seconds, props.analysis.fps)
    if (hi.highlighted) {
      // DV: derive the outline from dvplay's yellow and lay it over a plain frame of equal size
      const plain = await window.api.thumbnail(props.analysis.dir, req.file, req.seconds, 720)
      const [hiImg, plainImg] = await Promise.all([loadImage(hi.dataUrl), loadImage(plain.dataUrl)])
      const marked = annotate(hiImg, plainImg)
      plainUrl.value = plain.dataUrl
      annotatedUrl.value = marked ?? plain.dataUrl
      canCompare.value = marked !== null
    } else {
      // HDV / no dvplay: nothing to mark, just a crisp plain frame
      const plain = await window.api.thumbnail(props.analysis.dir, req.file, req.seconds, 1280)
      plainUrl.value = plain.dataUrl
      annotatedUrl.value = plain.dataUrl
    }
  } catch {
    failed.value = true
  }
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
  else if (e.code === 'Space' && canCompare.value) {
    e.preventDefault()
    comparing.value = true
  }
}

function onKeyUp(e: KeyboardEvent): void {
  if (e.code === 'Space') comparing.value = false
}

watch(() => [props.spot.id, props.analysis.dir], () => void build(), { immediate: true })

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
})
</script>

<template>
  <Teleport to="body">
    <div class="lightbox" @click="emit('close')">
      <div class="lightbox-inner" @click.stop>
        <button class="lightbox-close" type="button" :title="$t('recapture.close')" @click="emit('close')">
          <X :size="18" />
        </button>
        <div
          v-if="annotatedUrl"
          class="lightbox-stage"
          :class="{ comparable: canCompare }"
          @pointerdown="canCompare && (comparing = true)"
          @pointerup="comparing = false"
          @pointerleave="comparing = false"
          @pointercancel="comparing = false"
        >
          <img :src="comparing ? plainUrl : annotatedUrl" alt="" draggable="false" />
          <span v-if="canCompare" class="lightbox-hint">
            {{ comparing ? $t('recapture.showingOriginal') : $t('recapture.holdToCompare') }}
          </span>
        </div>
        <div v-else-if="failed" class="lightbox-loading">{{ $t('thumb.noFrame') }}</div>
        <div v-else class="lightbox-loading">{{ $t('recapture.loadingFrame') }}</div>
        <p class="lightbox-label">{{ label }}</p>
      </div>
    </div>
  </Teleport>
</template>
