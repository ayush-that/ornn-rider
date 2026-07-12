// Terrain generation: real price series -> rideable 2D hills.
import type { SeriesPoint, Terrain, TerrainPoint, DayMarker } from './types'

const SUBDIV = 10 // sub-points per day segment
const MAX_SLOPE_RAD = (38 * Math.PI) / 180
const LEAD_IN = 900 // flat run-up before data
const LEAD_OUT = 600 // flat run-out after data
const BASE_Y = 900 // world y of norm=0 (lowest price), +y down
const AMP_MIN = 220
const AMP_MAX = 780
const NOISE_AMP = 6
const NOISE_STEP = 4 // noise control point every N sub-points

// Deterministic integer hash -> [0,1)
function hash01(n: number): number {
  let h = n | 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 13), 0x45d9f3b)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

// Catmull-Rom interpolation (uniform, tension 0.5) for y at parameter t in [0,1]
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return (
    0.5 *
    (2 * p1 +
      (p2 - p0) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (3 * p1 - 3 * p2 + p3 - p0) * t3)
  )
}

export function buildTerrain(series: SeriesPoint[]): Terrain {
  const n = series.length
  if (n < 2) throw new Error('buildTerrain: need at least 2 series points')

  const dx = n <= 120 ? 260 : 130
  const maxDy = Math.tan(MAX_SLOPE_RAD) * dx // max rise/fall per day segment

  // Normalize values to [0,1]; flat series -> constant 0.5, never NaN.
  let vMin = Infinity
  let vMax = -Infinity
  for (let i = 0; i < n; i++) {
    const v = series[i].v
    if (v < vMin) vMin = v
    if (v > vMax) vMax = v
  }
  const range = vMax - vMin
  const norm = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    norm[i] = range > 1e-9 ? (series[i].v - vMin) / range : 0.5
  }

  // Amplitude vs volatility: scale so the steepest day just hits the slope
  // cap; volatile series flatten, calm series get taller hills. Clamped.
  let maxStep = 0
  for (let i = 1; i < n; i++) {
    const s = Math.abs(norm[i] - norm[i - 1])
    if (s > maxStep) maxStep = s
  }
  const amplitude = maxStep > 1e-6 ? clamp(maxDy / maxStep, AMP_MIN, AMP_MAX) : AMP_MIN

  // Raw day heights (price up = uphill = smaller y), then a forward slope
  // clamp pass so no single day exceeds ~38 deg even after amplitude clamp.
  const dayY = new Float64Array(n)
  dayY[0] = BASE_Y - norm[0] * amplitude
  for (let i = 1; i < n; i++) {
    const target = BASE_Y - norm[i] * amplitude
    dayY[i] = clamp(target, dayY[i - 1] - maxDy, dayY[i - 1] + maxDy)
  }

  const dataStartX = LEAD_IN
  const dayX = (i: number): number => dataStartX + i * dx

  const points: TerrainPoint[] = []

  // Lead-in: flat pad at first day's height, from x=0 to dataStartX.
  const y0 = dayY[0]
  for (let x = 0; x < LEAD_IN; x += 100) points.push({ x, y: y0 })

  // Smoothed data: Catmull-Rom per day segment, SUBDIV sub-points each,
  // plus gentle deterministic value-noise so flats aren't dead straight.
  // Noise: control points every NOISE_STEP sub-points, cosine-interpolated
  // (bounded +-NOISE_AMP, low slope so the 38 deg budget survives).
  const noiseAt = (subIdx: number): number => {
    const c = subIdx / NOISE_STEP
    const c0 = Math.floor(c)
    const f = c - c0
    const day0 = Math.min(n - 1, ((c0 * NOISE_STEP) / SUBDIV) | 0)
    const day1 = Math.min(n - 1, (((c0 + 1) * NOISE_STEP) / SUBDIV) | 0)
    const h0 = hash01(c0 + Math.round(series[day0].v * 10000)) - 0.5
    const h1 = hash01(c0 + 1 + Math.round(series[day1].v * 10000)) - 0.5
    const u = (1 - Math.cos(f * Math.PI)) * 0.5 // cosine ease
    return (h0 + (h1 - h0) * u) * 2 * NOISE_AMP
  }

  let subIdx = 0
  for (let i = 0; i < n - 1; i++) {
    const p0 = i > 0 ? dayY[i - 1] : dayY[0]
    const p1 = dayY[i]
    const p2 = dayY[i + 1]
    const p3 = i < n - 2 ? dayY[i + 2] : dayY[n - 1]
    const x1 = dayX(i)
    for (let s = 0; s < SUBDIV; s++) {
      const t = s / SUBDIV
      points.push({ x: x1 + t * dx, y: catmullRom(p0, p1, p2, p3, t) + noiseAt(subIdx) })
      subIdx++
    }
  }
  const lastX = dayX(n - 1)
  points.push({ x: lastX, y: dayY[n - 1] })

  // Final rideability pass: Catmull-Rom can overshoot the per-day clamp on
  // zigzag data, and noise adds a little slope. Forward-clamp every sub-step
  // so no segment ever exceeds the cap (also kills any residual spikes).
  const tanMax = Math.tan(MAX_SLOPE_RAD)
  for (let i = 1; i < points.length; i++) {
    const stepDy = tanMax * (points[i].x - points[i - 1].x)
    points[i].y = clamp(points[i].y, points[i - 1].y - stepDy, points[i - 1].y + stepDy)
  }
  const lastY = points[points.length - 1].y

  // Lead-out: flat pad, finish at endX.
  const endX = lastX + LEAD_OUT
  points.push({ x: lastX + 150, y: lastY })
  points.push({ x: lastX + 300, y: lastY })
  points.push({ x: lastX + 450, y: lastY })
  points.push({ x: endX, y: lastY })

  // Bounds
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < points.length; i++) {
    const y = points[i].y
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  // Binary search for segment index (points[i].x <= x < points[i+1].x).
  // No allocations; safe for out-of-range x (clamps to edge segments).
  const lastSeg = points.length - 2
  function findSeg(x: number): number {
    if (x <= points[0].x) return 0
    if (x >= points[lastSeg + 1].x) return lastSeg
    let lo = 0
    let hi = lastSeg
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (points[mid].x <= x) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  function groundY(x: number): number {
    const i = findSeg(x)
    const a = points[i]
    const b = points[i + 1]
    const t = clamp((x - a.x) / (b.x - a.x), 0, 1)
    return a.y + (b.y - a.y) * t
  }

  function slopeAt(x: number): number {
    const i = findSeg(x)
    const a = points[i]
    const b = points[i + 1]
    return Math.atan2(b.y - a.y, b.x - a.x)
  }

  // Day markers: one per raw day, pinned to the final surface.
  const markers: DayMarker[] = []
  for (let i = 0; i < n; i++) {
    const x = dayX(i)
    const prev = i > 0 ? series[i - 1].v : series[i].v
    const changePct = prev !== 0 ? ((series[i].v - prev) / prev) * 100 : 0
    markers.push({ x, y: groundY(x), t: series[i].t, v: series[i].v, changePct })
  }

  return {
    points,
    markers,
    startX: points[0].x,
    endX,
    minY,
    maxY,
    groundY,
    slopeAt,
  }
}
