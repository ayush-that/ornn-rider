// Shared contract for all modules. Physics + rendering now live in Phaser
// (scene.ts); this file stays framework-agnostic so data.ts / terrain.ts /
// hud.ts keep compiling without importing Phaser or matter-js.

export interface SeriesPoint {
  t: number // unix ms
  v: number // index value, USD per GPU-hour
}

// Track length variant. 1w/1m = hourly history-simple, 3m = daily index-history,
// all = H100-only full public history.
export type GpuRange = '1w' | '1m' | '3m' | 'all'

export interface Track {
  id: string // e.g. 'h100'
  gpuName: string // API name, e.g. 'H100 SXM'
  tab: string // header tab label, e.g. 'H100'
  label: string // long display name, e.g. 'H100 SXM'
  hasAll: boolean // exposes the extra ALL range (full public history)
}

export interface TerrainPoint {
  x: number
  y: number // world coords, +y down
}

export interface DayMarker {
  x: number
  y: number
  t: number
  v: number
  changePct: number // vs previous point
  dayBoundary: boolean // first raw point of a calendar day — gets a bottom date label
}

export interface Terrain {
  points: TerrainPoint[] // smoothed, fine-grained, x ascending
  markers: DayMarker[] // one per raw data day
  startX: number
  endX: number
  minY: number
  maxY: number
  // for a given world x, ground y (linear interp over points)
  groundY(x: number): number
  // slope in radians at x
  slopeAt(x: number): number
}

export type GamePhase = 'menu' | 'loading' | 'playing' | 'crashed' | 'finished'

// Read-only view of the Phaser/Matter bike that hud.ts and the debug handle
// consume without depending on Phaser types. scene.ts keeps this in sync each
// frame from the live Matter bodies.
export interface BikeView {
  chassis: { position: { x: number; y: number }; angle: number }
  readonly speed: number // px/s along ground
  readonly rpm: number // 0..1 normalized for audio/fx
  grounded: boolean
  crashed: boolean // head touched ground
  ejected: boolean // ragdoll thrown from the bike
}

export interface GameState {
  phase: GamePhase
  range: GpuRange
  started: boolean // first throttle input received — the run has begun
  latestPrice: number // most-recent series value (header ticker)
  latestChangePct: number // day-over-day change of the latest value (header ticker)
  track: Track | null
  terrain: Terrain | null
  bike: BikeView | null
  camera: { x: number; y: number; zoom: number }
  distance: number // px progressed
  credits: number // collected day-marker coins
  airTimeMs: number
  flips: number
  bestDistance: Record<string, number> // per track id, localStorage-backed
  collected: Uint8Array | null // per-day-marker pickup state
  newBest: boolean // last run beat the stored best (set when the run ends)
  trend: number // -1..1 smoothed recent price direction, drives fx/wind
  timeMs: number
  nitro: number // 0..1 boost charge
  nitroActive: boolean // boost currently firing
}

// Palette — Ornn live-chart theme: pure black, white price line, chart-paper
// grid. Green/amber/red are reserved for the change chip and bull/bear effects.
export const C = {
  bg0: '#050505', // pure black page
  bg1: '#080808',
  panel: '#1c1c1c', // tooltip / results card
  grid: '#161616', // fine chart-paper grid lines
  gridBright: '#1e1e1e', // day-boundary verticals
  line: '#161616', // legacy alias (borders)
  chart: '#f5f5f5', // the price line the bike rides
  text: '#ffffff',
  dim: '#8a8a8a',
  axis: '#6a6a6a', // right-edge price labels
  chipBg: '#ffffff', // current-price chip
  chipText: '#050505',
  green: '#34d97b', // bull effects
  greenDim: '#1d7a4a',
  chgUpBg: '#12331f', // day-change chip (up)
  chgUpText: '#4bd483',
  chgDownBg: '#331512', // day-change chip (down)
  chgDownText: '#f0655a',
  red: '#f05e51', // bear effects
  amber: '#f5a524', // credit coins
  glow: 'rgba(52,217,123,0.35)',
} as const

// Numeric mirrors of the palette for Phaser (which takes 0xRRGGBB ints).
export const CN = {
  bg0: 0x050505,
  panel: 0x1c1c1c,
  grid: 0x161616,
  gridBright: 0x1e1e1e,
  chart: 0xf5f5f5,
  text: 0xffffff,
  dim: 0x8a8a8a,
  axis: 0x6a6a6a,
  chipBg: 0xffffff,
  depth: 0x0a0a0a, // faint terrain depth fill
  green: 0x34d97b,
  greenDim: 0x1d7a4a,
  greenBright: 0x7ff0ad,
  red: 0xf05e51,
  amber: 0xf5a524,
  amberBright: 0xff8a5c,
  dust: 0x8f9c8a,
} as const
