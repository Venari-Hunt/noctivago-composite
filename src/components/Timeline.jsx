// The timeline card's parts: ruler, layer headers, lanes with their clips (and
// each clip's waveform), the playhead, and the overview row. All of them are
// laid out from one zoom (px per second) and one scroll position owned by
// CompositeApp.
import { memo, useEffect, useRef, useSyncExternalStore } from 'react'
import { LANE_H, fmtSec, rulerLabel, rulerMarks } from '../domain/timeline.js'
import { memberIn, memberLen, memberOut } from '../domain/members.js'
import { overviewDrag, viewBox } from '../domain/zoom.js'

// The playhead's time lives in a tiny store so the ~60 updates a second during
// Preview re-render only the playhead, the time readout and the overview marker.
export function createPlayheadStore() {
  let t = 0
  const subs = new Set()
  return {
    get: () => t,
    set(v) {
      if (v === t) return
      t = v
      subs.forEach((fn) => fn())
    },
    subscribe(fn) {
      subs.add(fn)
      return () => subs.delete(fn)
    }
  }
}

const usePlayhead = (store) => useSyncExternalStore(store.subscribe, store.get)

export function TimeReadout({ store, total }) {
  const t = usePlayhead(store)
  return (
    <span className="cp-time" aria-live="off">
      <b>{fmtSec(t)}</b> / {fmtSec(total)}
    </span>
  )
}

export function Playhead({ store, px }) {
  const t = usePlayhead(store)
  return <div className="cp-playhead" style={{ left: `${t * px}px` }} />
}

// ---- waveform ----

const MAX_PEAK_COLUMNS = 4096

// Draws a clip's waveform. The bitmap is only redrawn once the clip's size has
// settled (a trim drag or a zoom changes it every frame, and each new width is
// a real ffmpeg pass); until then the canvas is just stretched by CSS.
function Wave({ api, cache, version, soundId, inSec, outSec, width }) {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || width < 2) return
    const cols = Math.min(MAX_PEAK_COLUMNS, Math.max(8, Math.round(width)))
    const key = `${soundId}|${cols}|${inSec.toFixed(3)}|${outSec.toFixed(3)}`
    let cancelled = false
    const draw = (peaks) => {
      if (cancelled || !canvas.isConnected) return
      const cssW = canvas.clientWidth || width
      const cssH = canvas.clientHeight || 16
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.min(Math.round(cssW * dpr), 8192)
      canvas.height = Math.round(cssH * dpr)
      const ctx = canvas.getContext('2d')
      const sx = canvas.width / cssW
      ctx.setTransform(sx, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssW, cssH)
      const mid = cssH / 2
      // Canvas can't read var(); take --tint-ink from the page. The mock draws
      // it at 60%.
      ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue('--tint-ink').trim() || 'currentColor'
      ctx.globalAlpha = 0.6
      ctx.lineWidth = 1
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
    const cached = cache.get(key)
    if (cached) {
      draw(cached)
      return
    }
    const timer = setTimeout(async () => {
      let peaks = null
      try {
        peaks = await api.audio.getWaveformPeaks(soundId, cols, inSec, outSec)
        if (peaks) cache.set(key, peaks)
      } catch {
        peaks = null
      }
      draw(peaks)
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [api, cache, version, soundId, inSec, outSec, width])
  return <canvas ref={ref} />
}

const Clip = memo(function Clip({ api, cache, version, m, index, name, selected, px, durations }) {
  const left = Math.round((m.delayMs / 1000) * px)
  const width = Math.max(10, Math.round(memberLen(m, durations) * px))
  return (
    <div
      className="cp-clip composite-clip"
      data-index={index}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Clip: ${name}`}
      style={{ left: `${left}px`, width: `${width}px` }}
    >
      <Wave
        api={api}
        cache={cache}
        version={version}
        soundId={m.soundId}
        inSec={memberIn(m)}
        outSec={memberOut(m, durations)}
        width={width}
      />
      <b>{name}</b>
      <span className="composite-clip-handle left" data-role="in" title="Drag to trim the start" />
      <span className="composite-clip-handle right" data-role="out" title="Drag to trim the end" />
    </div>
  )
})

// ---- the timeline card ----

export function Ruler({ rulerRef, px, totalSec, innerW, onSeek }) {
  const marks = rulerMarks(px, totalSec)
  return (
    <div
      className="cp-ruler"
      ref={rulerRef}
      title="Click to move the playhead"
      onPointerDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        onSeek(e.clientX - rect.left)
      }}
    >
      <div className="cp-ruler-in" style={{ width: `${innerW}px` }}>
        {marks.map((mk) => {
          const left = Math.round(mk.t * px)
          return (
            <span key={mk.k}>
              <i className={mk.big ? 'big' : ''} style={{ left: `${left}px` }} />
              {mk.big && (
                <span className={`cp-ruler-lbl${left > innerW - 56 ? ' end' : ''}`} style={{ left: `${left}px` }}>
                  {rulerLabel(mk.t)}
                </span>
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export function LayerHeads({ members, library, selected, onSelect }) {
  return (
    <div className="cp-heads" role="listbox" aria-label="Layers">
      {members.map((m, i) => {
        const entry = library.find((s) => s.id === m.soundId)
        const picked = Boolean(m.soundId)
        return (
          <div
            key={m.uid}
            className="cp-lh composite-side"
            data-index={i}
            role="option"
            tabIndex={0}
            aria-selected={i === selected}
            onPointerDown={() => onSelect(i)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(i)
              }
            }}
          >
            <span className="cp-lbl">
              <span className="cp-lname">{picked ? (entry ? entry.name : '(missing)') : 'Empty layer'}</span>
              <span className="cp-lsub">{`Layer ${i + 1}`}</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function Lanes({ lanesRef, api, cache, version, members, durations, library, selected, px, innerW, onPointerDown, onScroll, store }) {
  return (
    <div className="cp-lanes" ref={lanesRef} onPointerDown={onPointerDown} onScroll={onScroll}>
      <div className="cp-lanes-in" style={{ width: `${innerW}px` }}>
        {members.map((m, i) => {
          const entry = library.find((s) => s.id === m.soundId)
          return (
            <div key={m.uid} className="cp-lane composite-lane" data-index={i} style={{ height: `${LANE_H}px` }}>
              {m.soundId ? (
                <Clip
                  api={api}
                  cache={cache}
                  version={version}
                  m={m}
                  index={i}
                  name={entry ? entry.name : '(missing)'}
                  selected={i === selected}
                  px={px}
                  durations={durations}
                />
              ) : (
                <div className="cp-lane0">Pick a sound in the Layer card to place it</div>
              )}
            </div>
          )
        })}
        <div className="cp-drop">Add a layer, then pick its sound in the Layer card</div>
        <Playhead store={store} px={px} />
      </div>
    </div>
  )
}

// ---- overview (row 4): the whole composite at a glance; drag the box to
// scroll, drag its edges to zoom, click to jump ----

export function Overview({ members, durations, selected, px, viewW, scrollLeft, totalSec, store, onView }) {
  const ref = useRef(null)
  const drag = useRef(null)
  const t = usePlayhead(store)
  const box = viewBox({ scrollLeft, viewW, px, totalSec })
  const n = members.length
  const step = n > 4 ? 16 / (n - 1) : 6

  const onPointerDown = (e) => {
    const el = ref.current
    const rect = el.getBoundingClientRect()
    const frac = (e.clientX - rect.left) / rect.width
    const role = e.target.closest('[data-role]')?.dataset.role
    let start = { px, scrollLeft, viewW }
    let mode = role || 'move'
    if (!role) {
      // A click outside the box centres the view on that time.
      const centre = Math.max(0, frac * totalSec - viewW / px / 2)
      start = { px, scrollLeft: centre * px, viewW }
      onView({ px, scrollLeft: start.scrollLeft })
      mode = 'move'
    }
    drag.current = { mode, startX: e.clientX, start, width: rect.width }
    el.setPointerCapture(e.pointerId)
    e.preventDefault()
  }
  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    const dtSec = ((e.clientX - d.startX) / d.width) * totalSec
    onView(overviewDrag({ mode: d.mode, dtSec, start: d.start, totalSec }))
  }
  const onPointerUp = () => {
    drag.current = null
  }

  return (
    <div
      className="cp-overview"
      ref={ref}
      role="group"
      aria-label="Overview"
      title="Drag the box to scroll; drag its edges to zoom"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {members.map((m, i) => {
        if (!m.soundId) return null
        const start = m.delayMs / 1000
        return (
          <i
            key={m.uid}
            className={i === selected ? 'sel' : ''}
            style={{
              top: `${8 + i * step}px`,
              left: `${(start / totalSec) * 100}%`,
              width: `${(memberLen(m, durations) / totalSec) * 100}%`
            }}
          />
        )
      })}
      <span className="cp-view" data-role="move" style={{ left: `${box.left * 100}%`, width: `${box.width * 100}%` }}>
        <span className="cp-view-edge left" data-role="left" />
        <span className="cp-view-edge right" data-role="right" />
      </span>
      <span className="cp-oph" style={{ left: `${(t / totalSec) * 100}%` }} />
    </div>
  )
}
