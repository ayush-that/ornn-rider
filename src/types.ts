// Shared contract for all modules. Do not change signatures without updating BUILD_SPEC.md.
import type { Body, Engine } from 'matter-js'

export interface SeriesPoint {
  t: number // unix ms
  v: number // index value, USD per GPU-hour
}

export interface Track {
  id: string // e.g. 'h100'
  gpuName: string // API name, e.g. 'H100 SXM'
  label: string // display, e.g. 'H100 SXM — The Marathon'
  endpoint: string // full URL, public, no auth
  blurb: string
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
  changePct: number // vs previous day
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
  trend: number // -1..1 smoothed recent price direction, drives fx/wind
  timeMs: number
}

// Palette — Ornn dark market theme. Use these everywhere.
export const C = {
  bg0: '#070907',
  bg1: '#0c0f0c',
  panel: '#121512',
  line: '#1e241e',
  text: '#e6ece6',
  dim: '#7a857a',
  green: '#34d97b', // bull / accent
  greenDim: '#1d7a4a',
  red: '#f05e51', // bear
  amber: '#f5a524', // Ornn forge accent
  glow: 'rgba(52,217,123,0.35)',
} as const
