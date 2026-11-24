// Composite multi-sound "effect" groups (e.g. a door: knob turn + creak +
// bell). Design confirmed directly by the owner: pick existing sounds,
// arrange them on a small timeline (per-member trim + free drag positioning
// + per-member volume), and *bake* them into one new real audio file. The
// result is a completely normal library.js entry (created via the exact same
// library.addSound every plain import goes through) - it just carries a
// `compositeSource` field for the badge and so this tab can reopen it. Zero
// new playback code anywhere else in the app.
//
// No filter/EQ UI here, only trim/position/volume: "if you want to fiddle
// around with remixing the audio you should just go to the remix tab". Each
// member's own Remix filters/speed still bake in; only its Remix loop points
// are overridden by the timeline's own trim.
//
// Desktop 2.0: the tab is React and follows the approved v2 mock (see
// CompositeApp.jsx). This class is only the plugin shell: it registers the
// tab, mounts the React tree into the host's container and passes along the
// show/hide and library-changed events.

import { mountComposite } from './CompositeApp.jsx'

export default class CompositePlugin {
  constructor(app) {
    this.app = app
    this.api = app.noctivago
    this.view = null
    this.shown = false
  }

  async onload() {
    this.unregister = this.app.tabs.register({
      id: 'composite',
      title: 'Composite',
      mount: (container) => {
        this.view = mountComposite(container, { api: this.api })
      },
      onShow: () => {
        this.shown = true
        this.view?.setShown(true)
      },
      onHide: () => {
        this.shown = false
        this.view?.setShown(false)
      }
    })
    // Pick up sounds added elsewhere (the + menu, a watched folder) without
    // needing to leave and re-enter the tab. Only act while the tab is
    // actually visible - a refresh re-extracts every clip waveform via
    // ffmpeg, and this fires on any app-wide library mutation (e.g. every
    // debounced Mixer volume save). onShow catches up whatever was missed.
    this._unsubLibrary = this.api.library.onChanged(() => {
      if (this.shown) this.view?.refresh()
    })
  }

  async onunload() {
    this._unsubLibrary?.()
    this.view?.unmount()
    this.view = null
    this.unregister?.()
  }
}
