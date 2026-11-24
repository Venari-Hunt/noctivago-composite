// A composite is a list of members (one per layer): { uid, soundId, delayMs,
// inSec, outSec, volume }. inSec/outSec are seconds inside the sound's file
// (null = untrimmed), delayMs is where the clip starts on the timeline. These
// are the pure rules around them; `durations` maps soundId -> file seconds.

import { MIN_CLIP_SEC } from './timeline.js'

let nextUid = 1

// `name` is the layer's own name ('' = use the sound's name). A muted layer is
// left out of Preview and of the baked sound but is saved (`muted: true`) so it
// comes back muted; `solo` is an editing aid that is never saved and only
// changes what Preview plays.
export function blankMember() {
  return { uid: nextUid++, soundId: '', name: '', delayMs: 0, inSec: null, outSec: null, volume: 1, muted: false, solo: false }
}

// A member from a saved composite entry (uid is for React and Preview only;
// it is never saved). Composites saved before layers had names have no `name`.
export function memberFromSaved(m) {
  return {
    uid: nextUid++,
    soundId: m.soundId,
    name: typeof m.name === 'string' ? m.name : '',
    delayMs: m.delayMs ?? 0,
    inSec: m.inSec ?? null,
    outSec: m.outSec ?? null,
    volume: m.volume ?? 1,
    muted: m.muted === true,
    solo: false
  }
}

// What Make sound sends and the app saves: every layer with a sound, in order.
// A muted layer carries `muted: true` (the app leaves it out of the baked sound
// but keeps it in the recipe); an unmuted one has no `muted` field, so recipes
// look the same as before. `durations` fills the trims in (nulls -> real values).
export function savePayload(members, durations) {
  return members
    .filter((m) => m.soundId)
    .map((m) => ({
      soundId: m.soundId,
      // A layer name is saved only when you gave one; older composites have none.
      ...(m.name.trim() ? { name: m.name.trim() } : {}),
      delayMs: Math.max(0, Math.round(m.delayMs)),
      inSec: memberIn(m),
      outSec: memberOut(m, durations),
      volume: Math.max(0, Math.min(4, m.volume ?? 1)),
      ...(m.muted ? { muted: true } : {})
    }))
}

// What a layer is called: its own name, else its sound's, else "Empty layer".
export function layerTitle(m, entry) {
  return m.name.trim() || (m.soundId ? (entry ? entry.name : '(missing)') : 'Empty layer')
}

// The members Preview plays: not muted, and only the soloed ones while any
// layer with a sound is soloed.
export function audibleMembers(members) {
  const anySolo = members.some((m) => m.soundId && m.solo)
  return members.filter((m) => m.soundId && !m.muted && (!anySolo || m.solo))
}

// What Make sound renders: everything with a sound that is not muted (solo
// does not matter here).
export function bakeMembers(members) {
  return members.filter((m) => m.soundId && !m.muted)
}

// A copy of a layer for Duplicate: same sound, timing and volume, a fresh uid,
// not muted or soloed.
export function duplicateMember(m, name) {
  return { ...m, uid: nextUid++, name, muted: false, solo: false }
}

// A new array with the item at `from` moved to index `to`.
export function moveItem(list, from, to) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = list.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
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

// A nudge key moves a clip 10 ms (Shift: 100 ms), never before 0.
export function nudgeMs(delayMs, dir, big) {
  return Math.max(0, delayMs + dir * (big ? 100 : 10))
}

// True when applying `patch` to member `m` would change nothing a person can
// see (a trim of null and a trim at the whole file are the same clip), so it
// makes no undo step.
export function patchIsNoop(m, patch, durations = {}) {
  const next = { ...m, ...patch }
  return (
    m.soundId === next.soundId &&
    m.delayMs === next.delayMs &&
    m.volume === next.volume &&
    m.name === next.name &&
    m.muted === next.muted &&
    m.solo === next.solo &&
    memberIn(m) === memberIn(next) &&
    memberOut(m, durations) === memberOut(next, durations)
  )
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
  for (const m of audibleMembers(members)) {
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
