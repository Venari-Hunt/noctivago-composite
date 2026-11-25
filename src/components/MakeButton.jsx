import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './icons.jsx'

// Make sound works in place (micro-interactions mock, row "Composite: Make sound"): the button
// morphs into Making sound (spinner, only after 400 ms), then a drawn check with "Saved to your
// library" held 1.4 s, or a short reason in soft red held 4.2 s. Width eases between states and each
// state stays centered. Same timing and colors as the app's morph button (app ui/morphButton.js);
// the CSS lives in this plugin so it also works on apps before 2.0.
export const MAKE_TIMING = { workingDelay: 400, doneHold: 1400, failHold: 4200 }

// The button has room for a short reason; the full one stays in the status line below it.
export function shortFailure(reason, max = 36) {
  const t = String(reason || 'Failed').replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '').trim().replace(/\.$/, '')
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t
}

function Row({ phase, text }) {
  if (phase === 'working')
    return (
      <>
        <i className="cp-spin" />
        {text}
      </>
    )
  if (phase === 'done')
    return (
      <>
        <svg className="cp-check" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 8.5l3.2 3L13 4.5" />
        </svg>
        {text}
      </>
    )
  if (phase === 'fail')
    return (
      <>
        <span className="cp-bad">
          <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
            <path d="M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z" />
          </svg>
        </span>
        {text}
      </>
    )
  return (
    <>
      <Icon name="check" />
      {text}
    </>
  )
}

// phase: 'rest' | 'pending' (first 400 ms: still reads Make sound) | 'working' | 'done' | 'fail'
export function MakeButton({ phase, text, onClick }) {
  const rowRef = useRef(null)
  const [width, setWidth] = useState(null)
  const [shown, setShown] = useState(true)
  const shownPhase = phase === 'pending' ? 'rest' : phase
  const label = shownPhase === 'rest' ? 'Make sound' : text
  useLayoutEffect(() => {
    if (rowRef.current) setWidth(Math.ceil(rowRef.current.offsetWidth))
    setShown(false)
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [shownPhase, label])
  const busy = phase !== 'rest'
  return (
    <button
      id="composite-bake"
      className={`cp-b cp-pri cp-push cp-morph ${shownPhase}`}
      type="button"
      title="Render the layers into one sound in your library"
      aria-busy={phase === 'pending' || phase === 'working'}
      aria-live="polite"
      disabled={busy}
      style={width ? { width } : undefined}
      onClick={onClick}
    >
      <span ref={rowRef} key={shownPhase + label} className={'cp-morph-row' + (shown ? '' : ' in')}>
        <Row phase={shownPhase} text={label} />
      </span>
    </button>
  )
}

// Runs one Make sound with the timing above. setPhase receives { phase, text }.
export function useMakePhase() {
  const [state, setState] = useState({ phase: 'rest', text: '' })
  const timers = useRef([])
  const clear = () => {
    for (const t of timers.current) clearTimeout(t)
    timers.current = []
  }
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms))
  useEffect(() => clear, [])
  return {
    ...state,
    start(text) {
      clear()
      setState({ phase: 'pending', text })
      later(() => setState({ phase: 'working', text }), MAKE_TIMING.workingDelay)
    },
    done(text) {
      clear()
      setState({ phase: 'done', text })
      later(() => setState({ phase: 'rest', text: '' }), MAKE_TIMING.doneHold)
    },
    fail(text) {
      clear()
      setState({ phase: 'fail', text })
      later(() => setState({ phase: 'rest', text: '' }), MAKE_TIMING.failHold)
    }
  }
}
