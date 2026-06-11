const TC_RE = /^(\d{1,2}):(\d{2}):(\d{2}):(\d{2})$/
const REC_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/

function fpsInt(fps: number): number {
  return Math.max(1, Math.round(fps || 25))
}

export function tcToFrames(tc: string | null | undefined, fps: number): number | null {
  if (!tc) return null
  const m = TC_RE.exec(tc.trim())
  if (!m) return null
  const rate = fpsInt(fps)
  const hours = Number(m[1])
  const minutes = Number(m[2])
  const seconds = Number(m[3])
  const frames = Number(m[4])
  if (![hours, minutes, seconds, frames].every(Number.isFinite)) return null
  return ((hours * 60 + minutes) * 60 + seconds) * rate + frames
}

export function tcToSeconds(tc: string | null | undefined, fps: number): number | null {
  const frames = tcToFrames(tc, fps)
  return frames == null ? null : frames / fpsInt(fps)
}

export function secondsToTc(seconds: number, fps: number): string {
  if (!Number.isFinite(seconds)) return '--:--:--:--'
  const rate = fpsInt(fps)
  const sign = seconds < 0 ? '-' : ''
  let frames = Math.max(0, Math.round(Math.abs(seconds) * rate))
  const frame = frames % rate
  frames = Math.floor(frames / rate)
  const second = frames % 60
  frames = Math.floor(frames / 60)
  const minute = frames % 60
  const hour = Math.floor(frames / 60)
  return `${sign}${pad(hour)}:${pad(minute)}:${pad(second)}:${pad(frame)}`
}

export function parseRecordingTime(value: string | null | undefined): Date | null {
  if (!value) return null
  const m = REC_RE.exec(value.trim())
  if (!m) return null
  const d = new Date(`${m[1]}T${m[2]}`)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatRecordingTime(value: string | null | undefined): string {
  return value?.trim() || '-'
}

export function recordingTimeAt(
  tcSeconds: number,
  tcStartSeconds: number | null,
  recStart: string | null | undefined
): string | null {
  const start = parseRecordingTime(recStart)
  if (!start || tcStartSeconds == null || !Number.isFinite(tcSeconds)) return null
  const d = new Date(start.getTime() + (tcSeconds - tcStartSeconds) * 1000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function pad(n: number): string {
  return String(Math.floor(Math.abs(n))).padStart(2, '0')
}
