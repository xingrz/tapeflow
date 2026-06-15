<script setup lang="ts">
import { Loader2 } from '@lucide/vue'
import type { TaskView } from '../stores/workflow'
import { formatEta, formatSpeed } from '../utils/format'

defineProps<{
  open: boolean
  tasks: TaskView[]
}>()
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay tasks-overlay">
      <div class="modal-panel tasks-panel" @click.stop>
        <div class="modal-head">
          <h2>
            <Loader2 :size="16" class="spin" />
            {{ $t('tasks.title') }}
          </h2>
        </div>
        <p class="tasks-hint">{{ $t('tasks.hint') }}</p>
        <ul class="task-list">
          <li v-for="task in tasks" :key="task.file" class="task-row">
            <div class="task-line">
              <span class="task-file" :title="task.file">
                {{ task.stage === 'merging' ? $t('tasks.dvLabel') : task.file }}
              </span>
              <span class="task-stage" :class="task.stage">{{ $t(`tasks.stage.${task.stage}`) }}</span>
            </div>
            <div class="progress-track">
              <div
                class="progress-fill"
                :class="{ indeterminate: !task.determinate && task.stage !== 'done' && task.stage !== 'pending' }"
                :style="task.stage === 'pending'
                  ? { width: '0%' }
                  : task.determinate || task.stage === 'done'
                    ? { width: `${Math.round(task.progress * 100)}%` }
                    : undefined"
              />
            </div>
            <div class="task-meta">
              <span v-if="task.determinate && task.stage !== 'done'" class="task-pct">
                {{ Math.round(task.progress * 100) }}%
              </span>
              <span v-if="task.bytesPerSec">{{ formatSpeed(task.bytesPerSec) }}</span>
              <span v-if="task.etaSec != null">{{ $t('tasks.remaining', { eta: formatEta(task.etaSec) }) }}</span>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tasks-overlay {
  /* a blocking overlay — no click-to-dismiss; it closes itself when every task is done */
  cursor: progress;
}
.tasks-panel {
  width: min(560px, 92vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}
.tasks-panel .modal-head h2 {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tasks-hint {
  margin: 0 0 14px;
  color: var(--text-muted, #9aa6a0);
  font-size: 13px;
}
.task-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
}
.task-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.task-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.task-file {
  font-weight: 600;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-stage {
  flex: none;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted, #9aa6a0);
}
.task-stage.copying {
  color: var(--accent, #5fb0ff);
}
.task-stage.indexing,
.task-stage.merging {
  color: var(--warn, #e0a23a);
}
.task-stage.done {
  color: var(--ok, #4fbf6b);
}
.task-meta {
  display: flex;
  gap: 12px;
  font-size: 11px;
  /* reserve the line even when empty (a queued row has no %/speed/ETA) so a row keeps the same
     height through pending -> indexing and the modal doesn't grow/shrink on every transition */
  min-height: 15px;
  color: var(--text-muted, #9aa6a0);
  font-variant-numeric: tabular-nums;
}
.task-pct {
  min-width: 34px;
}
</style>
