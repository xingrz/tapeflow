<script setup lang="ts">
import { AlertTriangle, CheckCircle2, X } from '@lucide/vue'
import type { BuildResult } from '../types'
import { formatBytes, verifySummary } from '../utils/format'

defineProps<{
  result: BuildResult
}>()

const emit = defineEmits<{ dismiss: [] }>()
</script>

<template>
  <section class="build-panel" :class="{ ok: result.ok, warn: !result.ok }" aria-label="Export result">
    <component :is="result.ok ? CheckCircle2 : AlertTriangle" :size="20" />
    <div class="build-panel-body">
      <strong>{{ result.ok ? $t('build.completed') : $t('build.completedWarnings') }}</strong>
      <p>{{ formatBytes(result.sizeBytes) }} | {{ verifySummary(result.verify) }}</p>
      <code>{{ result.output }}</code>
    </div>
    <button class="banner-close" type="button" :title="$t('build.dismiss')" @click="emit('dismiss')">
      <X :size="15" />
    </button>
  </section>
</template>
