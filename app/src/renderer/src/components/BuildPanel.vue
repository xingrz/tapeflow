<script setup lang="ts">
import { AlertTriangle, CheckCircle2 } from '@lucide/vue'
import type { BuildResult } from '../types'
import { formatBytes, verifySummary } from '../utils/format'

defineProps<{
  result: BuildResult
}>()
</script>

<template>
  <section class="build-panel" :class="{ ok: result.ok, warn: !result.ok }" aria-label="Export result">
    <component :is="result.ok ? CheckCircle2 : AlertTriangle" :size="20" />
    <div>
      <strong>{{ result.ok ? 'Export completed' : 'Export completed with warnings' }}</strong>
      <p>{{ formatBytes(result.sizeBytes) }} | {{ verifySummary(result.verify) }}</p>
      <code>{{ result.output }}</code>
    </div>
  </section>
</template>
