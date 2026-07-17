// Terrain generation: real price series -> rideable 2D chart line.
// The terrain IS the chart: straight segments between consecutive data points
// (sharp vertices, no smoothing), exactly like the thin white line in the Ornn
// live chart. Heights are return-driven so trends read as sustained climbs.
import type { SeriesPoint, Terrain, TerrainPoint, DayMarker } from './types'

const MAX_SLOPE_RAD = (30 * Math.PI) / 180
const LEAD_IN = 900 // flat run-up before data
const LEAD_OUT = 600 // flat run-out after data
const BASE_Y = 900 // world y of the first point, +y down

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

// First raw point of each local calendar day is a "day boundary" — those get the
// bottom date labels. Daily series make every point a boundary.
function isDayBoundary(series: SeriesPoint[], i: number): boolean {
  if (i === 0) return true
  const a = new Date(series[i - 1].t)
  const b = new Date(series[i].t)
  return a.getDate() !== b.getDate() || a.getMonth() !== b.getMonth() || a.getFullYear() !== b.getFullYear()
}

export function buildTerrain(series: SeriesPoint[]): Terrain {
  const n = series.length
  if (n < 2) throw new Error('buildTerrain: need at least 2 series points')

  // Fixed day spacing (the old 3-month density): longer history = longer map,
  // never a denser one. Full H100 (~750d) ≈ 180k px; NAND (~1900d) ≈ 460k px.
  const dx = 240
  const maxDy = Math.tan(MAX_SLOPE_RAD) * dx // per-segment rise/fall cap

  // Return-driven heights: each segment's rise/fall is proportional to its
  // point-over-point % change, not global min/max range. Adaptive gain maps the
  // median move to ~11deg so calm and volatile series both stay lively but
  // rideable; per-segment clamp keeps the 30deg cap. Price up = uphill.
  const pct = new Float64Array(n)
  const absPct: number[] = []
  for (let i = 1; i < n; i++) {
    const prev = series[i - 1].v
    pct[i] = prev > 1e-9 ? ((series[i].v - prev) / prev) * 100 : 0
    absPct.push(Math.abs(pct[i]))
  }
  absPct.sort((a, b) => a - b)
  const median = Math.max(absPct[absPct.length >> 1] ?? 0, 0.15) // % floor
  const TYPICAL_SLOPE_RAD = (11 * Math.PI) / 180
  const gain = (Math.tan(TYPICAL_SLOPE_RAD) * dx) / median // px per 1% move

  const dayY = new Float64Array(n)
  dayY[0] = BASE_Y
  for (let i = 1; i < n; i++) {
    dayY[i] = dayY[i - 1] + clamp(-pct[i] * gain, -maxDy, maxDy)
  }

  const dataStartX = LEAD_IN
  const dayX = (i: number): number => dataStartX + i * dx

  const points: TerrainPoint[] = []

  // Lead-in: flat pad at the first point's height.
  const y0 = dayY[0]
  for (let x = 0; x < LEAD_IN; x += 100) points.push({ x, y: y0 })

  // Data: one vertex per raw point, straight lines between them (the jagged
  // chart look). No subdivision, no noise, no smoothing.
  for (let i = 0; i < n; i++) points.push({ x: dayX(i), y: dayY[i] })

  const lastX = dayX(n - 1)
  const lastY = dayY[n - 1]

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

  // Markers: one per raw point (coins), flagged for day boundaries (labels).
  const markers: DayMarker[] = []
  for (let i = 0; i < n; i++) {
    const x = dayX(i)
    const prev = i > 0 ? series[i - 1].v : series[i].v
    const changePct = prev !== 0 ? ((series[i].v - prev) / prev) * 100 : 0
    markers.push({ x, y: dayY[i], t: series[i].t, v: series[i].v, changePct, dayBoundary: isDayBoundary(series, i) })
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
