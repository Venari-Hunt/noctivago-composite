// The inspector (right column): the Clip, Layer and Composite cards.
import { useState } from 'react'
import { Icon } from './icons.jsx'
import { VOLUME_MAX, fmtSec, parseNum, volumeFill } from '../domain/timeline.js'
import { memberIn, memberLen, memberOut } from '../domain/members.js'

// A typed field like "0.10 s". It commits when you leave it (or press Enter);
// anything without a number puts the old value back.
function NumField({ id, label, value, onCommit, title, wide }) {
  const [draft, setDraft] = useState(null)
  const commit = () => {
    if (draft == null) return
    const v = parseNum(draft)
    setDraft(null)
    if (v != null) onCommit(v)
  }
  return (
    <label className={`cp-field${wide ? ' wide' : ''}`} title={title}>
      {label}
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={draft ?? value}
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

function Slider({ id, label, valueId, volume, onChange }) {
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
        max={VOLUME_MAX}
        step="0.01"
        value={volume}
        style={{ '--p': volumeFill(volume) }}
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
  return (
    <div className="cp-card" id="composite-selected" key={m.uid}>
      <h2>
        <Icon name="music" />
        Clip<small>{entry ? entry.name : '(missing)'}</small>
      </h2>
      <div className="cp-grid2">
        <NumField key={`start-${m.uid}`} id="csel-start" label="Starts at" value={`${(m.delayMs / 1000).toFixed(2)} s`} onCommit={onStart} />
        <div className="cp-readout">
          Clip length<b>{fmtSec(memberLen(m, durations))}</b>
        </div>
        <NumField key={`in-${m.uid}`} id="csel-in" label="Trim start" value={`${memberIn(m).toFixed(2)} s`} onCommit={(v) => onIn(v, dur)} />
        <NumField key={`out-${m.uid}`} id="csel-out" label="Trim end" value={`${memberOut(m, durations).toFixed(2)} s`} onCommit={(v) => onOut(v, dur)} />
        <NumField key={`vol-${m.uid}`} id="csel-volume" label="Clip volume" wide value={`${Math.round(m.volume * 100)}%`} onCommit={onVolume} />
      </div>
      <button id="csel-remove" className="cp-b cp-fill cp-wide" type="button" title="Remove this clip" onClick={onRemove}>
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

export function LayerCard({ m, index, count, sounds, onSound, onVolume, onRemove }) {
  return (
    <div className="cp-card" id="composite-layer">
      <h2>
        <Icon name="stack" />
        Layer<small>{`${index + 1} of ${count}`}</small>
      </h2>
      <label className="cp-field">
        Sound
        <select id="layer-sound" value={m.soundId} onChange={(e) => onSound(e.target.value)}>
          <option value="">Pick a sound</option>
          {sounds.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <Slider id="layer-volume" valueId="layer-volume-val" label="Layer volume" volume={m.volume} onChange={onVolume} />
      <button id="layer-remove" className="cp-b cp-fill cp-wide" type="button" title="Remove this layer and its clip" onClick={onRemove}>
        <Icon name="trash-2" />
        Remove layer
      </button>
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
