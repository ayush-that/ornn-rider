// game.ts — owns the Phaser.Game lifecycle, the DOM hud, WebAudio, window input
// listeners, data loading and localStorage persistence. All physics + rendering
// live in OrnnScene (scene.ts). Phaser must never be imported server-side; the
// route dynamically imports this module inside a useEffect (see index.tsx).
import * as Phaser from 'phaser'
import type { GameState, Track, GpuRange, RunResult } from './types'
import { DPR } from './types'
import { TRACKS, CATEGORIES, fetchSeries, normalizeRange } from './data'
import { buildTerrain } from './terrain'
import { createHud } from './hud'
import { createAudio } from './audio'
import { OrnnScene, type GameCtx } from './scene'

const BEST_KEY = 'ornn-rider-best:v1'
const LAST_KEY = 'ornn-rider:last:v1'

// Read a versioned key, migrating any value left under the old unversioned key.
function readVersioned(key: string, oldKey: string): string | null {
  const raw = localStorage.getItem(key)
  if (raw !== null) return raw
  const old = localStorage.getItem(oldKey)
  if (old !== null) {
    localStorage.setItem(key, old)
    localStorage.removeItem(oldKey)
  }
  return old
}

function loadBest(): Record<string, number> {
  try {
    const raw = readVersioned(BEST_KEY, 'ornn-rider-best')
    if (raw) return JSON.parse(raw) as Record<string, number>
  } catch {
    /* ignore corrupt storage */
  }
  return {}
}

function loadLast(): { track: Track; range: GpuRange } {
  let trackId = 'h100'
  // Deep link wins: /?track=<id> (e.g. ?track=mem-ddr5, ?track=tok-anthropic)
  // lands straight on that track; localStorage is the fallback.
  try {
    const urlTrack = new URLSearchParams(location.search).get('track')
    if (urlTrack && TRACKS.some(t => t.id === urlTrack)) {
      const track = TRACKS.find(t => t.id === urlTrack)!
      return { track, range: normalizeRange(track, 'all') }
    }
  } catch {
    /* ignore */
  }
  try {
    const raw = readVersioned(LAST_KEY, 'ornn-rider:last')
    if (raw) {
      const p = JSON.parse(raw) as { trackId?: string }
      if (p.trackId && TRACKS.some(t => t.id === p.trackId)) trackId = p.trackId
    }
  } catch {
    /* ignore */
  }
  const track = TRACKS.find(t => t.id === trackId) ?? TRACKS[0]
  return { track, range: normalizeRange(track, 'all') }
}

function saveLast(trackId: string, range: GpuRange): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ trackId, range }))
  } catch {
    /* ignore */
  }
  // Keep the URL shareable: whatever you're riding is the link.
  try {
    const url = new URL(location.href)
    url.searchParams.set('track', trackId)
    history.replaceState(null, '', url)
  } catch {
    /* ignore */
  }
}

let activeStop: (() => void) | null = null

export function stopGame(): void {
  if (activeStop) {
    activeStop()
    activeStop = null
  }
}

export function startGame(
  canvas: HTMLCanvasElement,
  root: HTMLElement,
  opts?: { onRunEnd?: (run: RunResult) => void },
): void {
  if (activeStop) stopGame()
  const ac = new AbortController()
  const listen: AddEventListenerOptions = { signal: ac.signal }

  // --- input state (shared with the scene) ---
  const keys = new Set<string>()
  const touch = { throttle: false, brake: false, nitro: false, leanFwd: false }
  let muted = false
  const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'])

  const hud = createHud(
    root,
    CATEGORIES,
    (t: Track, r: GpuRange) => void loadTrack(t, r),
    (active: boolean) => { touch.nitro = active },
  )
  const audio = createAudio()

  const state: GameState = {
    phase: 'menu',
    range: '3m',
    started: false,
    latestPrice: 0,
    latestChangePct: 0,
    livePrice: 0,
    liveTimeMs: 0,
    track: null,
    terrain: null,
    bike: null,
    camera: { x: 0, y: 0, zoom: 1 },
    distance: 0,
    points: 0,
    airTimeMs: 0,
    flips: 0,
    bestDistance: loadBest(),
    collected: null,
    newBest: false,
    trend: 0,
    timeMs: 0,
    nitro: 0,
    nitroActive: false,
  }

  // Debug handle for play-test tooling; exact shape is part of the contract.
  ;(window as unknown as Record<string, unknown>).__ornn = {
    get phase() { return state.phase },
    get distance() { return state.distance },
    get points() { return state.points },
    get flips() { return state.flips },
    get trend() { return state.trend },
    get nitro() { return state.nitro },
    get bike() { return state.bike },
  }

  const SCORE_PREFIX = { compute: 'gpu', memory: 'mem', tokens: 'tok' } as const

  function saveBest(): void {
    const t = state.track
    if (!t) return
    const prev = state.bestDistance[t.id] ?? 0
    state.newBest = state.distance > prev && state.distance > 0
    if (state.distance > prev) {
      state.bestDistance[t.id] = state.distance
      try {
        localStorage.setItem(BEST_KEY, JSON.stringify(state.bestDistance))
      } catch {
        /* ignore */
      }
    }
    // saveBest fires exactly once per run (crash or finish) — the leaderboard hook.
    opts?.onRunEnd?.({
      trackId: `${SCORE_PREFIX[t.category]}:${t.apiId}`,
      category: t.category,
      range: state.range,
      distance: Math.round(state.distance / 10),
      coins: state.points,
      flips: state.flips,
      timeMs: Math.round(state.timeMs),
      finished: state.phase === 'finished',
    })
  }

  const ctx: GameCtx = {
    state,
    hud,
    audio,
    keys,
    touch,
    isMuted: () => muted,
    saveBest,
    onReady: () => {
      const lastPlayed = loadLast()
      void loadTrack(lastPlayed.track, lastPlayed.range)
    },
  }

  const scene = new OrnnScene(ctx)

  const applyCanvasSize = (): void => {
    canvas.style.width = '100%'
    canvas.style.height = '100%'
  }

  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    canvas,
    backgroundColor: '#171a20',
    // Physical-resolution canvas (CSS stretches it back down): without this the
    // backing store is CSS-sized and the browser upscales the frame — soft
    // everywhere, obvious at speed. Scale.NONE + our own resize keeps control.
    scale: {
      mode: Phaser.Scale.NONE,
      width: Math.round(window.innerWidth * DPR),
      height: Math.round(window.innerHeight * DPR),
    },
    fps: { target: 60, min: 30 },
    // We drive Matter with a fixed-step accumulator inside the scene, so disable
    // its auto-update. Gravity y:1.1 with the default scale 0.001 matches the
    // original matter-js tuning exactly.
    physics: {
      default: 'matter',
      matter: { gravity: { x: 0, y: 1.1 }, autoUpdate: false },
    },
    // Our own window listeners handle keys (so synthetic events work) and the
    // canvas handles touch halves — disable Phaser's keyboard capture.
    input: { keyboard: false, mouse: true, touch: true },
    audio: { noAudio: true }, // WebAudio synth lives in audio.ts
    render: { pixelArt: true, powerPreference: 'high-performance' },
    scene,
  })
  applyCanvasSize()

  let loadSeq = 0
  async function loadTrack(track: Track, range: GpuRange): Promise<void> {
    const seq = ++loadSeq
    range = normalizeRange(track, range)
    state.phase = 'loading'
    state.range = range
    hud.hideResults()
    hud.setActive(track, range)
    hud.setLoading('loading ' + track.label + ' ' + range.toUpperCase() + ' …')
    try {
      const series = await fetchSeries(track, range)
      if (seq !== loadSeq) return
      const terrain = buildTerrain(series)
      state.track = track
      state.range = range
      state.terrain = terrain
      state.latestPrice = series[series.length - 1]!.v
      hud.setHeader(state.latestPrice)
      hud.setActive(track, range)
      hud.setLoading(null)
      saveLast(track.id, range)
      scene.buildWorld(terrain) // sets phase = 'playing', resets the run
    } catch {
      if (seq !== loadSeq) return
      hud.setLoading('failed to load ' + track.label + ' — press R to retry')
    }
  }

  // --- keyboard (window; synthetic events work) ---
  window.addEventListener('keydown', (e) => {
    keys.add(e.code)
    if (!e.repeat) {
      if (e.code === 'KeyR') {
        if (state.terrain && (state.phase === 'playing' || state.phase === 'crashed' || state.phase === 'finished')) {
          scene.restartRun()
        } else if (state.phase === 'loading' && state.track) {
          void loadTrack(state.track, state.range)
        }
      } else if (e.code === 'KeyM') {
        muted = !muted
        audio.setMusic(!muted)
      }
    }
    if (PREVENT.has(e.code)) e.preventDefault()
  }, listen)
  window.addEventListener('keyup', (e) => keys.delete(e.code), listen)
  window.addEventListener('resize', () => {
    game.scale.resize(Math.round(window.innerWidth * DPR), Math.round(window.innerHeight * DPR))
    applyCanvasSize()
  }, listen)
  // Background music starts on the first gesture (AudioContext unlock) and
  // follows the mute toggle from then on.
  const startMusic = (): void => {
    if (!muted) audio.setMusic(true)
  }
  window.addEventListener('keydown', startMusic, { once: true, signal: ac.signal })
  window.addEventListener('pointerdown', startMusic, { once: true, signal: ac.signal })
  const clearInput = (): void => { keys.clear(); activePointers.clear(); touch.throttle = false; touch.brake = false; touch.nitro = false; touch.leanFwd = false }
  window.addEventListener('blur', clearInput, listen)

  // --- touch halves on the canvas (left = brake, right = throttle) ---
  // Touch zones (multi-touch: each pointer is tracked so gas + a trick can be
  // held together): right half = gas · top-left quadrant = wheelie (like A) ·
  // bottom-left quadrant = nose dive (like D).
  const activePointers = new Map<number, 'gas' | 'back' | 'fwd'>()
  const applyPointers = (): void => {
    let gas = false, back = false, fwd = false
    for (const zone of activePointers.values()) {
      if (zone === 'gas') gas = true
      else if (zone === 'back') back = true
      else fwd = true
    }
    touch.throttle = gas
    touch.brake = back
    touch.leanFwd = fwd
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (state.phase !== 'playing') return
    const zone = e.clientX >= window.innerWidth / 2
      ? 'gas'
      : e.clientY < window.innerHeight / 2 ? 'back' : 'fwd'
    activePointers.set(e.pointerId, zone)
    applyPointers()
  }, listen)
  const releasePointer = (e: PointerEvent): void => {
    activePointers.delete(e.pointerId)
    applyPointers()
  }
  canvas.addEventListener('pointerup', releasePointer, listen)
  canvas.addEventListener('pointercancel', releasePointer, listen)
  canvas.addEventListener('pointerleave', releasePointer, listen)

  activeStop = () => {
    ac.abort()
    audio.setMusic(false)
    game.destroy(false, false) // keep the React-owned canvas element
    root.replaceChildren()
    document.getElementById('ornn-hud-style')?.remove()
    delete (window as unknown as Record<string, unknown>).__ornn
  }
}
