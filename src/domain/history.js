// Undo and redo for the Composite tab: a stack of snapshots. A snapshot is
// whatever the tab needs to go back (the members and the selected layer); the
// members are never edited in place, so keeping the old array is enough.
// No DOM and no React, so it is tested with plain node --test.

export const HISTORY_LIMIT = 100
// Pushes with the same key inside this window (measured from the latest push)
// are one step: holding an arrow key, or dragging a fader, is one undo.
export const MERGE_MS = 700

export function createHistory({ limit = HISTORY_LIMIT, mergeMs = MERGE_MS, now = () => Date.now() } = {}) {
  let past = []
  let future = []
  let lastKey = null
  let lastAt = 0
  return {
    // Remember `snap`, the state from before a change. A change always empties redo.
    push(snap, key = null) {
      const t = now()
      if (key && key === lastKey && t - lastAt <= mergeMs && past.length) {
        lastAt = t
        return
      }
      past.push(snap)
      if (past.length > limit) past.shift()
      future = []
      lastKey = key
      lastAt = t
    },
    // Step back: `current` goes to redo, the older snapshot comes back (or null).
    undo(current) {
      if (!past.length) return null
      future.push(current)
      lastKey = null
      return past.pop()
    },
    redo(current) {
      if (!future.length) return null
      past.push(current)
      lastKey = null
      return future.pop()
    },
    clear() {
      past = []
      future = []
      lastKey = null
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0
  }
}
