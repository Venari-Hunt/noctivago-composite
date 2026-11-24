import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_ZOOM,
  MAX_ZOOM,
  FIT_MAX,
  clampZoom,
  zoomToSlider,
  sliderToZoom,
  fitZoom,
  stepZoom,
  wheelZoom,
  scrollAfterZoom,
  shownSec,
  fmtShown,
  timeAtX,
  viewBox,
  overviewDrag
} from '../src/domain/zoom.js'

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`)

test('zoom is clamped to 4..800 px per second', () => {
  assert.equal(clampZoom(1), MIN_ZOOM)
  assert.equal(clampZoom(5000), MAX_ZOOM)
  assert.equal(clampZoom(80), 80)
  assert.equal(clampZoom(NaN), MIN_ZOOM)
})

test('the slider maps 0..100 onto the zoom range and back', () => {
  near(sliderToZoom(0), MIN_ZOOM)
  near(sliderToZoom(100), MAX_ZOOM)
  near(zoomToSlider(MIN_ZOOM), 0)
  near(zoomToSlider(MAX_ZOOM), 100)
  for (const px of [4, 24, 80, 160, 400, 800]) near(sliderToZoom(zoomToSlider(px)), px, 1e-6)
  assert.ok(sliderToZoom(50) > sliderToZoom(49))
})

test('Fit spreads the timeline over the visible width, within today\'s limits', () => {
  near(fitZoom(800, 10), 80)
  assert.equal(fitZoom(800, 1), FIT_MAX)
  assert.equal(fitZoom(100, 600), MIN_ZOOM)
})

test('zoom buttons and the wheel scale by a steady factor and stay in range', () => {
  near(stepZoom(80, 1), 100)
  near(stepZoom(80, -1), 64)
  assert.equal(stepZoom(MAX_ZOOM, 1), MAX_ZOOM)
  assert.ok(wheelZoom(80, -100) > 80)
  assert.ok(wheelZoom(80, 100) < 80)
  assert.equal(wheelZoom(MIN_ZOOM, 1000), MIN_ZOOM)
})

test('zooming around the pointer keeps the time under it in place', () => {
  const pxOld = 80
  const scrollLeft = 200
  const anchorX = 300
  const tBefore = (scrollLeft + anchorX) / pxOld
  const next = scrollAfterZoom({ pxOld, pxNew: 200, anchorX, scrollLeft })
  near((next + anchorX) / 200, tBefore)
  assert.equal(scrollAfterZoom({ pxOld: 200, pxNew: 4, anchorX: 10, scrollLeft: 0 }), 0)
})

test('shown seconds and their label', () => {
  near(shownSec(780, 300), 2.6)
  assert.equal(fmtShown(2.6), '2.6 s shown')
  assert.equal(fmtShown(42.4), '42 s shown')
  assert.equal(fmtShown(150), '2.5 min shown')
})

test('timeAtX counts the scroll and never goes negative', () => {
  near(timeAtX(100, 300, 100), 4)
  assert.equal(timeAtX(-50, 0, 100), 0)
})

test('the overview box is the visible part of the timeline', () => {
  const b = viewBox({ scrollLeft: 240, viewW: 600, px: 120, totalSec: 20 })
  near(b.left, 0.1)
  near(b.width, 0.25)
  const whole = viewBox({ scrollLeft: 0, viewW: 600, px: 20, totalSec: 10 })
  assert.deepEqual(whole, { left: 0, width: 1 })
})

test('dragging the overview box scrolls; its edges zoom', () => {
  const start = { px: 100, scrollLeft: 100, viewW: 400 } // shows 1 s .. 5 s
  const moved = overviewDrag({ mode: 'move', dtSec: 2, start, totalSec: 20 })
  assert.equal(moved.px, 100)
  near(moved.scrollLeft, 300)
  assert.equal(overviewDrag({ mode: 'move', dtSec: -9, start, totalSec: 20 }).scrollLeft, 0)

  // Right edge out by 4 s: 8 s shown, left edge stays at 1 s.
  const right = overviewDrag({ mode: 'right', dtSec: 4, start, totalSec: 20 })
  near(right.px, 50)
  near(right.scrollLeft / right.px, 1)

  // Left edge in by 2 s: 2 s shown, right edge stays at 5 s.
  const left = overviewDrag({ mode: 'left', dtSec: 2, start, totalSec: 20 })
  near(left.px, 200)
  near((left.scrollLeft + start.viewW) / left.px, 5)

  // Edges can't cross: the view never gets tighter than the minimum.
  const tight = overviewDrag({ mode: 'right', dtSec: -99, start, totalSec: 20 })
  near(tight.px, MAX_ZOOM)
})
