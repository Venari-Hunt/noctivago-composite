// Timeline rules for the Composite tab: grid snapping, zoom limits and time
// labels. No DOM, so it's tested with plain node --test.

export const SNAP_MS = 50
export const LANE_H = 62
export const MIN_PX_PER_SEC = 24
export const MAX_PX_PER_SEC = 160
export const MIN_CLIP_SEC = 0.05

// Rounds a member's start to the 50 ms grid (or to a whole ms while Shift
// disables snapping). Never negative.
export function snapMs(ms, disable) {
  if (disable) return Math.max(0, Math.round(ms))
  return Math.max(0, Math.round(ms / SNAP_MS) * SNAP_MS)
}

export function fmtSec(s) {
  if (!Number.isFinite(s)) return '--'
  if (s < 10) return `${s.toFixed(2)}s`
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}
