// Timeline rules for the Composite tab: grid snapping, zoom limits and time
// labels. No DOM, so it's tested with plain node --test.

export const SNAP_MS = 50
export const LANE_H = 88 // the mock's lane (.tll) height
export const MIN_PX_PER_SEC = 24
export const MAX_PX_PER_SEC = 160
export const MIN_CLIP_SEC = 0.05
export const VOLUME_MAX = 2 // a lane's volume runs 0..200%

// Rounds a member's start to the 50 ms grid (or to a whole ms while Shift
// disables snapping). Never negative.
export function snapMs(ms, disable) {
  if (disable) return Math.max(0, Math.round(ms))
  return Math.max(0, Math.round(ms / SNAP_MS) * SNAP_MS)
}

export function fmtSec(s) {
  if (!Number.isFinite(s)) return '--'
  if (s < 10) return `${s.toFixed(2)} s`
  if (s < 60) return `${s.toFixed(1)} s`
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

// Ruler labels read like the mock ("0.0 s", "2.5 s"); a minute or more
// switches to m:ss.
export function rulerLabel(s) {
  if (s >= 60) return fmtSec(s)
  return `${s.toFixed(1)} s`
}

// The ruler's tick step for a timeline this long, in seconds.
export function rulerStep(totalSec) {
  return totalSec < 6 ? 0.5 : totalSec < 20 ? 1 : totalSec < 90 ? 5 : 15
}

// Reads a typed field like "0.10 s" or "80%". Returns null when there's no
// number in it, so the caller can put the old value back.
export function parseNum(text) {
  const n = parseFloat(String(text).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

// The CSS --p fill of a lane's volume fader (range 0..VOLUME_MAX).
export function volumeFill(volume) {
  return `${Math.round((Math.max(0, Math.min(VOLUME_MAX, volume)) / VOLUME_MAX) * 100)}%`
}
