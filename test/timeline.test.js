import { test } from 'node:test'
import assert from 'node:assert/strict'
import { snapMs, fmtSec, rulerLabel, rulerMarks, parseSeconds, volumeFill } from '../src/domain/timeline.js'
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

test('ruler marks get sparser as you zoom out and denser as you zoom in', () => {
  const at = (px, total = 10) => rulerMarks(px, total)
  // 80 px/s: a label every 1 s with small ticks every 0.25 s.
  const m = at(80)
  assert.deepEqual(m.filter((x) => x.big).map((x) => x.t), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.equal(m.length, 41)
  // 800 px/s: a label every 0.1 s.
  assert.equal(at(800, 1).filter((x) => x.big).length, 11)
  // 4 px/s: labels 30 s apart, a small tick every 5 s.
  const far = at(4, 120)
  assert.deepEqual(far.filter((x) => x.big).map((x) => x.t), [0, 30, 60, 90, 120])
  assert.equal(far.length, 25)
})

test('parseSeconds reads a whole number with an optional s, or gives null', () => {
  assert.equal(parseSeconds('0.10 s'), 0.1)
  assert.equal(parseSeconds('1,5 s'), 1.5)
  assert.equal(parseSeconds('0.5'), 0.5)
  assert.equal(parseSeconds(' 2s '), 2)
  assert.equal(parseSeconds('-2'), -2)
  assert.equal(parseSeconds('.5'), 0.5)
  assert.equal(parseSeconds('abc'), null)
  assert.equal(parseSeconds('0,05s.'), null) // the mock's bad-input example
  assert.equal(parseSeconds('1.2.3'), null)
  assert.equal(parseSeconds('80%'), null)
  assert.equal(parseSeconds(''), null)
})

test('volumeFill maps 0..150% onto the fader track', () => {
  assert.equal(volumeFill(0), '0%')
  assert.equal(volumeFill(0.75), '50%')
  assert.equal(volumeFill(1.5), '100%')
  assert.equal(volumeFill(5), '100%')
  assert.equal(volumeFill(2, 2), '100%') // an older composite above 150% gets a wider track
})

test('escapeHtml escapes markup characters', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
})
