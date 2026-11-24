// A composite is a list of members (one per layer): { uid, soundId, delayMs,
// inSec, outSec, volume }. inSec/outSec are seconds inside the sound's file
// (null = untrimmed), delayMs is where the clip starts on the timeline. These
// are the pure rules around them; `durations` maps soundId -> file seconds.

import { MIN_CLIP_SEC } from './timeline.js'

let nextUid = 1

export function blankMember() {
  return { uid: nextUid++, soundId: '', delayMs: 0, inSec: null, outSec: null, volume: 1 }
}

// A member from a saved composite entry (uid is for React and Preview only;
// it is never saved).
export function memberFromSaved(m) {
  return {
    uid: nextUid++,
    soundId: m.soundId,
    delayMs: m.delayMs ?? 0,
    inSec: m.inSec ?? null,
    outSec: m.outSec ?? null,
    volume: m.volume ?? 1
  }
}

// Resolve a member's effective trim, filling nulls from the known duration.
export function memberIn(m) {
  return Math.max(0, m.inSec ?? 0)
}

export function memberOut(m, durations) {
  const dur = durations[m.soundId]
  if (m.outSec != null) return dur != null ? Math.min(m.outSec, dur) : m.outSec
  return dur != null ? dur : 1
}

export function memberLen(m, durations) {
  return Math.max(MIN_CLIP_SEC, memberOut(m, durations) - memberIn(m))
}

// Where the last clip ends, in seconds (0 when no layer has a sound).
export function contentEndSec(members, durations) {
  let end = 0
  for (const m of members) {
    if (!m.soundId) continue
    end = Math.max(end, m.delayMs / 1000 + memberLen(m, durations))
  }
  return end
}

// Trimming the head to `inSec`: the in-point moves and the clip's start shifts by
// the same amount, so the audio stays where it was (the DAW way). Dragging the In
// handle and typing "Trim start" both go through here. Returns the member patch.
export function trimStartPatch({ delayMs, inSec, outSec }, wanted) {
  const newIn = Math.max(0, Math.min(wanted, outSec - MIN_CLIP_SEC))
  return { inSec: newIn, delayMs: Math.max(0, Math.round(delayMs + (newIn - inSec) * 1000)) }
}

// The timeline is a little longer than its content so there is room to drag.
export function timelineSec(members, durations) {
  return Math.max(4, contentEndSec(members, durations) * 1.05 + 0.5)
}

// What Preview does when it starts at `from` seconds: for every clip that
// still has sound left, when to start it (ms from now), where in the file to
// seek, and how long to let it play. Clips already over are left out.
export function previewPlan(members, durations, from = 0) {
  const plan = []
  for (const m of members) {
    if (!m.soundId) continue
    const clipStart = m.delayMs / 1000
    const len = memberLen(m, durations)
    const clipEnd = clipStart + len
    if (from >= clipEnd) continue
    const inside = Math.max(0, from - clipStart)
    plan.push({
      uid: m.uid,
      startInMs: Math.max(0, (clipStart - from) * 1000),
      seekSec: memberIn(m) + inside,
      playMs: Math.max(50, (len - inside) * 1000)
    })
  }
  return plan
}
