import type { ChecklistEntry, ChecklistState, DamageSpot, TapeAnalysis } from '../types'
import { tcToSeconds } from './timecode'

/**
 * Where to grab a thumbnail frame for a damage spot: the first covering capture's file, and the
 * playback offset into that capture (the spot's tape TC minus the capture's start TC). Null for a
 * `missing` spot (no frame exists) or when TCs are unavailable. Shared by the inline thumbnail and
 * the lightbox so they stay in sync.
 */
export function thumbnailRequest(
  analysis: TapeAnalysis,
  spot: DamageSpot
): { file: string; seconds: number } | null {
  if (spot.kind === 'missing') return null
  const tag = spot.coverage[0]
  const capture = tag ? analysis.captures.find((c) => c.tag === tag) : null
  if (!capture || !spot.tcStart || !capture.tcSpan[0]) return null
  const at = tcToSeconds(spot.tcStart, analysis.fps)
  const start = tcToSeconds(capture.tcSpan[0], analysis.fps)
  if (at == null || start == null) return null
  return { file: capture.file, seconds: Math.max(0, at - start) }
}

export function emptyChecklist(): ChecklistState {
  return { schema: 'tapeflow.state/1', entries: {} }
}

export function damageKey(spot: DamageSpot): string {
  if (spot.tcStart || spot.tcEnd) {
    return [spot.kind, spot.tcStart ?? '?', spot.tcEnd ?? '?', spot.durationFrames].join('|')
  }
  return [spot.kind, spot.axis[0], spot.axis[1], spot.durationFrames].join('|')
}

export function entryFromSpot(spot: DamageSpot, status: ChecklistEntry['status']): ChecklistEntry {
  return {
    key: damageKey(spot),
    status,
    kind: spot.kind,
    tcStart: spot.tcStart,
    tcEnd: spot.tcEnd,
    recStart: spot.recStart,
    recEnd: spot.recEnd,
    durationFrames: spot.durationFrames,
    updatedAt: new Date().toISOString()
  }
}

export function reconcileChecklist(
  existing: ChecklistState | null,
  analysis: TapeAnalysis
): ChecklistState {
  const previous = existing?.schema === 'tapeflow.state/1' ? existing.entries : {}
  const next: ChecklistState = emptyChecklist()
  const currentKeys = new Set<string>()

  for (const spot of analysis.damage) {
    const key = damageKey(spot)
    currentKeys.add(key)
    const old = previous[key]
    next.entries[key] = entryFromSpot(spot, old?.status === 'accepted' ? 'accepted' : 'outstanding')
  }

  for (const [key, entry] of Object.entries(previous)) {
    if (!currentKeys.has(key)) {
      next.entries[key] = {
        ...entry,
        status: 'covered',
        updatedAt: new Date().toISOString()
      }
    }
  }

  return next
}

export function statusForSpot(state: ChecklistState | null, spot: DamageSpot): ChecklistEntry['status'] {
  return state?.entries[damageKey(spot)]?.status ?? 'outstanding'
}

export function currentSpotByKey(analysis: TapeAnalysis | null, key: string | null): DamageSpot | null {
  if (!analysis || !key) return null
  return analysis.damage.find((spot) => damageKey(spot) === key) ?? null
}
