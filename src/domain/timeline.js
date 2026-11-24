// Timeline rules for the Composite tab: grid snapping and time labels (zoom
// lives in zoom.js). No DOM, so it's tested with plain node --test.

export const SNAP_MS = 50
export const LANE_H = 56 // the v2 mock's layer row height
export const MIN_CLIP_SEC = 0.05
export const VOLUME_MAX = 2 // a lane's volume runs 0..200%

// Rounds a member's start to the 50 ms grid (or to a whole ms while Ctrl
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

// The ruler's marks for this zoom (px per second): a label every major step
// (at least 72 px apart), small ticks between them while there is room.
// Returns [{ k, t, big }] with t in seconds; only big marks get a label.
const RULER_STEPS = [[0.1, 5], [0.2, 4], [0.5, 5], [1, 4], [2, 4], [5, 5], [10, 5], [15, 3], [30, 6], [60, 4], [120, 4], [300, 5]]
export function rulerMarks(px, totalSec) {
  let major = 300
  let parts = 5
  for (const [step, p] of RULER_STEPS) {
    if (step * px >= 72) {
      major = step
      parts = p
      break
    }
  }
  const minor = major / parts
  const drawMinor = minor * px >= 6
  const marks = []
  const n = Math.floor(totalSec / minor + 1e-6)
  for (let k = 0; k <= n; k++) {
    const big = k % parts === 0
    if (!big && !drawMinor) continue
    marks.push({ k, t: k * minor, big })
  }
  return marks
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
