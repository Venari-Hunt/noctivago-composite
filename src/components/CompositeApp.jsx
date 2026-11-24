// The Composite tab as React, laid out like the approved v2 mock (Global
// Management design-system/dist/tool/mock-noctivago-composite.html): the editor
// on the left in four rows (which composite, tools, timeline, overview), the
// inspector on the right (Clip, Layer, Composite).
//
// A composite is a list of members (one per layer) that gets baked into one
// normal library sound. The rules are pure code in ../domain (tested); this
// file wires them to the screen: drag/trim, the typed fields, zoom and
// navigation, Preview and Make sound.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Icon } from './icons.jsx'
import { Lanes, LayerHeads, Overview, Ruler, TimeReadout, createPlayheadStore } from './Timeline.jsx'
import { ClipCard, CompositeCard, LayerCard, NoClipCard } from './Inspector.jsx'
import { MIN_CLIP_SEC, VOLUME_MAX, fmtSec, snapMs } from '../domain/timeline.js'
import {
  blankMember,
  contentEndSec,
  memberFromSaved,
  memberIn,
  memberOut,
  previewPlan,
  timelineSec,
  trimStartPatch
} from '../domain/members.js'
import {
  clampZoom,
  fitZoom,
  fmtShown,
  scrollAfterZoom,
  shownSec,
  sliderToZoom,
  stepZoom,
  timeAtX,
  wheelZoom,
  zoomToSlider
} from '../domain/zoom.js'
import { Preview } from '../audio/preview.js'

// Mounts the tab into the host's container; the plugin class drives it.
export function mountComposite(container, { api }) {
  const root = createRoot(container)
  const ctl = { refresh: () => {}, setShown: () => {} }
  root.render(<CompositeApp api={api} ctl={ctl} />)
  return {
    refresh: () => ctl.refresh(),
    setShown: (v) => ctl.setShown(v),
    unmount: () => root.unmount()
  }
}

function CompositeApp({ api, ctl }) {
  const [library, setLibrary] = useState([])
  const [durations, setDurations] = useState({}) // soundId -> seconds
  const [members, setMembers] = useState(() => [blankMember(), blankMember()])
  const [selected, setSelected] = useState(0)
  const [editingId, setEditingId] = useState('')
  const [name, setName] = useState('')
  const [status, setStatus] = useState('')
  const [baking, setBaking] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [zoom, setZoom] = useState(null) // px per second; null = Fit
  const [frozenPx, setFrozenPx] = useState(null) // Fit holds still during a drag
  const [viewW, setViewW] = useState(720)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [peaksVersion, setPeaksVersion] = useState(0)

  const playhead = useMemo(createPlayheadStore, [])
  const peaks = useRef(new Map()) // "soundId|w|in|out" -> peaks (each entry is a real ffmpeg pass)
  const lanesRef = useRef(null)
  const rulerRef = useRef(null)
  const pendingScroll = useRef(null) // a scroll position to apply once the new zoom is laid out
  const shown = useRef(false)
  const dragRef = useRef(null)
  const preview = useRef(null)
  const live = useRef({})

  // ---- derived layout ----
  const totalSec = timelineSec(members, durations)
  const contentEnd = contentEndSec(members, durations)
  const hasSounds = members.some((m) => m.soundId)
  const fitPx = fitZoom(Math.max(240, viewW), totalSec)
  const px = frozenPx ?? zoom ?? fitPx
  const innerW = Math.max(Math.round(totalSec * px), viewW)
  live.current = { members, durations, px, totalSec, contentEnd, viewW }

  // ---- members ----
  const patchMember = useCallback((uid, fn) => {
    setMembers((ms) => ms.map((m) => (m.uid === uid ? { ...m, ...fn(m) } : m)))
  }, [])

  const ensureDuration = useCallback((id) => {
    const known = live.current.durations[id]
    if (!id || known != null) return Promise.resolve(known)
    return new Promise((resolve) => {
      const a = new Audio(`sound://${id}`)
      const done = (val) => {
        const ok = val && Number.isFinite(val) ? val : null
        if (ok) setDurations((d) => (d[id] != null ? d : { ...d, [id]: ok }))
        resolve(ok)
      }
      a.addEventListener('loadedmetadata', () => done(a.duration), { once: true })
      a.addEventListener('error', () => done(null), { once: true })
    })
  }, [])

  const refresh = useCallback(async () => {
    // A member's underlying audio may have been re-baked/re-trimmed elsewhere
    // (Remix); drop the cache so waveforms re-fetch once here.
    peaks.current.clear()
    setPeaksVersion((v) => v + 1)
    const lib = await api.library.list()
    setLibrary(lib)
    const known = { ...live.current.durations }
    for (const s of lib) if (s.durationSeconds != null && known[s.id] == null) known[s.id] = s.durationSeconds
    setDurations((d) => {
      const next = { ...d }
      for (const s of lib) if (s.durationSeconds != null && next[s.id] == null) next[s.id] = s.durationSeconds
      return next
    })
    // Learn any missing durations; the layout redraws once they're in.
    const missing = [...new Set(live.current.members.map((m) => m.soundId).filter((id) => id && known[id] == null))]
    await Promise.all(missing.map(ensureDuration))
  }, [api, ensureDuration])

  const newComposite = () => {
    stopPreview()
    setStatus('')
    setEditingId('')
    setName('')
    setMembers([blankMember(), blankMember()])
    setSelected(0)
    playhead.set(0)
  }

  const loadExisting = (id) => {
    stopPreview()
    setStatus('')
    if (!id) return newComposite()
    const entry = library.find((s) => s.id === id)
    if (!entry?.compositeSource) return
    setEditingId(id)
    setName(entry.name)
    setMembers(entry.compositeSource.members.map(memberFromSaved))
    setSelected(0)
    playhead.set(0)
    refresh().catch((err) => console.error('Composite: failed to load library', err))
  }

  const removeMember = (i) => {
    stopPreview()
    setMembers((ms) => ms.filter((_, j) => j !== i))
    setSelected((s) => Math.min(s, Math.max(0, live.current.members.length - 2)))
  }

  const addLayer = () => {
    setMembers((ms) => [...ms, blankMember()])
    setSelected(live.current.members.length)
  }

  const setSound = async (i, soundId) => {
    const uid = live.current.members[i].uid
    patchMember(uid, () => ({ soundId, inSec: null, outSec: null }))
    setSelected(i)
    await ensureDuration(soundId)
  }

  const setVolume = (i, volume) => {
    const m = live.current.members[i]
    const v = Math.max(0, Math.min(VOLUME_MAX, volume))
    patchMember(m.uid, () => ({ volume: v }))
    preview.current?.setVolume(m.uid, v)
  }

  // ---- zoom and navigation ----
  const zoomTo = useCallback((next, anchorX) => {
    const cur = live.current.px
    const target = clampZoom(next)
    if (target === cur) return
    const base = pendingScroll.current ?? lanesRef.current?.scrollLeft ?? 0
    pendingScroll.current = scrollAfterZoom({ pxOld: cur, pxNew: target, anchorX, scrollLeft: base })
    live.current.px = target
    setZoom(target)
  }, [])

  const fit = () => {
    pendingScroll.current = 0
    setZoom(null)
    if (lanesRef.current) lanesRef.current.scrollLeft = 0
  }

  // The overview drives zoom and scroll together (edges zoom, the box scrolls).
  const setView = useCallback((v) => {
    if (v.px !== live.current.px) {
      pendingScroll.current = v.scrollLeft
      live.current.px = v.px
      setZoom(v.px)
    } else if (lanesRef.current) {
      lanesRef.current.scrollLeft = v.scrollLeft
    }
  }, [])

  // After a zoom is laid out, restore the scroll that keeps the anchor in place.
  useLayoutEffect(() => {
    const lanes = lanesRef.current
    if (pendingScroll.current != null && lanes) {
      lanes.scrollLeft = pendingScroll.current
      if (rulerRef.current) rulerRef.current.scrollLeft = lanes.scrollLeft
      setScrollLeft(lanes.scrollLeft)
      pendingScroll.current = null
    }
  })

  const onLanesScroll = (e) => {
    const s = e.currentTarget.scrollLeft
    if (rulerRef.current) rulerRef.current.scrollLeft = s
    setScrollLeft(s)
  }

  // The visible width of the lanes decides Fit and the overview box.
  useLayoutEffect(() => {
    const lanes = lanesRef.current
    if (!lanes) return
    const measure = () => setViewW(lanes.clientWidth || 720)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(lanes)
    return () => ro.disconnect()
  }, [])

  // Ctrl+wheel zooms around the pointer; the plain wheel scrolls sideways when
  // the timeline is wider than the screen. Needs non-passive listeners.
  useEffect(() => {
    const lanes = lanesRef.current
    const ruler = rulerRef.current
    const onWheel = (e) => {
      if (e.ctrlKey) {
        e.preventDefault()
        const rect = lanes.getBoundingClientRect()
        zoomTo(wheelZoom(live.current.px, e.deltaY), e.clientX - rect.left)
      } else if (lanes.scrollWidth > lanes.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault()
        lanes.scrollLeft += e.deltaY
      }
    }
    lanes.addEventListener('wheel', onWheel, { passive: false })
    ruler.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      lanes.removeEventListener('wheel', onWheel)
      ruler.removeEventListener('wheel', onWheel)
    }
  }, [zoomTo])

  // ---- Preview ----
  if (!preview.current) {
    preview.current = new Preview({
      onTick: (t) => playhead.set(t),
      onEnd: (t) => {
        playhead.set(t)
        setPreviewing(false)
      }
    })
  }

  function stopPreview() {
    preview.current?.stop()
  }

  const startPreviewAt = (from) => {
    const { members: ms, durations: ds, contentEnd: end } = live.current
    const plan = previewPlan(ms, ds, from)
    const ok = preview.current.start({ plan, members: ms, from, endSec: end })
    setPreviewing(ok)
    return ok
  }

  const togglePreview = () => {
    if (preview.current.active) return stopPreview()
    let from = playhead.get()
    if (from >= live.current.contentEnd - 0.01) from = 0
    playhead.set(from)
    startPreviewAt(from)
  }

  // Clicking the ruler moves the playhead; a running Preview carries on from there.
  const seek = (x) => {
    const t = Math.min(live.current.totalSec, timeAtX(x, lanesRef.current?.scrollLeft ?? 0, live.current.px))
    playhead.set(t)
    if (preview.current.active) startPreviewAt(t)
  }

  // ---- drag a clip or one of its trim handles ----
  const onLanesPointerDown = (e) => {
    const laneEl = e.target.closest('.composite-lane')
    if (!laneEl) return
    const i = Number(laneEl.dataset.index)
    setSelected(i)
    if (!e.target.closest('.composite-clip')) return
    const m = members[i]
    if (!m?.soundId) return
    const handle = e.target.closest('.composite-clip-handle')
    dragRef.current = {
      uid: m.uid,
      mode: handle ? handle.dataset.role : 'move',
      startX: e.clientX,
      origDelayMs: m.delayMs,
      origIn: memberIn(m),
      origOut: memberOut(m, durations)
    }
    setFrozenPx(px) // Fit stays still while a drag changes the total length
    e.preventDefault()
  }

  useEffect(() => {
    const move = (e) => {
      const d = dragRef.current
      if (!d) return
      const { durations: ds, members: ms, px: scale } = live.current
      const m = ms.find((x) => x.uid === d.uid)
      if (!m) return
      const deltaSec = (e.clientX - d.startX) / scale
      const dur = ds[m.soundId] ?? Infinity
      if (d.mode === 'move') {
        patchMember(d.uid, () => ({ delayMs: snapMs(d.origDelayMs + deltaSec * 1000, e.ctrlKey) }))
      } else if (d.mode === 'in') {
        // Trim the head: move the in-point and shift the clip's start by the
        // same amount so the audio under the pointer stays put (DAW feel).
        patchMember(d.uid, () =>
          trimStartPatch({ delayMs: d.origDelayMs, inSec: d.origIn, outSec: d.origOut }, d.origIn + deltaSec)
        )
      } else {
        const newOut = Math.min(dur, Math.max(d.origOut + deltaSec, d.origIn + MIN_CLIP_SEC))
        patchMember(d.uid, () => ({ outSec: newOut }))
      }
    }
    const up = () => {
      if (!dragRef.current) return
      dragRef.current = null
      setFrozenPx(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [patchMember])

  // ---- Make sound ----
  const bake = async () => {
    stopPreview()
    const trimmed = name.trim()
    if (!trimmed) return setStatus('Give it a name first.')
    const usable = members.filter((m) => m.soundId)
    if (usable.length < 2) return setStatus('Choose at least two sounds.')
    // Make sure every trim is concrete before sending (nulls -> real values).
    const ds = { ...durations }
    await Promise.all(
      usable.map(async (m) => {
        const d = await ensureDuration(m.soundId)
        if (d != null) ds[m.soundId] = d
      })
    )
    const payload = usable.map((m) => ({
      soundId: m.soundId,
      delayMs: Math.max(0, Math.round(m.delayMs)),
      inSec: memberIn(m),
      outSec: memberOut(m, ds),
      volume: Math.max(0, Math.min(4, m.volume ?? 1))
    }))
    setBaking(true)
    setStatus(editingId ? 'Remaking the sound…' : 'Making the sound…')
    try {
      const result = editingId
        ? await api.composite.rebake({ id: editingId, name: trimmed, members: payload })
        : await api.composite.create({ name: trimmed, members: payload })
      if (result.ok) {
        setStatus(`Saved "${trimmed}". Open it in Remix or add it to a mix like any other sound.`)
        await refresh()
        setEditingId(result.entry.id)
      } else {
        setStatus(`Failed: ${result.error}`)
      }
    } catch (err) {
      console.error('Composite bake failed', err)
      setStatus(`Failed: ${err.message}`)
    } finally {
      setBaking(false)
    }
  }

  // ---- lifecycle ----
  useEffect(() => {
    ctl.refresh = () => refresh().catch((err) => console.error('Composite: failed to load library', err))
    ctl.setShown = (v) => {
      shown.current = v
      if (v) ctl.refresh()
    }
  })
  useEffect(() => {
    refresh().catch((err) => console.error('Composite: failed to load library', err))
    return () => preview.current?.stop(undefined, true)
  }, [refresh])

  // ---- render ----
  const sel = members[selected]
  const editableSounds = library.filter((s) => s.status === 'ok' && s.id !== editingId)
  const composites = library.filter((s) => s.compositeSource)
  const selEntry = sel ? library.find((s) => s.id === sel.soundId) : null
  const zoomLabel = fmtShown(shownSec(viewW, px))

  return (
    <div className="composite-tab">
      <section className="cp-pane cp-editor" aria-label="Composite editor">
        {/* Row 1, which composite: pick, start a new one, make the sound. */}
        <div className="cp-head">
          <label className="cp-pick" title="Open another composite">
            <select id="composite-existing" aria-label="Composite" value={editingId} onChange={(e) => loadExisting(e.target.value)}>
              <option value="">New composite</option>
              {composites.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <Icon name="caret" />
          </label>
          <button className="cp-b cp-ghost" type="button" title="Start an empty composite" onClick={newComposite}>
            <Icon name="plus" />
            New
          </button>
          <button
            id="composite-bake"
            className="cp-b cp-pri cp-push"
            type="button"
            title="Render the layers into one sound in your library"
            disabled={baking}
            onClick={bake}
          >
            <Icon name="check" />
            Make sound
          </button>
        </div>

        {/* Row 2, tools: preview, zoom. */}
        <div className="cp-tools" role="toolbar" aria-label="Timeline tools">
          <button
            id="composite-preview"
            className={`cp-b ${previewing ? 'cp-on' : 'cp-fill'} cp-preview`}
            type="button"
            aria-pressed={previewing}
            title="Preview the mix"
            disabled={!hasSounds}
            onClick={togglePreview}
          >
            <Icon name={previewing ? 'stop' : 'play'} />
            <span>{previewing ? 'Stop' : 'Preview'}</span>
          </button>
          <TimeReadout store={playhead} total={contentEnd} />
          <div className="cp-zoom cp-push" role="group" aria-label="Zoom">
            <button className="cp-ib" type="button" title="Zoom out (Ctrl+wheel)" aria-label="Zoom out" onClick={() => zoomTo(stepZoom(px, -1), viewW / 2)}>
              <Icon name="minus" />
            </button>
            <input
              id="composite-zoom"
              type="range"
              min="0"
              max="100"
              step="0.5"
              value={zoomToSlider(px)}
              aria-label="Zoom"
              title="Ctrl+wheel zooms around the pointer"
              onChange={(e) => zoomTo(sliderToZoom(e.target.value), viewW / 2)}
            />
            <button className="cp-ib" type="button" title="Zoom in (Ctrl+wheel)" aria-label="Zoom in" onClick={() => zoomTo(stepZoom(px, 1), viewW / 2)}>
              <Icon name="plus" />
            </button>
            <span className="cp-zoom-val">{zoomLabel}</span>
          </div>
          <button id="composite-fit" className="cp-b cp-ghost cp-fit" type="button" title="Show the whole composite" onClick={fit}>
            <Icon name="fit" />
            Fit
          </button>
        </div>

        {/* Row 3, the timeline: layers and their clips. */}
        <div className="cp-tl" id="composite-tl">
          <div className="cp-corner">Layers</div>
          <Ruler rulerRef={rulerRef} px={px} totalSec={totalSec} innerW={innerW} onSeek={seek} />
          <div className="cp-tl-body">
            <LayerHeads members={members} library={library} selected={selected} onSelect={setSelected} />
            <Lanes
              lanesRef={lanesRef}
              api={api}
              cache={peaks.current}
              version={peaksVersion}
              members={members}
              durations={durations}
              library={library}
              selected={selected}
              px={px}
              innerW={innerW}
              onPointerDown={onLanesPointerDown}
              onScroll={onLanesScroll}
              store={playhead}
            />
          </div>
        </div>

        {/* Row 4, navigation: add a layer under the headers; the overview under the time. */}
        <div className="cp-nav">
          <div className="cp-nav-cell">
            <button id="composite-add-member" className="cp-b cp-fill" type="button" title="Add an empty layer at the bottom" onClick={addLayer}>
              <Icon name="plus" />
              Add layer
            </button>
          </div>
          <Overview
            members={members}
            durations={durations}
            selected={selected}
            px={px}
            viewW={viewW}
            scrollLeft={scrollLeft}
            totalSec={totalSec}
            store={playhead}
            onView={setView}
          />
        </div>
      </section>

      <aside className="cp-pane cp-side" aria-label="Inspector">
        {sel?.soundId ? (
          <ClipCard
            key={sel.uid}
            m={sel}
            entry={selEntry}
            durations={durations}
            onStart={(v) => patchMember(sel.uid, () => ({ delayMs: Math.max(0, Math.round(v * 1000)) }))}
            onIn={(v) =>
              patchMember(sel.uid, (m) =>
                trimStartPatch({ delayMs: m.delayMs, inSec: memberIn(m), outSec: memberOut(m, durations) }, v)
              )
            }
            onOut={(v, dur) =>
              patchMember(sel.uid, (m) => ({ outSec: Math.min(Math.max(memberIn(m) + MIN_CLIP_SEC, v), dur) }))
            }
            onVolume={(v) => setVolume(selected, v)}
            onRemove={() => removeMember(selected)}
          />
        ) : (
          <NoClipCard />
        )}
        {sel && (
          <LayerCard
            m={sel}
            index={selected}
            count={members.length}
            sounds={editableSounds}
            onSound={(id) => setSound(selected, id)}
            onVolume={(v) => setVolume(selected, v)}
            onRemove={() => removeMember(selected)}
          />
        )}
        <CompositeCard
          name={name}
          onName={setName}
          total={hasSounds ? fmtSec(contentEnd) : '--'}
          layers={members.length}
          status={status}
        />
      </aside>
    </div>
  )
}
