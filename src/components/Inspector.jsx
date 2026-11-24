// The inspector (right column): the Clip, Layer and Composite cards.
import { useState } from 'react'
import { Icon } from './icons.jsx'
import { VOLUME_MAX, fmtSec, parseSeconds, volumeFill } from '../domain/timeline.js'
import { memberIn, memberLen, memberOut } from '../domain/members.js'

// A typed time like "0.10 s". It commits when you leave it (or press Enter).
// Text that is not a number stays in the field, marked invalid, with a message
// under the fields (onBad / onOk); Escape puts the old value back.
function NumField({ id, label, value, onCommit, onBad, onOk, bad, title }) {
  const [draft, setDraft] = useState(null)
  const commit = () => {
    if (draft == null) return
    const v = parseSeconds(draft)
    if (v == null) return onBad(label)
    setDraft(null)
    onOk(label)
    onCommit(v)
  }
  return (
    <label className="cp-field" title={title}>
      {label}
      <input
        id={id}
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={bad}
        aria-describedby={bad ? 'csel-msg' : undefined}
        value={draft ?? value}
        onChange={(e) => {
          setDraft(e.target.value)
          if (bad) onOk(label) // typing again clears the message until the next commit
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          else if (e.key === 'Escape') {
            setDraft(null)
            onOk(label)
          }
        }}
      />
    </label>
  )
}

function Slider({ id, label, valueId, volume, onChange }) {
  const max = Math.max(VOLUME_MAX, volume) // an older composite may sit above 150%
  return (
    <div className="cp-slider">
      <div className="cp-slider-t">
        <label htmlFor={id}>{label}</label>
        <b id={valueId}>{Math.round(volume * 100)}%</b>
      </div>
      <input
        id={id}
        className="cp-fader"
        type="range"
        min="0"
        max={max}
        step="0.01"
        value={volume}
        style={{ '--p': volumeFill(volume, max) }}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={(e) => {
          e.stopPropagation() // the app-wide double-click reset can't reach a React slider
          onChange(1)
        }}
      />
    </div>
  )
}

export function ClipCard({ m, entry, durations, onStart, onIn, onOut, onVolume, onRemove }) {
  const dur = durations[m.soundId] ?? Infinity
  const [bad, setBad] = useState(null) // the label of the field with unreadable text
  const fieldProps = (label) => ({
    label,
    bad: bad === label,
    onBad: setBad,
    onOk: (l) => setBad((b) => (b === l ? null : b))
  })
  return (
    <div className="cp-card" id="composite-selected" key={m.uid}>
      <h2>
        <Icon name="music" />
        Clip<small>{entry ? entry.name : '(missing)'}</small>
      </h2>
      <div className="cp-grid2">
        <NumField id="csel-start" {...fieldProps('Starts at')} title="Arrow keys nudge 10 ms, Shift+arrow 100 ms" value={`${(m.delayMs / 1000).toFixed(2)} s`} onCommit={onStart} />
        <div className="cp-readout">
          Clip length<b id="csel-length">{fmtSec(memberLen(m, durations))}</b>
        </div>
        <NumField
          id="csel-in"
          {...fieldProps('Trim start')}
          title="Cuts the start; the rest stays in place"
          value={`${memberIn(m).toFixed(2)} s`}
          onCommit={(v) => onIn(v, dur)}
        />
        <NumField id="csel-out" {...fieldProps('Trim end')} title="Cuts the end" value={`${memberOut(m, durations).toFixed(2)} s`} onCommit={(v) => onOut(v, dur)} />
        {bad && (
          <span id="csel-msg" className="cp-msg" role="alert">
            {bad}: use seconds, like 0.05
          </span>
        )}
      </div>
      <Slider id="csel-volume" valueId="csel-volume-val" label="Clip volume" volume={m.volume} onChange={onVolume} />
      <button id="csel-remove" className="cp-b cp-fill cp-wide" type="button" title="Remove this clip (Del)" onClick={onRemove}>
        <Icon name="trash-2" />
        Remove clip
      </button>
    </div>
  )
}

export function NoClipCard() {
  return (
    <div className="cp-card">
      <h2>
        <Icon name="music" />
        Clip
      </h2>
      <p className="cp-empty">No clip selected. Click a clip on the timeline to set its timing and volume.</p>
    </div>
  )
}

// The layer's name. Shows the sound's name until you give it one; commits when
// you leave the field (or press Enter), Escape puts the old name back, and
// emptying it goes back to the sound's name.
function LayerName({ title, custom, onCommit }) {
  const [draft, setDraft] = useState(null)
  const commit = () => {
    if (draft == null) return
    setDraft(null)
    onCommit(draft.trim() === title && !custom ? '' : draft.trim())
  }
  return (
    <label className="cp-field">
      Layer name
      <input
        id="layer-name"
        type="text"
        aria-label="Layer name"
        value={draft ?? title}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          else if (e.key === 'Escape') setDraft(null)
        }}
      />
    </label>
  )
}

export function LayerCard({ m, index, count, title, sounds, soundName, onName, onSound, onVolume, onDuplicate, onRemove }) {
  return (
    <div className="cp-card" id="composite-layer">
      <h2>
        <Icon name="stack" />
        Layer<small>{`${index + 1} of ${count}`}</small>
      </h2>
      <LayerName key={m.uid} title={title} custom={m.name.trim() !== ''} onCommit={onName} />
      {/* The mock shows the sound as a readout; the list sits invisibly over it,
          so a click still opens the choices. */}
      <div className="cp-info">
        Sound
        <span className="cp-sound" title="Click to change the sound">
          <Icon name="music" />
          <span className="cp-sound-name">{m.soundId ? soundName : 'Pick a sound'}</span>
          <Icon name="caret" size={12} />
          <select id="layer-sound" aria-label="Sound" value={m.soundId} onChange={(e) => onSound(e.target.value)}>
            <option value="">Pick a sound</option>
            {sounds.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </span>
      </div>
      <Slider id="layer-volume" valueId="layer-volume-val" label="Layer volume" volume={m.volume} onChange={onVolume} />
      <div className="cp-grid2">
        <button id="layer-duplicate" className="cp-b cp-fill" type="button" title="Duplicate this layer" onClick={onDuplicate}>
          <Icon name="copy" />
          Duplicate
        </button>
        <button id="layer-remove" className="cp-b cp-fill" type="button" title="Remove this layer and its clips" onClick={onRemove}>
          <Icon name="trash-2" />
          Remove
        </button>
      </div>
    </div>
  )
}

export function CompositeCard({ name, onName, total, layers, status }) {
  return (
    <div className="cp-card">
      <h2>
        <Icon name="sparkles" />
        Composite
      </h2>
      <label className="cp-field">
        Name
        <input id="composite-name" type="text" aria-label="Composite name" placeholder="Door effect" value={name} onChange={(e) => onName(e.target.value)} />
      </label>
      <div className="cp-grid2">
        <div className="cp-readout">
          Total length<b id="composite-total">{total}</b>
        </div>
        <div className="cp-readout">
          Layers<b>{layers}</b>
        </div>
      </div>
      <p id="composite-status" className="cp-status" aria-live="polite">
        {status}
      </p>
    </div>
  )
}
