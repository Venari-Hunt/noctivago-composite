import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  audibleMembers,
  bakeMembers,
  duplicateMember,
  layerTitle,
  moveItem,
  patchIsNoop,
  blankMember,
  memberFromSaved,
  memberIn,
  memberOut,
  memberLen,
  contentEndSec,
  timelineSec,
  previewPlan,
  trimStartPatch
} from '../src/domain/members.js'

const durations = { a: 3, b: 2 }
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`)

test('members get unique uids and saved members drop nothing else', () => {
  const x = blankMember()
  const y = blankMember()
  assert.notEqual(x.uid, y.uid)
  const saved = memberFromSaved({ soundId: 'a', delayMs: 250, inSec: 0.5, volume: 0.8 })
  assert.deepEqual(
    { ...saved, uid: 0 },
    { uid: 0, soundId: 'a', name: '', delayMs: 250, inSec: 0.5, outSec: null, volume: 0.8, muted: false, solo: false }
  )
})

test('a composite saved before layer names loads with the default name; a saved name is kept', () => {
  assert.equal(memberFromSaved({ soundId: 'a', delayMs: 0 }).name, '')
  assert.equal(memberFromSaved({ soundId: 'a', name: 'Latch click' }).name, 'Latch click')
  assert.equal(memberFromSaved({ soundId: 'a', name: 7 }).name, '')
})

test('a layer is called its own name, else its sound, else Empty layer', () => {
  const m = { ...blankMember(), soundId: 'a' }
  assert.equal(layerTitle(m, { name: 'Door creak' }), 'Door creak')
  assert.equal(layerTitle({ ...m, name: '  Creak  ' }, { name: 'Door creak' }), 'Creak')
  assert.equal(layerTitle(m, undefined), '(missing)')
  assert.equal(layerTitle(blankMember(), undefined), 'Empty layer')
})

test('mute and solo: Preview plays the audible layers, Make sound everything not muted', () => {
  const a = { ...blankMember(), soundId: 'a' }
  const b = { ...blankMember(), soundId: 'b', muted: true }
  const c = { ...blankMember(), soundId: 'a' }
  const empty = { ...blankMember(), solo: true } // solo on a layer with no sound counts for nothing
  assert.deepEqual(audibleMembers([a, b, c, empty]).map((m) => m.uid), [a.uid, c.uid])
  assert.deepEqual(bakeMembers([a, b, c, empty]).map((m) => m.uid), [a.uid, c.uid])
  const soloC = { ...c, solo: true }
  assert.deepEqual(audibleMembers([a, b, soloC]).map((m) => m.uid), [c.uid])
  assert.deepEqual(bakeMembers([a, b, soloC]).map((m) => m.uid), [a.uid, c.uid]) // solo is Preview only
  assert.deepEqual(audibleMembers([a, { ...b, solo: true }]).map((m) => m.uid), []) // soloed but muted: silent
  assert.deepEqual(previewPlan([a, b, soloC], durations).map((p) => p.uid), [c.uid])
})

test('Duplicate copies timing and volume, not mute or solo; moveItem reorders', () => {
  const m = { ...blankMember(), soundId: 'a', delayMs: 300, volume: 0.7, muted: true, solo: true }
  const d = duplicateMember(m, 'Creak copy')
  assert.notEqual(d.uid, m.uid)
  assert.deepEqual({ ...d, uid: 0 }, { ...m, uid: 0, name: 'Creak copy', muted: false, solo: false })
  assert.deepEqual(moveItem([1, 2, 3, 4], 0, 2), [2, 3, 1, 4])
  assert.deepEqual(moveItem([1, 2, 3, 4], 3, 0), [4, 1, 2, 3])
  const same = [1, 2]
  assert.equal(moveItem(same, 1, 1), same)
  assert.equal(moveItem(same, 0, 5), same)
})

test('a changed name, mute or solo is a change; the same is not', () => {
  const m = { ...blankMember(), soundId: 'a' }
  assert.equal(patchIsNoop(m, { name: 'x' }), false)
  assert.equal(patchIsNoop(m, { muted: true }), false)
  assert.equal(patchIsNoop(m, { solo: true }), false)
  assert.equal(patchIsNoop(m, { name: '', muted: false, solo: false }), true)
})

test('trim fills nulls from the duration and clamps Out to the file', () => {
  const m = { ...blankMember(), soundId: 'a' }
  assert.equal(memberIn(m), 0)
  assert.equal(memberOut(m, durations), 3)
  assert.equal(memberOut({ ...m, outSec: 9 }, durations), 3)
  assert.equal(memberOut({ ...m, soundId: 'zzz' }, durations), 1)
  near(memberLen({ ...m, inSec: 1, outSec: 2.5 }, durations), 1.5)
  assert.equal(memberLen({ ...m, inSec: 2.99, outSec: 3 }, durations), 0.05)
})

test('the content ends at the last clip; the timeline is a bit longer', () => {
  const members = [
    { ...blankMember(), soundId: 'a', delayMs: 0 },
    { ...blankMember(), soundId: 'b', delayMs: 2000 },
    { ...blankMember() }
  ]
  assert.equal(contentEndSec(members, durations), 4)
  near(timelineSec(members, durations), 4 * 1.05 + 0.5)
  assert.equal(contentEndSec([blankMember()], durations), 0)
  assert.equal(timelineSec([blankMember()], durations), 4)
})

test('Preview from the start plays every clip at its own start time', () => {
  const a = { ...blankMember(), soundId: 'a', delayMs: 0, inSec: 0.5 }
  const b = { ...blankMember(), soundId: 'b', delayMs: 1000 }
  const plan = previewPlan([a, b, blankMember()], durations)
  assert.equal(plan.length, 2)
  assert.deepEqual(plan[0], { uid: a.uid, startInMs: 0, seekSec: 0.5, playMs: 2500 })
  assert.deepEqual(plan[1], { uid: b.uid, startInMs: 1000, seekSec: 0, playMs: 2000 })
})

test('Preview from the playhead skips finished clips and seeks into running ones', () => {
  const a = { ...blankMember(), soundId: 'a', delayMs: 0 } // 0..3 s
  const b = { ...blankMember(), soundId: 'b', delayMs: 1000 } // 1..3 s
  const c = { ...blankMember(), soundId: 'b', delayMs: 0 } // 0..2 s
  const plan = previewPlan([a, b, c], durations, 2.5)
  assert.deepEqual(plan.map((p) => p.uid), [a.uid, b.uid])
  near(plan[0].seekSec, 2.5)
  assert.equal(plan[0].startInMs, 0)
  near(plan[0].playMs, 500)
  near(plan[1].seekSec, 1.5)
  const early = previewPlan([b], durations, 0.4)
  near(early[0].startInMs, 600)
  assert.equal(early[0].seekSec, 0)
})

test('trimStartPatch moves the in-point and shifts the start by the same amount', () => {
  const p = trimStartPatch({ delayMs: 500, inSec: 0, outSec: 3 }, 1.2)
  assert.equal(p.inSec, 1.2)
  assert.equal(p.delayMs, 1700)
})

test('trimStartPatch stops 0.05 s before Out and never moves the start below 0', () => {
  const late = trimStartPatch({ delayMs: 0, inSec: 0, outSec: 3 }, 99)
  near(late.inSec, 2.95)
  assert.equal(late.delayMs, 2950)
  const back = trimStartPatch({ delayMs: 200, inSec: 1, outSec: 3 }, 0)
  assert.equal(back.inSec, 0)
  assert.equal(back.delayMs, 0) // would be -800
  assert.equal(trimStartPatch({ delayMs: 0, inSec: 0, outSec: 3 }, -5).inSec, 0)
})
