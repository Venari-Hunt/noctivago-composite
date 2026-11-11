import { test } from 'node:test'
import assert from 'node:assert/strict'
import { snapMs, fmtSec, rulerLabel, rulerStep, parseNum, volumeFill } from '../src/domain/timeline.js'
import { escapeHtml } from '../src/domain/html.js'

test('snapMs rounds to the 50 ms grid unless snapping is off', () => {
  assert.equal(snapMs(74), 50)
  assert.equal(snapMs(76), 100)
  assert.equal(snapMs(76.4, true), 76)
  assert.equal(snapMs(-30), 0)
})

test('fmtSec picks precision by length', () => {
  assert.equal(fmtSec(1.234), '1.23 s')
  assert.equal(fmtSec(12.34), '12.3 s')
  assert.equal(fmtSec(75), '1:15')
  assert.equal(fmtSec(NaN), '--')
})

test('rulerLabel reads like the mock, minutes as m:ss', () => {
  assert.equal(rulerLabel(0), '0.0 s')
  assert.equal(rulerLabel(2.5), '2.5 s')
  assert.equal(rulerLabel(90), '1:30')
})

test('rulerStep widens as the timeline grows', () => {
  assert.equal(rulerStep(4), 0.5)
  assert.equal(rulerStep(10), 1)
  assert.equal(rulerStep(40), 5)
  assert.equal(rulerStep(120), 15)
})

test('parseNum reads typed fields with units, or gives null', () => {
  assert.equal(parseNum('0.10 s'), 0.1)
  assert.equal(parseNum('80%'), 80)
  assert.equal(parseNum('1,5 s'), 1.5)
  assert.equal(parseNum('abc'), null)
  assert.equal(parseNum(''), null)
})

test('volumeFill maps 0..200% onto the fader track', () => {
  assert.equal(volumeFill(0), '0%')
  assert.equal(volumeFill(1), '50%')
  assert.equal(volumeFill(2), '100%')
  assert.equal(volumeFill(5), '100%')
})

test('escapeHtml escapes markup characters', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
})
