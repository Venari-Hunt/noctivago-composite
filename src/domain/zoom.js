// Zoom and navigation rules for the Composite timeline. No DOM, so it's tested
// with plain node --test. "px" always means pixels per second of timeline.

export const MIN_ZOOM = 4
export const MAX_ZOOM = 800
export const FIT_MAX = 160 // Fit never blows a short composite up past today's auto-fit
export const MIN_SHOWN_SEC = 0.05 // the overview can't zoom in tighter than this

export function clampZoom(px) {
  if (!Number.isFinite(px)) return MIN_ZOOM
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, px))
}

// The zoom slider runs 0..100 on a log scale, so each step feels the same.
const LOG_SPAN = Math.log(MAX_ZOOM / MIN_ZOOM)

export function zoomToSlider(px) {
  return (Math.log(clampZoom(px) / MIN_ZOOM) / LOG_SPAN) * 100
}

export function sliderToZoom(value) {
  const v = Math.min(100, Math.max(0, Number(value) || 0))
  return clampZoom(MIN_ZOOM * Math.exp((v / 100) * LOG_SPAN))
}

// Today's auto-fit: the whole timeline across the visible width.
export function fitZoom(viewW, totalSec) {
  const px = viewW / Math.max(0.001, totalSec)
  return Math.min(FIT_MAX, Math.max(MIN_ZOOM, px))
}

// One click of the - or + button.
export function stepZoom(px, direction) {
  return clampZoom(px * Math.pow(1.25, direction))
}

// Ctrl+wheel: one notch (deltaY 100) is about 16%.
export function wheelZoom(px, deltaY) {
  return clampZoom(px * Math.exp(-deltaY * 0.0015))
}

// The scroll position that keeps the time under anchorX (pixels from the left
// edge of the visible lanes) exactly where it was while px changes.
export function scrollAfterZoom({ pxOld, pxNew, anchorX, scrollLeft }) {
  const t = (scrollLeft + anchorX) / pxOld
  return Math.max(0, t * pxNew - anchorX)
}

// Seconds shown across the lanes.
export function shownSec(viewW, px) {
  return viewW / px
}

export function fmtShown(sec) {
  if (!Number.isFinite(sec)) return '--'
  if (sec >= 60) return `${Math.round(sec / 6) / 10} min shown`
  return `${sec < 10 ? sec.toFixed(1) : Math.round(sec)} s shown`
}

// The time (seconds) under a point of the ruler or lanes, never negative.
export function timeAtX(x, scrollLeft, px) {
  return Math.max(0, (x + scrollLeft) / px)
}

// The overview's box, as fractions (0..1) of the whole timeline.
export function viewBox({ scrollLeft, viewW, px, totalSec }) {
  const total = Math.max(0.001, totalSec)
  const w = Math.min(1, viewW / px / total)
  const l = Math.min(1 - w, Math.max(0, scrollLeft / px / total))
  return { left: l, width: w }
}

// Dragging the overview box (mode "move") or one of its edges ("left" or
// "right"), from the state at pointer-down. dtSec is how far the pointer has
// moved, in timeline seconds. Returns the new { px, scrollLeft }.
export function overviewDrag({ mode, dtSec, start, totalSec }) {
  const { px, scrollLeft, viewW } = start
  const leftT = scrollLeft / px
  const rightT = (scrollLeft + viewW) / px
  if (mode === 'move') {
    return { px, scrollLeft: Math.max(0, (leftT + dtSec) * px) }
  }
  if (mode === 'right') {
    const newRight = Math.min(Math.max(rightT + dtSec, leftT + MIN_SHOWN_SEC), Math.max(totalSec, leftT + MIN_SHOWN_SEC))
    const nextPx = clampZoom(viewW / (newRight - leftT))
    return { px: nextPx, scrollLeft: leftT * nextPx }
  }
  const newLeft = Math.max(0, Math.min(leftT + dtSec, rightT - MIN_SHOWN_SEC))
  const nextPx = clampZoom(viewW / (rightT - newLeft))
  return { px: nextPx, scrollLeft: Math.max(0, rightT * nextPx - viewW) }
}
