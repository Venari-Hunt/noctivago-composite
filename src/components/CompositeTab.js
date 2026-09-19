// Composite multi-sound "effect" groups (e.g. a door: knob turn + creak +
// bell). Design confirmed directly by the owner: pick existing sounds,
// arrange them on a small timeline (per-member trim + free drag positioning
// + per-member volume), and *bake* them into one new real audio file. The
// result is a completely normal library.js entry (created via the exact same
// library.addSound every plain import goes through) - it just carries a
// `compositeSource` field for the badge and so this tab can reopen it. Zero
// new playback code anywhere else in the app.
//
// v0.1.109 reworked this from three dropdowns + a delay number into the
// timeline below, per the owner: "a workstation of welding audio files
// together... cut, drag and drop them wherever you feel like and changing
// the volume at which audio file plays. If you want to fiddle around with
// remixing the audio you should just go to the remix tab" - so NO filter/EQ
// UI here, only trim/position/volume. Each member's own Remix filters/speed
// still bake in; only its Remix loop points are overridden by the timeline's
// own trim.

import { LANE_H, MIN_PX_PER_SEC, MAX_PX_PER_SEC, MIN_CLIP_SEC, snapMs, fmtSec } from '../domain/timeline.js'
import { escapeHtml } from '../domain/html.js'

export default class CompositePlugin {
  constructor(app) {
    this.app = app
    this.api = app.noctivago
    this.library = []
    this.durations = {} // soundId -> seconds (from the entry, or learned lazily)
    this.shown = false
    this._peaksCache = new Map() // "soundId|w|in|out" -> peaks (each entry = a real ffmpeg pass)
    this._resizeTimer = null
    this.members = [] // [{ soundId, delayMs, inSec, outSec, volume }]
    this.editingId = null
    this.selectedIndex = -1
    this.pxPerSec = 80
    this.drag = null
    this.preview = null // { ctx, nodes: [], timers: [] }
    this.els = {}
  }

  async onload() {
    this.unregister = this.app.tabs.register({
      id: 'composite',
      title: 'Composite',
      mount: (container) => this.mount(container),
      onShow: () => {
        this.shown = true
        this.refresh()
      },
      onHide: () => {
        this.shown = false
      }
    })
    // Pick up sounds added elsewhere (the + menu, a watched folder) without
    // needing to leave and re-enter the tab. Only act while the tab is
    // actually visible - refresh() re-extracts every clip waveform via
    // ffmpeg, and this fires on any app-wide library mutation (e.g. every
    // debounced Mixer volume save). onShow catches up whatever was missed.
    this._unsubLibrary = this.api.library.onChanged(() => {
      if (this.shown) this.refresh()
    })
  }

  async onunload() {
    this.stopPreview()
    this._unsubLibrary?.()
    clearTimeout(this._resizeTimer)
    if (this._onMove) window.removeEventListener('pointermove', this._onMove)
    if (this._onUp) window.removeEventListener('pointerup', this._onUp)
    if (this._onResize) window.removeEventListener('resize', this._onResize)
    this.unregister?.()
  }

  mount(container) {
    container.innerHTML = `
      <div class="composite-tab">
        <h2>Composite sound</h2>
        <p class="composite-hint">Weld two or more sounds into one new baked sound. Drag each clip to position it, drag its edges to trim, set its volume on the left. Filters and EQ stay in the Remix tab - remix a member first, or remix the finished composite after.</p>

        <div class="composite-top">
          <label><span>Edit existing</span>
            <select id="composite-existing"><option value="">New composite…</option></select>
          </label>
          <label><span>Name</span>
            <input id="composite-name" type="text" placeholder="Door effect" />
          </label>
        </div>

        <div class="composite-editor">
          <div class="composite-sidecol" id="composite-sidecol"></div>
          <div class="composite-scroll" id="composite-scroll">
            <div class="composite-ruler" id="composite-ruler"></div>
            <div class="composite-lanes" id="composite-lanes"></div>
          </div>
        </div>

        <div class="composite-toolbar">
          <button id="composite-add-member" class="btn btn-icon-text" type="button">+ Add sound</button>
          <button id="composite-preview" class="btn btn-icon-text" type="button">▶ Preview</button>
          <span class="composite-total" id="composite-total"></span>
        </div>

        <div class="composite-selected" id="composite-selected"></div>

        <button id="composite-bake" class="btn btn-primary btn-icon-text" type="button">Bake</button>
        <p id="composite-status" class="composite-status"></p>
      </div>
    `

    this.els = {
      existing: container.querySelector('#composite-existing'),
      name: container.querySelector('#composite-name'),
      editor: container.querySelector('.composite-editor'),
      sidecol: container.querySelector('#composite-sidecol'),
      scroll: container.querySelector('#composite-scroll'),
      ruler: container.querySelector('#composite-ruler'),
      lanes: container.querySelector('#composite-lanes'),
      addMember: container.querySelector('#composite-add-member'),
      preview: container.querySelector('#composite-preview'),
      total: container.querySelector('#composite-total'),
      selected: container.querySelector('#composite-selected'),
      bake: container.querySelector('#composite-bake'),
      status: container.querySelector('#composite-status')
    }

    this.els.existing.addEventListener('change', () => this.loadExisting(this.els.existing.value))
    this.els.addMember.addEventListener('click', () => {
      this.members.push(this.blankMember())
      this.selectedIndex = this.members.length - 1
      this.render()
    })
    this.els.preview.addEventListener('click', () => this.togglePreview())
    this.els.bake.addEventListener('click', () => this.bake())

    // Pointer drags on clips/handles are delegated from the lanes container.
    this.els.lanes.addEventListener('pointerdown', (e) => this.onPointerDown(e))
    window.addEventListener('pointermove', this._onMove = (e) => this.onPointerMove(e))
    window.addEventListener('pointerup', this._onUp = (e) => this.onPointerUp(e))
    // Debounced: a window-border drag fires `resize` continuously, and each
    // render() re-lays-out every clip (waveforms come from the cache unless
    // the pixel width actually changed).
    window.addEventListener('resize', this._onResize = () => {
      if (!this.shown) return
      clearTimeout(this._resizeTimer)
      this._resizeTimer = setTimeout(() => this.render(), 120)
    })

    this.members = [this.blankMember(), this.blankMember()]
    this.render()
    this.refresh().catch((err) => console.error('Composite: failed to load library', err))
  }

  blankMember() {
    return { soundId: '', delayMs: 0, inSec: null, outSec: null, volume: 1 }
  }

  async refresh() {
    // A member's underlying audio may have been re-baked/re-trimmed elsewhere
    // (Remix); drop the cache so waveforms re-fetch once here.
    this._peaksCache.clear()
    this.library = await this.api.library.list()
    for (const s of this.library) {
      if (s.durationSeconds != null && this.durations[s.id] == null) this.durations[s.id] = s.durationSeconds
    }
    const composites = this.library.filter((s) => s.compositeSource)
    const prev = this.els.existing.value
    this.els.existing.innerHTML =
      '<option value="">New composite…</option>' +
      composites.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')
    if (composites.some((c) => c.id === prev)) this.els.existing.value = prev
    this.render()
    // Learn any missing durations, then redraw once they're in.
    const missing = [...new Set(this.members.map((m) => m.soundId).filter((id) => id && this.durations[id] == null))]
    if (missing.length) {
      await Promise.all(missing.map((id) => this.ensureDuration(id)))
      this.render()
    }
  }

  ensureDuration(id) {
    if (!id || this.durations[id] != null) return Promise.resolve(this.durations[id])
    return new Promise((resolve) => {
      const a = new Audio(`sound://${id}`)
      const done = (val) => {
        if (val && Number.isFinite(val)) this.durations[id] = val
        resolve(this.durations[id])
      }
      a.addEventListener('loadedmetadata', () => done(a.duration), { once: true })
      a.addEventListener('error', () => done(null), { once: true })
    })
  }

  loadExisting(id) {
    this.stopPreview()
    this.els.status.textContent = ''
    if (!id) {
      this.editingId = null
      this.els.name.value = ''
      this.members = [this.blankMember(), this.blankMember()]
      this.selectedIndex = -1
      this.render()
      return
    }
    const entry = this.library.find((s) => s.id === id)
    if (!entry?.compositeSource) return
    this.editingId = id
    this.els.name.value = entry.name
    this.members = entry.compositeSource.members.map((m) => ({
      soundId: m.soundId,
      delayMs: m.delayMs ?? 0,
      inSec: m.inSec ?? null,
      outSec: m.outSec ?? null,
      volume: m.volume ?? 1
    }))
    this.selectedIndex = this.members.length ? 0 : -1
    this.refresh()
  }

  // Resolve a member's effective trim, filling nulls from the known duration.
  memberIn(m) {
    return Math.max(0, m.inSec ?? 0)
  }

  memberOut(m) {
    const dur = this.durations[m.soundId]
    if (m.outSec != null) return dur != null ? Math.min(m.outSec, dur) : m.outSec
    return dur != null ? dur : 1
  }

  memberLen(m) {
    return Math.max(MIN_CLIP_SEC, this.memberOut(m) - this.memberIn(m))
  }

  contentEndSec() {
    let end = 0
    for (const m of this.members) {
      if (!m.soundId) continue
      end = Math.max(end, m.delayMs / 1000 + this.memberLen(m))
    }
    return end
  }

  timelineSec() {
    return Math.max(4, this.contentEndSec() * 1.05 + 0.5)
  }

  render() {
    if (!this.els.lanes) return
    const totalSec = this.timelineSec()
    const availW = Math.max(240, (this.els.scroll?.clientWidth || 480) - 8)
    this.pxPerSec = Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, availW / totalSec))
    const trackW = Math.round(totalSec * this.pxPerSec)

    this.renderRuler(totalSec, trackW)
    this.renderSidecol()
    this.renderLanes(trackW)
    this.renderSelected()

    this.els.total.textContent = this.members.some((m) => m.soundId)
      ? `Length ${fmtSec(this.contentEndSec())}`
      : ''
    this.els.preview.disabled = !this.members.some((m) => m.soundId)
  }

  renderRuler(totalSec, trackW) {
    const step = totalSec < 6 ? 0.5 : totalSec < 20 ? 1 : totalSec < 90 ? 5 : 15
    let html = ''
    for (let t = 0; t <= totalSec + 1e-6; t += step) {
      const left = Math.round(t * this.pxPerSec)
      html += `<span class="composite-tick" style="left:${left}px">${fmtSec(t)}</span>`
    }
    this.els.ruler.style.width = `${trackW}px`
    this.els.ruler.innerHTML = html
  }

  renderSidecol() {
    const editable = this.library.filter((s) => s.status === 'ok' && s.id !== this.editingId)
    // A spacer matching the ruler height keeps the side boxes aligned with
    // their lanes across the scroll container.
    let html = `<div class="composite-side-spacer"></div>`
    this.members.forEach((m, i) => {
      const opts =
        `<option value="">Select a sound…</option>` +
        editable
          .map((s) => `<option value="${s.id}" ${s.id === m.soundId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`)
          .join('')
      html += `
        <div class="composite-side ${i === this.selectedIndex ? 'selected' : ''}" data-index="${i}" style="height:${LANE_H}px">
          <select class="composite-side-sound">${opts}</select>
          <div class="composite-side-row">
            <input class="composite-side-volume" type="range" min="0" max="2" step="0.01" value="${m.volume}" title="Volume" />
            <span class="composite-side-vol-val">${Math.round(m.volume * 100)}%</span>
            <button class="composite-side-remove btn btn-svg-icon" type="button" title="Remove">✕</button>
          </div>
        </div>`
    })
    this.els.sidecol.innerHTML = html

    this.els.sidecol.querySelectorAll('.composite-side').forEach((box) => {
      const i = Number(box.dataset.index)
      box.addEventListener('mousedown', (e) => {
        // Don't re-render on mousedown over an interactive control - doing so
        // replaces the <select>/<input> under the pointer before the native
        // dropdown or slider drag can start (the "sound picker isn't
        // clickable" bug). A cheap highlight update is all selection needs.
        if (e.target.closest('button, select, input')) return
        this.selectMember(i)
      })
      const soundSel = box.querySelector('.composite-side-sound')
      soundSel.addEventListener('focus', () => this.selectMember(i))
      soundSel.addEventListener('change', async (e) => {
        this.members[i].soundId = e.target.value
        this.members[i].inSec = null
        this.members[i].outSec = null
        this.selectedIndex = i
        await this.ensureDuration(e.target.value)
        this.render()
      })
      const vol = box.querySelector('.composite-side-volume')
      vol.addEventListener('focus', () => this.selectMember(i))
      vol.addEventListener('input', (e) => {
        this.members[i].volume = Number(e.target.value)
        box.querySelector('.composite-side-vol-val').textContent = `${Math.round(this.members[i].volume * 100)}%`
        this.applyPreviewVolume(i)
      })
      box.querySelector('.composite-side-remove').addEventListener('click', () => {
        this.members.splice(i, 1)
        if (this.selectedIndex >= this.members.length) this.selectedIndex = this.members.length - 1
        this.stopPreview()
        this.render()
      })
    })
  }

  renderLanes(trackW) {
    this.els.lanes.style.width = `${trackW}px`
    this.els.lanes.innerHTML = this.members
      .map((m, i) => {
        const inner = this.clipHtml(m, i)
        return `<div class="composite-lane" data-index="${i}" style="height:${LANE_H}px">${inner}</div>`
      })
      .join('')

    this.members.forEach((m, i) => {
      if (!m.soundId) return
      const canvas = this.els.lanes.querySelector(`.composite-lane[data-index="${i}"] canvas`)
      if (canvas) this.drawWave(canvas, m)
    })
  }

  clipHtml(m, i) {
    if (!m.soundId) {
      return `<div class="composite-clip-empty">pick a sound on the left</div>`
    }
    const left = Math.round((m.delayMs / 1000) * this.pxPerSec)
    const width = Math.max(10, Math.round(this.memberLen(m) * this.pxPerSec))
    const entry = this.library.find((s) => s.id === m.soundId)
    const name = entry ? entry.name : '(missing)'
    return `
      <div class="composite-clip ${i === this.selectedIndex ? 'selected' : ''}" data-index="${i}"
           style="left:${left}px;width:${width}px">
        <canvas></canvas>
        <span class="composite-clip-label">${escapeHtml(name)}</span>
        <div class="composite-clip-handle left" data-role="in"></div>
        <div class="composite-clip-handle right" data-role="out"></div>
      </div>`
  }

  async drawWave(canvas, m) {
    const cssW = canvas.clientWidth || Math.round(this.memberLen(m) * this.pxPerSec)
    const cssH = canvas.clientHeight || LANE_H - 20
    if (cssW < 2) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    const w = Math.max(8, Math.round(cssW))
    const cacheKey = `${m.soundId}|${w}|${this.memberIn(m).toFixed(3)}|${this.memberOut(m).toFixed(3)}`
    let peaks = this._peaksCache.get(cacheKey) ?? null
    if (!peaks) {
      try {
        peaks = await this.api.audio.getWaveformPeaks(m.soundId, w, this.memberIn(m), this.memberOut(m))
        if (peaks) this._peaksCache.set(cacheKey, peaks)
      } catch {
        peaks = null
      }
    }
    // The canvas may have been recycled by a re-render while we awaited.
    if (!canvas.isConnected) return
    const mid = cssH / 2
    ctx.strokeStyle = 'rgba(180, 200, 255, 0.75)'
    ctx.beginPath()
    if (peaks && peaks.length) {
      const n = peaks.length
      for (let x = 0; x < cssW; x++) {
        const p = peaks[Math.min(n - 1, Math.floor((x / cssW) * n))]
        ctx.moveTo(x + 0.5, mid - (p[1] || 0) * mid)
        ctx.lineTo(x + 0.5, mid - (p[0] || 0) * mid)
      }
    } else {
      ctx.moveTo(0, mid)
      ctx.lineTo(cssW, mid)
    }
    ctx.stroke()
  }

  // Cheap selection change - just move the highlight and refresh the
  // "Selected clip" fields, without rebuilding the sidecol/lanes DOM (which
  // would kill an in-progress <select>/slider interaction and refetch every
  // waveform).
  selectMember(i) {
    this.selectedIndex = i
    this.els.sidecol.querySelectorAll('.composite-side').forEach((c) =>
      c.classList.toggle('selected', Number(c.dataset.index) === i)
    )
    this.els.lanes.querySelectorAll('.composite-clip').forEach((c) =>
      c.classList.toggle('selected', Number(c.dataset.index) === i)
    )
    this.renderSelected()
  }

  renderSelected() {
    const m = this.members[this.selectedIndex]
    if (!m || !m.soundId) {
      this.els.selected.innerHTML = ''
      return
    }
    const startS = (m.delayMs / 1000).toFixed(2)
    const inS = this.memberIn(m).toFixed(2)
    const outS = this.memberOut(m).toFixed(2)
    this.els.selected.innerHTML = `
      <span class="composite-sel-title">Selected clip</span>
      <label>Start <input id="csel-start" type="number" min="0" step="0.05" value="${startS}" /> s</label>
      <label>In <input id="csel-in" type="number" min="0" step="0.05" value="${inS}" /> s</label>
      <label>Out <input id="csel-out" type="number" min="0" step="0.05" value="${outS}" /> s</label>
      <span class="composite-sel-len">Length ${fmtSec(this.memberLen(m))}</span>
    `
    const bind = (id, fn) =>
      this.els.selected.querySelector(id).addEventListener('change', (e) => {
        fn(Number(e.target.value))
        this.render()
      })
    const dur = this.durations[m.soundId] ?? Infinity
    bind('#csel-start', (v) => {
      m.delayMs = Math.max(0, Math.round(v * 1000))
    })
    bind('#csel-in', (v) => {
      m.inSec = Math.min(Math.max(0, v), this.memberOut(m) - MIN_CLIP_SEC)
    })
    bind('#csel-out', (v) => {
      m.outSec = Math.min(Math.max(this.memberIn(m) + MIN_CLIP_SEC, v), dur)
    })
  }

  // ---- drag ----

  onPointerDown(e) {
    const clip = e.target.closest('.composite-clip')
    if (!clip) return
    const i = Number(clip.dataset.index)
    const m = this.members[i]
    if (!m?.soundId) return
    this.selectedIndex = i
    const handle = e.target.closest('.composite-clip-handle')
    this.drag = {
      i,
      mode: handle ? handle.dataset.role : 'move',
      startX: e.clientX,
      origDelayMs: m.delayMs,
      origIn: this.memberIn(m),
      origOut: this.memberOut(m)
    }
    e.preventDefault()
    // Cheap selection highlight without a full re-render (which would refetch
    // every clip's waveform mid-grab).
    this.els.lanes.querySelectorAll('.composite-clip').forEach((c) => c.classList.toggle('selected', Number(c.dataset.index) === i))
    this.els.sidecol.querySelectorAll('.composite-side').forEach((c) => c.classList.toggle('selected', Number(c.dataset.index) === i))
  }

  onPointerMove(e) {
    if (!this.drag) return
    const m = this.members[this.drag.i]
    if (!m) return
    const deltaSec = (e.clientX - this.drag.startX) / this.pxPerSec
    const dur = this.durations[m.soundId] ?? Infinity

    if (this.drag.mode === 'move') {
      m.delayMs = snapMs(this.drag.origDelayMs + deltaSec * 1000, e.ctrlKey)
    } else if (this.drag.mode === 'in') {
      // Trim the head: move the in-point and shift the clip's start by the
      // same amount so the audio under the pointer stays put (DAW feel).
      let newIn = this.drag.origIn + deltaSec
      newIn = Math.max(0, Math.min(newIn, this.drag.origOut - MIN_CLIP_SEC))
      m.inSec = newIn
      m.delayMs = Math.max(0, Math.round((this.drag.origDelayMs + (newIn - this.drag.origIn) * 1000)))
    } else if (this.drag.mode === 'out') {
      let newOut = this.drag.origOut + deltaSec
      newOut = Math.min(dur, Math.max(newOut, this.drag.origIn + MIN_CLIP_SEC))
      m.outSec = newOut
    }
    this.layoutClip(this.drag.i)
    const totalSec = this.timelineSec()
    const trackW = Math.round(totalSec * this.pxPerSec)
    this.els.lanes.style.width = `${trackW}px`
    this.renderRuler(totalSec, trackW)
    this.els.total.textContent = `Length ${fmtSec(this.contentEndSec())}`
  }

  onPointerUp() {
    if (!this.drag) return
    this.drag = null
    this.render() // resync waveform (trim changed the window) + numeric fields
  }

  // Cheap in-drag reposition without a full re-render.
  layoutClip(i) {
    const clip = this.els.lanes.querySelector(`.composite-clip[data-index="${i}"]`)
    if (!clip) return
    const m = this.members[i]
    clip.style.left = `${Math.round((m.delayMs / 1000) * this.pxPerSec)}px`
    clip.style.width = `${Math.max(10, Math.round(this.memberLen(m) * this.pxPerSec))}px`
  }

  // ---- preview (timing/overlap only; filters/EQ are bake-time) ----

  togglePreview() {
    if (this.preview) this.stopPreview()
    else this.startPreview()
  }

  startPreview() {
    const members = this.members.filter((m) => m.soundId)
    if (!members.length) return
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const nodes = []
    const timers = []
    members.forEach((m) => {
      const el = new Audio()
      el.crossOrigin = 'anonymous' // must precede .src for the custom scheme not to taint the graph
      el.preload = 'auto'
      el.src = `sound://${m.soundId}`
      const src = ctx.createMediaElementSource(el)
      const gain = ctx.createGain()
      gain.gain.value = m.volume * 0.85
      src.connect(gain).connect(ctx.destination)
      const inS = this.memberIn(m)
      const outS = this.memberOut(m)
      const startAt = m.delayMs
      const rec = { el, gain, member: m }
      nodes.push(rec)
      timers.push(
        setTimeout(() => {
          try {
            el.currentTime = inS
            el.play().catch(() => {})
          } catch {
            /* seek can throw before metadata; play's canplay will retry */
          }
          timers.push(setTimeout(() => el.pause(), Math.max(50, (outS - inS) * 1000)))
        }, startAt)
      )
    })
    this.preview = { ctx, nodes, timers }
    this.els.preview.textContent = '■ Stop'
    this.els.preview.classList.add('btn-svg-icon-active')
    // Auto-stop once the longest clip has finished.
    const totalMs = this.contentEndSec() * 1000 + 200
    this.preview.timers.push(setTimeout(() => this.stopPreview(), totalMs))
  }

  applyPreviewVolume(i) {
    if (!this.preview) return
    const m = this.members[i]
    const rec = this.preview.nodes.find((n) => n.member === m)
    if (rec) rec.gain.gain.value = m.volume * 0.85
  }

  stopPreview() {
    if (!this.preview) return
    this.preview.timers.forEach(clearTimeout)
    this.preview.nodes.forEach((n) => {
      try {
        n.el.pause()
      } catch {
        /* ignore */
      }
    })
    this.preview.ctx.close().catch(() => {})
    this.preview = null
    if (this.els.preview) {
      this.els.preview.textContent = '▶ Preview'
      this.els.preview.classList.remove('btn-svg-icon-active')
    }
  }

  // ---- bake ----

  async bake() {
    this.stopPreview()
    const name = this.els.name.value.trim()
    if (!name) {
      this.els.status.textContent = 'Give it a name first.'
      return
    }
    const usable = this.members.filter((m) => m.soundId)
    if (usable.length < 2) {
      this.els.status.textContent = 'Choose at least two sounds.'
      return
    }
    // Make sure every trim is concrete before sending (nulls -> real values).
    await Promise.all(usable.map((m) => this.ensureDuration(m.soundId)))
    const members = usable.map((m) => ({
      soundId: m.soundId,
      delayMs: Math.max(0, Math.round(m.delayMs)),
      inSec: this.memberIn(m),
      outSec: this.memberOut(m),
      volume: Math.max(0, Math.min(4, m.volume ?? 1))
    }))

    this.els.bake.disabled = true
    this.els.status.textContent = this.editingId ? 'Re-baking…' : 'Baking…'
    try {
      const result = this.editingId
        ? await this.api.composite.rebake({ id: this.editingId, name, members })
        : await this.api.composite.create({ name, members })
      if (result.ok) {
        this.els.status.textContent = `Saved "${name}" - open it in Remix or add it to a mix like any other sound.`
        this.editingId = result.entry.id
        await this.refresh()
        this.els.existing.value = this.editingId
      } else {
        this.els.status.textContent = `Failed: ${result.error}`
      }
    } catch (err) {
      console.error('Composite bake failed', err)
      this.els.status.textContent = `Failed: ${err.message}`
    } finally {
      this.els.bake.disabled = false
    }
  }
}
