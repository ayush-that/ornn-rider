// Shared contract for all modules. Do not change signatures without updating BUILD_SPEC.md.
import type { Body, Engine } from 'matter-js'

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
  y: number // canvas/world coords, +y down
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

export interface Bike {
  chassis: Body
  wheelBack: Body
  wheelFront: Body
  riderHead: Body
  allBodies: Body[]
  throttle(dir: -1 | 0 | 1): void // 1 = forward, -1 = brake/reverse
  lean(dir: -1 | 0 | 1): void // in-air rotation
  readonly speed: number // m/s along ground, px/s fine
  readonly rpm: number // 0..1 normalized for audio/fx
  readonly grounded: boolean
  readonly crashed: boolean // head touched ground
  update(dtMs: number): void
  reset(x: number, y: number): void
}

export type GamePhase = 'menu' | 'loading' | 'playing' | 'crashed' | 'finished'

export interface Particle {
  x: number; y: number; vx: number; vy: number
  life: number; maxLife: number
  size: number; color: string
  glow?: boolean
}

export interface Effects {
  particles: Particle[]
  shake: { x: number; y: number }
  emitDust(x: number, y: number, intensity: number): void
  emitBoost(x: number, y: number): void // green bull-run trail
  emitEmbers(x: number, y: number): void // red drawdown embers
  emitCrash(x: number, y: number): void
  emitPickup(x: number, y: number): void
  addShake(mag: number): void
  update(dt: number): void
}

export interface GameState {
  phase: GamePhase
  range: GpuRange
  started: boolean // first throttle input received — the run has begun
  latestPrice: number // most-recent series value (header ticker)
  latestChangePct: number // day-over-day change of the latest value (header ticker)
  track: Track | null
  terrain: Terrain | null
  bike: Bike | null
  engine: Engine | null
  effects: Effects
  camera: { x: number; y: number; zoom: number }
  distance: number // px progressed
  credits: number // collected day-marker coins
  airTimeMs: number
  flips: number
  bestDistance: Record<string, number> // per track id, localStorage-backed
  collected: Uint8Array | null // per-day-marker pickup state, render reads it
  newBest: boolean // last run beat the stored best (set when the run ends)
  trend: number // -1..1 smoothed recent price direction, drives fx/wind
  timeMs: number
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
