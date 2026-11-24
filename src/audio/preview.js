// Preview: timing and overlap only (filters and EQ are applied at Make sound).
// One <audio> element per clip, each through its own gain, started on timers
// from a plan (domain/members.js previewPlan). A rAF loop reports the time so
// the playhead moves while it plays.

const VOLUME_SCALE = 0.85

export class Preview {
  constructor({ onTick, onEnd }) {
    this.onTick = onTick
    this.onEnd = onEnd
    this.session = null
  }

  get active() {
    return this.session != null
  }

  // plan: previewPlan(...) items; members: current members (for soundId and
  // volume); from: where the playhead starts (s); endSec: where the content ends.
  start({ plan, members, from, endSec }) {
    this.stop(from, true)
    if (!plan.length) return false
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const nodes = new Map()
    const timers = []
    for (const item of plan) {
      const m = members.find((x) => x.uid === item.uid)
      if (!m) continue
      const el = new Audio()
      el.crossOrigin = 'anonymous' // must precede .src for the custom scheme not to taint the graph
      el.preload = 'auto'
      el.src = `sound://${m.soundId}`
      const src = ctx.createMediaElementSource(el)
      const gain = ctx.createGain()
      gain.gain.value = m.volume * VOLUME_SCALE
      src.connect(gain).connect(ctx.destination)
      nodes.set(item.uid, { el, gain })
      timers.push(
        setTimeout(() => {
          try {
            el.currentTime = item.seekSec
            el.play().catch(() => {})
          } catch {
            /* seek can throw before metadata; play's canplay will retry */
          }
          timers.push(setTimeout(() => el.pause(), item.playMs))
        }, item.startInMs)
      )
    }
    const t0 = performance.now()
    const session = { ctx, nodes, timers, from, endSec, t0, raf: 0 }
    const tick = () => {
      if (this.session !== session) return
      const t = from + (performance.now() - t0) / 1000
      if (t >= endSec + 0.2) {
        this.stop(endSec)
        return
      }
      this.onTick?.(Math.min(t, endSec))
      session.raf = requestAnimationFrame(tick)
    }
    this.session = session
    session.raf = requestAnimationFrame(tick)
    return true
  }

  setVolume(uid, volume) {
    const rec = this.session?.nodes.get(uid)
    if (rec) rec.gain.gain.value = volume * VOLUME_SCALE
  }

  // Stops everything; `at` is where the playhead should rest (default: where it was).
  stop(at, silent = false) {
    const s = this.session
    if (!s) return
    this.session = null
    cancelAnimationFrame(s.raf)
    s.timers.forEach(clearTimeout)
    s.nodes.forEach(({ el }) => {
      try {
        el.pause()
      } catch {
        /* ignore */
      }
    })
    s.ctx.close().catch(() => {})
    const rest = at ?? Math.min(s.endSec, s.from + (performance.now() - s.t0) / 1000)
    if (!silent) this.onEnd?.(rest)
  }
}
