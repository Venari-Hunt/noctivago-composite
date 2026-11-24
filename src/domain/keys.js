// The Composite tab's keys, as rules only (no DOM). Returns an action or null.
//
// The app owns Space (Mixer play), Ctrl+F/S/M/,/1-9, F11 and "?" (see the app's
// core/shortcuts.js). Composite only takes keys the app leaves free on this tab:
// the app's own Undo/Redo/Delete match only on the Mixer tab, and Space is taken
// here because Preview is the play button of this tab. "?" stays the app's Help,
// so the keys button shows the list instead.
//
// ctx.typing: focus is in a field (the keys belong to the field);
// ctx.onControl: focus is on a button or link (Space presses it);
// ctx.modalOpen: a dialog or menu is open; ctx.hasClip: a clip is selected.
export const KEY_LIST = [
  { keys: ['Space'], what: 'Preview or stop' },
  { keys: ['Ctrl', 'Z'], what: 'Undo' },
  { keys: ['Ctrl', 'Y'], what: 'Redo (or Ctrl+Shift+Z)' },
  { keys: ['←', '→'], what: 'Nudge the clip 10 ms' },
  { keys: ['Shift', '←', '→'], what: 'Nudge the clip 100 ms' },
  { keys: ['Del'], what: 'Remove the selected clip' },
  { keys: ['Esc'], what: 'Deselect' },
  { keys: ['S'], what: 'Snap on or off' },
  { keys: ['Alt', 'drag'], what: 'Skip snap for one drag' },
  { keys: ['F'], what: 'Fit the whole composite' }
]

export function shortcutAction(event, ctx) {
  if (event.altKey) return null
  const ctrl = event.ctrlKey || event.metaKey
  const key = event.key
  if (ctx.typing || ctx.modalOpen) return null
  if (ctrl) {
    const k = key.toLowerCase()
    if (k === 'z') return { id: event.shiftKey ? 'redo' : 'undo' }
    if (k === 'y' && !event.shiftKey) return { id: 'redo' }
    return null
  }
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    return ctx.hasClip ? { id: 'nudge', dir: key === 'ArrowLeft' ? -1 : 1, big: event.shiftKey } : null
  }
  if (event.shiftKey) return null
  if (key === 'Delete') return ctx.hasClip ? { id: 'delete' } : null
  if (key === 'Escape') return { id: 'deselect' }
  if (key === ' ') return ctx.onControl ? null : { id: 'preview' }
  if (key === 's' || key === 'S') return { id: 'snap' }
  if (key === 'f' || key === 'F') return { id: 'fit' }
  return null
}
