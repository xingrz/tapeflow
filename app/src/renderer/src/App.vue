<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { Capabilities, Progress, TapeAnalysis } from './types'

// NOTE: deliberately plain ("ugly-first"). The job here is correct data binding to
// tapeflow.analysis/1; the Canvas tape-map and visual polish are the follow-up (see AGENTS.md).

const caps = ref<Capabilities | null>(null)
const dir = ref<string | null>(null)
const analysis = ref<TapeAnalysis | null>(null)
const progress = ref<string>('')
const error = ref<string>('')
const busy = ref(false)

let unsub: (() => void) | null = null

onMounted(async () => {
  unsub = window.api.onProgress((p) => {
    const pr = p as Progress
    if (pr.phase === 'indexing' && pr.total) {
      progress.value = `indexing ${Math.floor((100 * (pr.done ?? 0)) / pr.total)}%`
    } else if (pr.phase === 'indexed') {
      progress.value = `indexed ${pr.file}${pr.cached ? ' (cached)' : ''}`
    } else {
      progress.value = pr.phase
    }
  })
  try {
    caps.value = await window.api.capabilities()
  } catch (e) {
    error.value = String(e)
  }
})

onUnmounted(() => unsub?.())

async function pickDir() {
  const d = await window.api.pickDir()
  if (d) {
    dir.value = d
    await analyze()
  }
}

async function analyze() {
  if (!dir.value || busy.value) return
  busy.value = true
  error.value = ''
  progress.value = 'starting…'
  try {
    analysis.value = await window.api.analyze(dir.value)
  } catch (e) {
    error.value = String(e)
    analysis.value = null
  } finally {
    busy.value = false
    progress.value = ''
  }
}

function tc(s: string | null): string {
  return s ?? '—'
}
function dur(frames: number, fps: number): string {
  const sec = frames / (fps || 25)
  return `${sec.toFixed(1)}s`
}
</script>

<template>
  <main>
    <header>
      <h1>tapeflow</h1>
      <div class="caps" v-if="caps">
        engines: hdvmerge {{ caps.engines.hdvmerge ? '✓' : '✗' }} ·
        dvmerge {{ caps.engines.dvmerge ? '✓' : '✗' }} &nbsp;|&nbsp;
        tools: ffmpeg {{ caps.tools.ffmpeg ? '✓' : '✗' }} ·
        dvrescue {{ caps.tools.dvrescue ? '✓' : '✗' }}
      </div>
    </header>

    <section class="bar">
      <button @click="pickDir" :disabled="busy">Choose working directory…</button>
      <button @click="analyze" :disabled="!dir || busy">Re-analyse</button>
      <span class="dir" v-if="dir">{{ dir }}</span>
      <span class="progress" v-if="busy">{{ progress }}</span>
    </section>

    <p class="error" v-if="error">{{ error }}</p>

    <template v-if="analysis">
      <section
        class="verdict"
        :class="analysis.complete ? 'ok' : 'warn'"
      >
        <template v-if="analysis.complete">
          ✅ Complete — every tape position has a clean copy.
          {{ analysis.buildable ? 'Ready to export.' : '(seams need attention before export)' }}
        </template>
        <template v-else>
          ⚠ {{ analysis.summary.recaptureSpots }} spot(s) need re-capture<span
            v-if="analysis.summary.missingFrames"
          >, ~{{ dur(analysis.summary.missingFrames, analysis.fps) }} missing entirely</span
          ><span v-if="analysis.summary.unusedCaptures">,
            {{ analysis.summary.unusedCaptures }} capture(s) unplaced</span
          >.
        </template>
      </section>

      <section class="meta">
        <strong>{{ analysis.tape.title || analysis.format.toUpperCase() }}</strong> ·
        {{ analysis.format.toUpperCase() }} @ {{ analysis.fps }} fps ·
        TC {{ tc(analysis.tape.tcStart) }} – {{ tc(analysis.tape.tcEnd) }} ·
        {{ dur(analysis.tape.durationFrames, analysis.fps) }}
      </section>

      <section v-if="analysis.damage.length">
        <h2>Re-capture list</h2>
        <table>
          <thead>
            <tr>
              <th>tape TC</th>
              <th>recording time</th>
              <th>kind</th>
              <th>length</th>
              <th>coverage</th>
              <th>damage</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in analysis.damage" :key="d.id">
              <td class="mono">{{ tc(d.tcStart) }}</td>
              <td>{{ tc(d.recStart) }}</td>
              <td>{{ d.kind }}</td>
              <td>{{ dur(d.durationFrames, analysis.fps) }}</td>
              <td>{{ d.copies === 0 ? 'none — lost' : d.coverage.join(', ') }}</td>
              <td>{{ d.severity }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section v-else>
        <h2>Re-capture list</h2>
        <p>Nothing to re-capture. 🎉</p>
      </section>

      <section>
        <h2>Captures</h2>
        <table>
          <thead>
            <tr>
              <th>file</th>
              <th>tape TC span</th>
              <th>recording span</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in analysis.captures" :key="c.tag">
              <td>{{ c.file }}</td>
              <td class="mono">{{ tc(c.tcSpan[0]) }} – {{ tc(c.tcSpan[1]) }}</td>
              <td>{{ tc(c.recSpan[0]) }} – {{ tc(c.recSpan[1]) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <p v-else-if="!busy" class="hint">Choose a working directory of overlapping captures to analyse.</p>
  </main>
</template>

<style>
body {
  margin: 0;
  font: 14px/1.5 system-ui, -apple-system, sans-serif;
  color: #1d1d1f;
  background: #fafafa;
}
main {
  max-width: 980px;
  margin: 0 auto;
  padding: 16px 24px 48px;
}
header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  border-bottom: 1px solid #e3e3e3;
}
h1 {
  font-size: 20px;
  margin: 8px 0;
}
.caps {
  font-size: 12px;
  color: #666;
}
.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 16px 0;
}
button {
  padding: 7px 12px;
  border: 1px solid #c8c8c8;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
.dir {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: #444;
}
.progress {
  font-size: 12px;
  color: #007aff;
}
.error {
  color: #c0392b;
  white-space: pre-wrap;
}
.verdict {
  padding: 12px 14px;
  border-radius: 8px;
  font-weight: 600;
}
.verdict.ok {
  background: #e7f7ec;
  color: #1d7a3a;
}
.verdict.warn {
  background: #fdf2e2;
  color: #9a6400;
}
.meta {
  margin: 12px 0;
  color: #444;
}
h2 {
  font-size: 15px;
  margin: 22px 0 8px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th,
td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid #ededed;
}
th {
  color: #888;
  font-weight: 600;
}
.mono {
  font-family: ui-monospace, monospace;
}
.hint {
  color: #888;
}
</style>
