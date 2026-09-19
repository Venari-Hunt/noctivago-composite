// The Noctívago plugin contract.
//
// This file is the reference for plugin authors: what a plugin folder must
// contain, what the app hands a plugin, and what a plugin hands back. The app
// itself is plain JavaScript; nothing here is compiled. Use it for editor
// autocomplete and type checking in your own plugin, either from TypeScript
// (`import type { PluginApp } from '.../types/plugin'`) or from plain JS via
// JSDoc (`/** @param {import('.../types/plugin').PluginApp} app */`).
//
// The manifest rules below are also enforced at runtime by
// src/shared/pluginManifest.js: a plugin whose manifest fails them is skipped
// with a logged reason instead of loaded. Keep the two in sync.
//
// See docs/plugins.md for the architecture and security model behind this.

// ---------------------------------------------------------------------------
// manifest.json
// ---------------------------------------------------------------------------

/** A path relative to the plugin's own folder. No `..`, no absolute paths. */
export type PluginRelativePath = string

/** `MAJOR.MINOR.PATCH`, optionally with a `-prerelease` suffix. */
export type VersionString = string

export interface PluginManifest {
  /**
   * Unique id. Lowercase letters, digits and dashes (`my-plugin`). It becomes
   * the `plugin://<id>/` hostname. It doesn't have to match the folder name.
   * If a user-installed plugin reuses a bundled plugin's id, the bundled one
   * wins and the user one is ignored.
   */
  id: string
  /** Display name. */
  name: string
  version: VersionString
  /** Renderer entry module (ES module), e.g. `"index.js"`. Its default export is a {@link PluginClass}. */
  main: PluginRelativePath
  /**
   * Optional Node module run in Electron's main process, for real power
   * (disk, ffmpeg, network without CORS). Its exported functions are callable
   * from the renderer through `app.noctivago.plugins.invoke(id, fnName, ...args)`.
   * This is fully trusted code; see docs/plugins.md.
   */
  mainProcess?: PluginRelativePath
  /** Optional stylesheet, loaded into the page before `main` is imported. */
  styles?: PluginRelativePath
  description?: string
  author?: string
  /** Informational for now; not yet enforced against the running app version. */
  minAppVersion?: VersionString
}

// ---------------------------------------------------------------------------
// The plugin class (default export of `main`)
// ---------------------------------------------------------------------------

/**
 * The shape of a plugin's default export:
 *
 * ```js
 * export default class MyPlugin {
 *   constructor(app, manifest) { this.app = app }
 *   async onload() { this.unregister = this.app.tabs.register({ id: 'my-tab', title: 'Mine', mount: (el) => {} }) }
 *   async onunload() { this.unregister?.() }
 * }
 * ```
 *
 * The app constructs it once at startup, then awaits `onload()`. A plugin
 * that throws (in its constructor or `onload`) is logged and skipped; it
 * can't break the app or other plugins.
 */
export interface PluginClass {
  new (app: PluginApp, manifest: PluginManifest): PluginInstance
}

export interface PluginInstance {
  onload?(): void | Promise<void>
  /** Reserved for enable/disable and hot reload; not called by the app yet. */
  onunload?(): void | Promise<void>
}

// ---------------------------------------------------------------------------
// What the app hands a plugin
// ---------------------------------------------------------------------------

export interface PluginApp {
  tabs: {
    /** Adds a tab. Returns a function that removes it again. */
    register(tab: TabDefinition): () => void
  }
  settings: {
    /**
     * Adds this plugin's page to the Settings window sidebar, listed under
     * Core or Community plugins. One page per plugin; adding again replaces
     * it. Returns a function that removes it.
     */
    addPage(page: SettingsPageDefinition): () => void
  }
  /** The same API core uses (`window.noctivago`). */
  noctivago: NoctivagoApi
  plugin: {
    id: string
    manifest: PluginManifest
  }
}

/**
 * A tab. The contract is framework-free: the app gives you an empty DOM
 * element and you render into it with whatever you like (plain DOM, React,
 * anything you bundle yourself).
 */
export interface TabDefinition {
  /** Unique across all tabs. Registering a taken id throws. */
  id: string
  /** Tab button label. */
  title: string
  /** Called once, the first time the tab is shown. Render into `container`. */
  mount(container: HTMLElement): void
  /**
   * Optional. Called once alongside `mount`, with a section of the sticky bar
   * under the tab bar that stays visible while the tab scrolls. Only the
   * active tab's section is shown.
   */
  mountSticky?(container: HTMLElement): void
  /** Called every time the tab becomes active. */
  onShow?(): void
  /** Called every time the tab stops being active. */
  onHide?(): void
  /**
   * Called before switching away. Resolve `false` to cancel the switch (e.g.
   * an unsaved-changes prompt); any other value allows it.
   */
  onBeforeHide?(): boolean | void | Promise<boolean | void>
  /** Called when the tab is removed via the function `register` returned. */
  onDestroy?(): void
}

/** A plugin's Settings page. Framework-free, like a tab. */
export interface SettingsPageDefinition {
  /** Sidebar label. Defaults to the plugin id. */
  title: string
  /** Called each time the page is opened. Render into `container`. */
  mount(container: HTMLElement): void
  /** Called when the page is left or Settings closes. The container is emptied afterwards. */
  unmount?(container: HTMLElement): void
}

// ---------------------------------------------------------------------------
// window.noctivago (src/preload/index.js)
// ---------------------------------------------------------------------------
//
// Method names and arguments are the stable part. Payload and result objects
// are loosely typed here on purpose: they mirror internal records (sounds,
// presets, filters) that still change between releases. Read the handler in
// src/main/ipc.js for a method's exact shape.

/** Removes a listener registered with one of the `on*` methods. */
export type Unsubscribe = () => void
type Payload = Record<string, any>

/** One community-plugins.json entry, plus what's installed locally under that id. */
export interface StoreListing {
  id: string
  name: string
  author: string
  description: string
  /** GitHub "owner/repo"; files come from its latest release. */
  repo: string
  /** Published from the Venari-Hunt account; installs even in Restricted mode. */
  official: boolean
  /** From community-plugin-stats.json; 0 and null when it has no entry yet. */
  downloads: number
  /** When the latest release was published, in ms. */
  updated: number | null
  installed: { version: string; source: 'user' | 'bundled' } | null
}

/** A sound in the library. Only the fields most plugins need are listed. */
export interface LibrarySound {
  id: string
  name: string
  /** Where the file was imported from. Play it via `sound://<id>`, not this path. */
  originalPath: string
  durationSeconds: number | null
  tags?: string[]
  [key: string]: any
}

/** A saved mix. */
export interface Preset {
  id: string
  name: string
  [key: string]: any
}

export interface NoctivagoApi {
  isPackaged(): Promise<boolean>
  settings: {
    get(): Promise<Payload>
    [setter: `set${string}`]: (value: any) => Promise<any>
  }
  autoUpdate: {
    checkNow(): Promise<any>
    getState(): Promise<Payload>
    getWhatsNew(): Promise<any>
    getWhatsNewCurrent(): Promise<any>
    download(): Promise<any>
    dismiss(version: string): Promise<any>
    onEvent(callback: (channel: string, payload: any) => void): Unsubscribe
  }
  playback: {
    reportState(playing: boolean): void
  }
  sleepTimer: {
    get(): Promise<Payload | null>
    start(payload: Payload): Promise<any>
    cancel(): Promise<any>
    runEndAction(action: string): Promise<any>
    onElapsed(callback: (payload: any) => void): Unsubscribe
  }
  tray: {
    onTogglePlayPause(callback: () => void): Unsubscribe
  }
  library: {
    list(): Promise<LibrarySound[]>
    resolveCredits(ids: string[]): Promise<Array<{ id: string; name: string; source: any }>>
    pickFile(): Promise<any>
    pickFolder(): Promise<any>
    addSound(payload: Payload): Promise<any>
    addRecordedSound(payload: Payload): Promise<any>
    addSoundFromUrl(payload: Payload): Promise<any>
    onAddSoundFromUrlProgress(callback: (payload: any) => void): Unsubscribe
    addFolderSounds(folderPath: string, options?: Payload): Promise<any>
    addSoundFromFreesound(payload: Payload): Promise<any>
    onAddSoundFromFreesoundProgress(callback: (payload: any) => void): Unsubscribe
    updateMeta(id: string, meta: Payload): Promise<any>
    updateLoopPoints(id: string, points: Payload): Promise<any>
    updateFilters(id: string, filters: Payload): Promise<any>
    updateVolume(id: string, volume: number): Promise<any>
    updateIncluded(id: string, included: boolean): Promise<any>
    updateCrossfade(id: string, crossfadeSeconds: number): Promise<any>
    updateFluctuation(id: string, fluctuation: Payload): Promise<any>
    updateTags(id: string, tags: string[]): Promise<any>
    updateSpeedPitch(id: string, speedPitch: Payload | null): Promise<any>
    updatePlayMode(id: string, playMode: string): Promise<any>
    updateScatterConfig(id: string, scatter: Payload | null): Promise<any>
    updateSchedule(id: string, schedule: Payload | null): Promise<any>
    reorderSounds(orderedIds: string[]): Promise<any>
    rename(id: string, name: string): Promise<any>
    duplicateSound(id: string, options?: Payload): Promise<any>
    relink(id: string): Promise<any>
    remove(id: string): Promise<any>
    listWatchedFolders(): Promise<any[]>
    pickWatchFolder(): Promise<any>
    addWatchedFolder(folderPath: string, options?: Payload): Promise<any>
    removeWatchedFolder(id: string): Promise<any>
    /** Fires when a watched folder auto-imports a sound. */
    onChanged(callback: () => void): Unsubscribe
  }
  presets: {
    list(): Promise<Preset[]>
    save(payload: Payload): Promise<any>
    delete(id: string): Promise<any>
    updateWholeMix(id: string, wholeMix: Payload): Promise<any>
    updateSounds(id: string, sounds: any[]): Promise<any>
    updateGroups(id: string, groups: any[]): Promise<any>
    updateSoundOverride(presetId: string, soundId: string, overridePatch: Payload): Promise<any>
    export(presetId: string): Promise<any>
    pickImport(): Promise<any>
    resolveImportedSound(portableSound: Payload): Promise<any>
    finalizeImport(payload: Payload): Promise<any>
    cancelImport(importSessionId: string): Promise<any>
  }
  audio: {
    renderLoopClip(id: string, points: Payload): Promise<any>
    getWaveformPeaks(id: string, targetWidth: number, windowStart?: number, windowEnd?: number): Promise<any>
    getBandEnergy(id: string, options?: Payload): Promise<any>
    suggestLoopPoints(id: string, options?: Payload): Promise<any>
  }
  plugins: {
    /** The plugins loaded this session (enabled, and not blocked by Restricted mode). */
    list(): Promise<Array<{ id: string; manifest: PluginManifest }>>
    /** Every installed plugin, for Settings > Core/Community plugins. */
    describe(): Promise<
      Array<{
        id: string
        manifest: PluginManifest
        kind: 'core' | 'community'
        repo: string | null
        official: boolean
        /** What the saved settings say; applies on restart. */
        state: 'enabled' | 'disabled' | 'restricted'
        /** Whether it's running this session. */
        loaded: boolean
      }>
    >
    setEnabled(id: string, enabled: boolean): Promise<any>
    setRestrictedMode(on: boolean): Promise<any>
    /** Hides the Mixer's one-time Recommended plugins card for good. */
    dismissRecommended(): Promise<any>
    /** Calls an exported function of a plugin's `mainProcess` module. */
    invoke(pluginId: string, method: string, ...args: any[]): Promise<any>
  }
  /** The community plugin list, and installs into <userData>/plugins (used by Settings > Community plugins). */
  pluginStore: {
    list(): Promise<{ plugins: StoreListing[] }>
    /** The latest release's version, and whether it has a mainProcess module. */
    checkLatest(id: string): Promise<{ version: string; mainProcess: boolean; minAppVersion: string | null; updateAvailable: boolean }>
    /** README.md from the plugin's repo, as text ('' when it has none). */
    readme(id: string): Promise<{ text: string; truncated: boolean }>
    install(id: string): Promise<{ version: string }>
    uninstall(id: string): Promise<{ ok: true }>
    /** Relaunches the app; installs and removals take effect on restart. */
    restartApp(): Promise<void>
  }
  export: {
    pickDestination(options?: Payload): Promise<any>
    pickVideoFile(): Promise<any>
    pickImageFile(): Promise<any>
    run(payload: Payload): Promise<any>
    writeInfoFile(payload: Payload): Promise<any>
    writeLogFile(payload: Payload): Promise<any>
    onProgress(callback: (payload: any) => void): Unsubscribe
  }
  composite: {
    create(payload: Payload): Promise<any>
    rebake(payload: Payload): Promise<any>
  }
  community: {
    getProfile(): Promise<any>
    list(params?: Payload): Promise<any>
    listMine(): Promise<any>
    download(id: string): Promise<any>
    publish(payload: Payload): Promise<any>
    delete(id: string): Promise<any>
    report(id: string, reason: string): Promise<any>
    onPublishProgress(callback: (update: any) => void): Unsubscribe
  }
  freesound: {
    isAvailable(): Promise<boolean>
    search(params: Payload): Promise<any>
  }
  ytdlp: {
    isSearchAvailable(): Promise<boolean>
    searchYouTube(params: Payload): Promise<any>
  }
}

declare global {
  interface Window {
    noctivago: NoctivagoApi
  }
}
