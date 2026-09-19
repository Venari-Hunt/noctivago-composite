import { test } from 'node:test'
import assert from 'node:assert/strict'
import { snapMs, fmtSec } from '../src/domain/timeline.js'
import { escapeHtml } from '../src/domain/html.js'

test('snapMs rounds to the 50 ms grid unless snapping is off', () => {
  assert.equal(snapMs(74), 50)
  assert.equal(snapMs(76), 100)
  assert.equal(snapMs(76.4, true), 76)
  assert.equal(snapMs(-30), 0)
})

test('fmtSec picks precision by length', () => {
  assert.equal(fmtSec(1.234), '1.23s')
  assert.equal(fmtSec(12.34), '12.3s')
  assert.equal(fmtSec(75), '1:15')
  assert.equal(fmtSec(NaN), '--')
})

test('escapeHtml escapes markup characters', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
})
