import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHistory } from '../src/domain/history.js'
import { nudgeMs, patchIsNoop } from '../src/domain/members.js'
import { shortcutAction } from '../src/domain/keys.js'

test('undo and redo walk the snapshots in order', () => {
  const h = createHistory()
  h.push('a')
  h.push('b')
  assert.equal(h.undo('c'), 'b')
  assert.equal(h.undo('b'), 'a')
  assert.equal(h.undo('a'), null)
  assert.equal(h.redo('a'), 'b')
  assert.equal(h.redo('b'), 'c')
  assert.equal(h.redo('c'), null)
})

test('a new change empties redo', () => {
  const h = createHistory()
  h.push('a')
  h.undo('b')
  assert.ok(h.canRedo())
  h.push('x')
  assert.ok(!h.canRedo())
})

test('the same key inside the window is one step, a later one is a new step', () => {
  let t = 0
  const h = createHistory({ mergeMs: 700, now: () => t })
  h.push('a', 'nudge')
  t = 600
  h.push('b', 'nudge')
  t = 1200 // 600 ms after the latest push: still one step (held key)
  h.push('c', 'nudge')
  assert.equal(h.undo('d'), 'a')
  assert.ok(!h.canUndo())
  h.redo('a')
  t = 5000
  h.push('e', 'nudge')
  assert.ok(h.canUndo())
})

test('a push after an undo is never merged into the entry that was undone', () => {
  let t = 0
  const h = createHistory({ now: () => t })
  h.push('a', 'vol')
  h.undo('b')
  t = 10
  h.push('c', 'vol')
  assert.equal(h.undo('d'), 'c')
})

test('the stack keeps only the newest entries', () => {
  const h = createHistory({ limit: 3 })
  for (const s of ['a', 'b', 'c', 'd', 'e']) h.push(s)
  assert.equal(h.undo('x'), 'e')
  assert.equal(h.undo('e'), 'd')
  assert.equal(h.undo('d'), 'c')
  assert.equal(h.undo('c'), null)
})

test('patchIsNoop sees a change that changes nothing', () => {
  const m = { delayMs: 100, inSec: null, volume: 1 }
  assert.ok(patchIsNoop(m, { delayMs: 100 }))
  assert.ok(!patchIsNoop(m, { delayMs: 110 }))
})

test('nudgeMs moves by 10 ms, Shift by 100 ms, and never below 0', () => {
  assert.equal(nudgeMs(1000, 1, false), 1010)
  assert.equal(nudgeMs(1000, -1, true), 900)
  assert.equal(nudgeMs(40, -1, true), 0)
})

const ev = (key, extra = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra })
const ctx = { typing: false, onControl: false, modalOpen: false, hasClip: true }

test('keys map to Composite actions', () => {
  assert.deepEqual(shortcutAction(ev('z', { ctrlKey: true }), ctx), { id: 'undo' })
  assert.deepEqual(shortcutAction(ev('Z', { ctrlKey: true, shiftKey: true }), ctx), { id: 'redo' })
  assert.deepEqual(shortcutAction(ev('y', { ctrlKey: true }), ctx), { id: 'redo' })
  assert.deepEqual(shortcutAction(ev('ArrowLeft'), ctx), { id: 'nudge', dir: -1, big: false })
  assert.deepEqual(shortcutAction(ev('ArrowRight', { shiftKey: true }), ctx), { id: 'nudge', dir: 1, big: true })
  assert.deepEqual(shortcutAction(ev('Delete'), ctx), { id: 'delete' })
  assert.deepEqual(shortcutAction(ev('Escape'), ctx), { id: 'deselect' })
  assert.deepEqual(shortcutAction(ev('s'), ctx), { id: 'snap' })
  assert.deepEqual(shortcutAction(ev('f'), ctx), { id: 'fit' })
  assert.deepEqual(shortcutAction(ev(' '), ctx), { id: 'preview' })
})

test('keys typed into a field, or with a dialog open, are left alone', () => {
  for (const key of ['ArrowLeft', 'Delete', 's', 'f', ' ', 'Escape']) {
    assert.equal(shortcutAction(ev(key), { ...ctx, typing: true }), null, key)
    assert.equal(shortcutAction(ev(key), { ...ctx, modalOpen: true }), null, key)
  }
  assert.equal(shortcutAction(ev('z', { ctrlKey: true }), { ...ctx, typing: true }), null)
})

test('keys the app owns are not taken', () => {
  assert.equal(shortcutAction(ev('f', { ctrlKey: true }), ctx), null) // search
  assert.equal(shortcutAction(ev('s', { ctrlKey: true }), ctx), null) // save preset
  assert.equal(shortcutAction(ev('m', { ctrlKey: true }), ctx), null)
  assert.equal(shortcutAction(ev('1', { ctrlKey: true }), ctx), null) // tab 1
  assert.equal(shortcutAction(ev('?'), ctx), null) // the app's Help
  assert.equal(shortcutAction(ev('s', { altKey: true }), ctx), null)
})

test('nudge and Delete need a clip; Space on a focused button presses that button', () => {
  assert.equal(shortcutAction(ev('ArrowLeft'), { ...ctx, hasClip: false }), null)
  assert.equal(shortcutAction(ev('Delete'), { ...ctx, hasClip: false }), null)
  assert.equal(shortcutAction(ev(' '), { ...ctx, onControl: true }), null)
  assert.deepEqual(shortcutAction(ev('s'), { ...ctx, onControl: true }), { id: 'snap' })
})
