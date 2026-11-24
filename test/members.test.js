import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  blankMember,
  memberFromSaved,
  memberIn,
  memberOut,
  memberLen,
  contentEndSec,
  timelineSec,
  previewPlan
} from '../src/domain/members.js'

const durations = { a: 3, b: 2 }
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`)

test('members get unique uids and saved members drop nothing else', () => {
  const x = blankMember()
  const y = blankMember()
  assert.notEqual(x.uid, y.uid)
  const saved = memberFromSaved({ soundId: 'a', delayMs: 250, inSec: 0.5, volume: 0.8 })
  assert.deepEqual({ ...saved, uid: 0 }, { uid: 0, soundId: 'a', delayMs: 250, inSec: 0.5, outSec: null, volume: 0.8 })
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
