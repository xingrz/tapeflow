import type { BuildVerify, Progress } from '../types'
import { t } from '../i18n'

export function formatDurationFrames(frames: number, fps: number): string {
  if (!Number.isFinite(frames) || frames <= 0) return '0 s'
  const seconds = frames / (fps || 25)
  if (seconds < 1) return `${Math.max(1, Math.round(frames))} fr`
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}m ${String(rest).padStart(2, '0')}s`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value.toFixed(i === 0 ? 0 : 2)} ${units[i]}`
}

export function shortPath(path: string | null | undefined): string {
  if (!path) return t('app.noDir')
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 3) return path
  return `.../${parts.slice(-3).join('/')}`
}

export function formatProgress(p: Progress): string {
  // the byte percent now lives per-file in each capture's index badge, so the global text just
  // names which file is being indexed (no percent)
  if (p.phase === 'index-start' && p.file) return t('progress.indexing', { file: p.file })
  if (p.phase === 'indexing') return ''
  if (p.phase === 'indexed' && p.file) {
    return p.cached
      ? t('progress.usingCached', { file: p.file })
      : t('progress.indexed', { file: p.file })
  }
  if (p.phase === 'building') return t('progress.building')
  if (p.phase === 'verifying') return t('progress.verifying')
  if (p.phase === 'merging') return t('progress.merging')
  if (p.phase === 'tool' && p.tool) return t('progress.runningTool', { tool: p.tool })
  return sentenceCase(p.phase || t('progress.working'))
}

export function verifySummary(verify: BuildVerify | null): string {
  if (!verify) return t('verify.dvDone')
  const checks = [
    verify.aux ? t('verify.auxPresent') : t('verify.auxMissing'),
    verify.ccOk ? t('verify.ccClean') : t('verify.ccWarning'),
    verify.decodeErrors == null ? null : t('verify.decodeErrors', { count: verify.decodeErrors })
  ].filter(Boolean)
  return checks.join(' | ')
}

function sentenceCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value
}
