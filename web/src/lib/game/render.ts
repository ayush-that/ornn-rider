// Canvas 2D renderer for Ornn Rider — the Ornn live-chart look.
// Pure black background, fine chart-paper grid, a thin jagged WHITE price line
// the bike rides on, right-edge price axis, a white current-price chip on a
// dotted level line tracking the bike, bottom date labels, and a floating
// price/date tooltip above the bike.
// Layers back->front: black bg + grid, terrain line, markers/coins, finish,
// bike (sprite/vector), particles, speed lines, chip + tooltip (screen space).
import type { GameState, Terrain, Bike, Particle, DayMarker } from './types'
import { C } from './types'

const TAU = Math.PI * 2
const MAX_SLOPE = 0.66

// ---------------------------------------------------------------------------
// Sprite override: use public/assets/{bike-body,wheel}.png if present.
// ---------------------------------------------------------------------------
let bikeImg: HTMLImageElement | null = null
let wheelImg: HTMLImageElement | null = null
let bikeReady = false
let wheelReady = false
let spritesRequested = false
function ensureSprites(): void {
  if (spritesRequested) return
  spritesRequested = true
  const b = new Image()
  b.onload = () => { bikeReady = true }
  b.src = '/assets/bike-body.png'
  bikeImg = b
  const w = new Image()
  w.onload = () => { wheelReady = true }
  w.src = '/assets/wheel.png'
  wheelImg = w
}

// ---------------------------------------------------------------------------
// Terrain cache: value<->worldY mapping (for the price axis) + price levels.
// ---------------------------------------------------------------------------
interface TerrainCache {
  ref: Terrain
  mVal: number // value = mVal * worldY + cVal (least-squares over markers)
  cVal: number
  levelV: number[] // price at each horizontal grid line
  levelY: number[] // worldY of each grid line
}
let tcache: TerrainCache | null = null

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / p
  const n = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10
  return n * p
}

function buildTerrainCache(t: Terrain): TerrainCache {
  const mk = t.markers
  // Least-squares value = m*y + c over all markers (return-driven heights make
  // value vs y only roughly linear; regression gives a stable axis).
  let sy = 0, sv = 0, syy = 0, syv = 0
  const nm = mk.length
  let vMin = Infinity, vMax = -Infinity
  for (let i = 0; i < nm; i++) {
    const y = mk[i].y, v = mk[i].v
    sy += y; sv += v; syy += y * y; syv += y * v
    if (v < vMin) vMin = v
    if (v > vMax) vMax = v
  }
  const denom = nm * syy - sy * sy
  let mVal = 0, cVal = nm > 0 ? sv / nm : 0
  if (Math.abs(denom) > 1e-6) {
    mVal = (nm * syv - sy * sv) / denom
    cVal = (sv - mVal * sy) / nm
  }
  const levelV: number[] = []
  const levelY: number[] = []
  if (nm > 0 && vMax > vMin && mVal !== 0) {
    const step = niceStep((vMax - vMin) / 6)
    const start = Math.ceil(vMin / step) * step
    for (let v = start; v <= vMax + step * 0.001; v += step) {
      levelV.push(v)
      levelY.push((v - cVal) / mVal)
    }
  }
  return { ref: t, mVal, cVal, levelV, levelY }
}

// Interpolated true price at a world x (from markers, x-ascending).
function priceAtX(mk: DayMarker[], x: number): number {
  if (mk.length === 0) return 0
  if (x <= mk[0].x) return mk[0].v
  if (x >= mk[mk.length - 1].x) return mk[mk.length - 1].v
  let lo = 0, hi = mk.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (mk[mid].x <= x) lo = mid
    else hi = mid - 1
  }
  const a = mk[lo], b = mk[lo + 1]
  const f = (x - a.x) / (b.x - a.x)
  return a.v + (b.v - a.v) * f
}

// Nearest marker at/behind x (for tooltip date/time).
function markerAtX(mk: DayMarker[], x: number): DayMarker | null {
  if (mk.length === 0) return null
  let lo = 0, hi = mk.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (mk[mid].x <= x) lo = mid
    else hi = mid - 1
  }
  return mk[lo]
}

function pointIndex(pts: { x: number; y: number }[], x: number): number {
  let lo = 0
  let hi = pts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (pts[mid].x <= x) lo = mid
    else hi = mid - 1
  }
  return lo
}

// Screen-space x/y (pre-dpr) of a world point under the current camera.
function screenX(wx: number, camX: number, w: number, zoom: number, shx: number): number {
  return w / 2 + (wx - camX) * zoom + shx
}
function screenY(wy: number, camY: number, h: number, zoom: number, shy: number): number {
  return h / 2 + (wy - camY) * zoom + shy
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const DAY_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const TIME_FMT = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

function fmtAxis(v: number): string {
  return v >= 100 ? v.toFixed(1) : v.toFixed(2)
}
function fmtPrice(v: number): string {
  return '$' + v.toFixed(2)
}

// ---------------------------------------------------------------------------
// Black background + chart grid (screen space): horizontal price levels with
// right-edge labels, vertical day-boundary lines.
// ---------------------------------------------------------------------------
function drawGrid(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  t: Terrain, camX: number, camY: number, zoom: number, shx: number, shy: number,
): void {
  const c = tcache
  ctx.font = '11px "SF Mono", ui-monospace, Menlo, monospace'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 1

  // vertical day-boundary lines, thinned so dense daily series don't smear.
  ctx.strokeStyle = C.grid
  ctx.beginPath()
  const half = w / 2 / zoom + 80
  const left = camX - half
  const right = camX + half
  const mk = t.markers
  let lastVX = -1e9
  for (let i = 0; i < mk.length; i++) {
    const m = mk[i]
    if (!m.dayBoundary) continue
    if (m.x < left) continue
    if (m.x > right) break
    const sx = screenX(m.x, camX, w, zoom, shx)
    if (sx - lastVX < 46) continue
    lastVX = sx
    ctx.moveTo(sx, 0)
    ctx.lineTo(sx, h)
  }
  ctx.stroke()

  // horizontal price levels + right-edge axis labels.
  if (c) {
    ctx.textAlign = 'right'
    for (let i = 0; i < c.levelY.length; i++) {
      const sy = screenY(c.levelY[i], camY, h, zoom, shy)
      if (sy < 60 || sy > h - 30) continue
      ctx.strokeStyle = C.grid
      ctx.beginPath()
      ctx.moveTo(0, sy)
      ctx.lineTo(w - 64, sy)
      ctx.stroke()
      ctx.fillStyle = C.axis
      ctx.fillText(fmtAxis(c.levelV[i]), w - 10, sy)
    }
  }
}

// ---------------------------------------------------------------------------
// Terrain: thin jagged WHITE line, no fill (barely-visible depth fill below).
// ---------------------------------------------------------------------------
function drawTerrain(ctx: CanvasRenderingContext2D, t: Terrain, camX: number, w: number, zoom: number): void {
  const pts = t.points
  const half = w / 2 / zoom + 80
  const i0 = pointIndex(pts, camX - half)
  const i1 = Math.min(pointIndex(pts, camX + half) + 1, pts.length - 1)
  const bottomY = t.maxY + 4000

  // Faint depth fill below the line.
  ctx.beginPath()
  ctx.moveTo(pts[i0].x, pts[i0].y)
  for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.lineTo(pts[i1].x, bottomY)
  ctx.lineTo(pts[i0].x, bottomY)
  ctx.closePath()
  ctx.fillStyle = '#0a0a0a'
  ctx.fill()

  // Crisp white price line — sharp vertices, no smoothing.
  ctx.beginPath()
  ctx.moveTo(pts[i0].x, pts[i0].y)
  for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.lineWidth = 1.8 / zoom
  ctx.strokeStyle = C.chart
  ctx.lineJoin = 'miter'
  ctx.lineCap = 'butt'
  ctx.stroke()
}

// ---------------------------------------------------------------------------
// Bottom date labels at day boundaries (world space, thinned).
// ---------------------------------------------------------------------------
function drawDateLabels(ctx: CanvasRenderingContext2D, t: Terrain, camX: number, w: number, h: number, zoom: number, shx: number): void {
  const mk = t.markers
  const half = w / 2 / zoom + 80
  const left = camX - half
  const right = camX + half
  ctx.font = '11px "SF Mono", ui-monospace, Menlo, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = C.axis
  let lastLX = -1e9
  for (let i = 0; i < mk.length; i++) {
    const m = mk[i]
    if (!m.dayBoundary) continue
    if (m.x < left) continue
    if (m.x > right) break
    const sx = screenX(m.x, camX, w, zoom, shx)
    if (sx - lastLX < 70 || sx < 20 || sx > w - 70) continue
    lastLX = sx
    ctx.fillText(DAY_FMT.format(m.t), sx, h - 12)
  }
}

// ---------------------------------------------------------------------------
// Credit coins on uncollected markers (world space). Kept for gameplay; the
// candlestick/tick clutter is dropped to keep the chart clean.
// ---------------------------------------------------------------------------
function drawMarkers(ctx: CanvasRenderingContext2D, t: Terrain, camX: number, w: number, zoom: number, collected: Uint8Array | null, timeMs: number): void {
  const mk = t.markers
  const half = w / 2 / zoom + 80
  const left = camX - half
  const right = camX + half
  const bob = Math.sin(timeMs * 0.005) * 4
  for (let i = 0; i < mk.length; i++) {
    const m = mk[i]
    if (m.x < left) continue
    if (m.x > right) break
    if (collected && collected[i]) continue
    const cy = m.y - 40 + bob
    ctx.beginPath()
    ctx.arc(m.x, cy, 6, 0, TAU)
    ctx.fillStyle = 'rgba(245,165,36,0.14)'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(m.x, cy, 3.5, 0, TAU)
    ctx.fillStyle = C.amber
    ctx.fill()
  }
}

// ---------------------------------------------------------------------------
// Finish marker (world space) — minimal white post.
// ---------------------------------------------------------------------------
function drawFinish(ctx: CanvasRenderingContext2D, t: Terrain, zoom: number, timeMs: number): void {
  const x = t.endX
  const gy = t.groundY(x)
  const topY = gy - 120
  ctx.strokeStyle = C.dim
  ctx.lineWidth = 2 / zoom
  ctx.beginPath()
  ctx.moveTo(x, gy)
  ctx.lineTo(x, topY)
  ctx.stroke()
  const wave = Math.sin(timeMs * 0.006) * 3
  const fw = 40, fh = 28, cols = 4, rows = 3
  const cw = fw / cols, chh = fh / rows
  for (let r = 0; r < rows; r++) {
    for (let cX = 0; cX < cols; cX++) {
      ctx.fillStyle = (r + cX) % 2 === 0 ? '#111' : C.chart
      const sway = (cX / cols) * wave
      ctx.fillRect(x + cX * cw, topY + r * chh + sway, cw + 0.5, chh + 0.5)
    }
  }
}

// ---------------------------------------------------------------------------
// Current-price chip + dotted level line tracking the bike (screen space).
// ---------------------------------------------------------------------------
function drawPriceChip(ctx: CanvasRenderingContext2D, w: number, h: number, bikeX: number, camX: number, camY: number, zoom: number, shx: number, shy: number, t: Terrain): void {
  const wy = t.groundY(bikeX)
  const sy = screenY(wy, camY, h, zoom, shy)
  if (sy < 40 || sy > h - 20) return
  const price = priceAtX(t.markers, bikeX)
  // dotted horizontal line across the chart at the bike's price level.
  ctx.save()
  ctx.setLineDash([2, 4])
  ctx.strokeStyle = 'rgba(245,245,245,0.35)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, sy)
  ctx.lineTo(w - 58, sy)
  ctx.stroke()
  ctx.restore()
  // white chip pinned at the right edge.
  const label = fmtAxis(price)
  ctx.font = '11px "SF Mono", ui-monospace, Menlo, monospace'
  const tw = ctx.measureText(label).width
  const cw = tw + 12
  const chh = 16
  const cx = w - cw - 6
  const cyTop = sy - chh / 2
  ctx.fillStyle = C.chipBg
  roundRect(ctx, cx, cyTop, cw, chh, 3)
  ctx.fill()
  ctx.fillStyle = C.chipText
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, cx + cw / 2, sy + 0.5)
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// ---------------------------------------------------------------------------
// Floating tooltip above the bike (screen space, smooth-follow).
// ---------------------------------------------------------------------------
let tipX = -1
let tipY = -1
function drawTooltip(ctx: CanvasRenderingContext2D, w: number, h: number, bike: Bike, camX: number, camY: number, zoom: number, shx: number, shy: number, t: Terrain): void {
  const bx = bike.chassis.position.x
  const by = bike.chassis.position.y
  const targetX = screenX(bx, camX, w, zoom, shx)
  const targetY = screenY(by, camY, h, zoom, shy) - 92
  // smooth-follow so the card never jitters with physics micro-motion.
  if (tipX < 0) { tipX = targetX; tipY = targetY }
  else { tipX += (targetX - tipX) * 0.12; tipY += (targetY - tipY) * 0.12 }
  const cardW = 116
  const cardH = 68
  let cx = tipX - cardW / 2
  let cy = tipY - cardH
  cx = Math.max(8, Math.min(w - cardW - 66, cx))
  cy = Math.max(70, cy)

  const price = priceAtX(t.markers, bx)
  const m = markerAtX(t.markers, bx)

  // card
  ctx.fillStyle = C.panel
  roundRect(ctx, cx, cy, cardW, cardH, 8)
  ctx.fill()

  ctx.textAlign = 'center'
  const midX = cx + cardW / 2
  ctx.fillStyle = C.text
  ctx.font = '600 20px ui-sans-serif, system-ui, -apple-system, sans-serif'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(fmtPrice(price), midX, cy + 27)
  if (m) {
    ctx.fillStyle = C.dim
    ctx.font = '11px ui-sans-serif, system-ui, -apple-system, sans-serif'
    ctx.fillText(DATE_FMT.format(m.t), midX, cy + 44)
    ctx.fillStyle = '#6a6a6a'
    ctx.font = '10px ui-sans-serif, system-ui, -apple-system, sans-serif'
    ctx.fillText(TIME_FMT.format(m.t), midX, cy + 58)
  }

  // white marker dot on the line at the bike x.
  const dotY = screenY(t.groundY(bx), camY, h, zoom, shy)
  ctx.beginPath()
  ctx.arc(targetX, dotY, 4, 0, TAU)
  ctx.fillStyle = C.chart
  ctx.fill()
  ctx.beginPath()
  ctx.arc(targetX, dotY, 4, 0, TAU)
  ctx.lineWidth = 1.5
  ctx.strokeStyle = C.bg0
  ctx.stroke()
}

// ---------------------------------------------------------------------------
// Bike: sprite override or procedural vector (world space). Unchanged.
// ---------------------------------------------------------------------------
function drawWheel(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, r: number): void {
  if (wheelReady && wheelImg) {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)
    ctx.drawImage(wheelImg, -r, -r, r * 2, r * 2)
    ctx.restore()
    return
  }
  ctx.beginPath()
  ctx.arc(x, y, r, 0, TAU)
  ctx.fillStyle = '#0a0c0a'
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = '#1b201b'
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x, y, r - 5, 0, TAU)
  ctx.lineWidth = 2
  ctx.strokeStyle = C.greenDim
  ctx.stroke()
  ctx.strokeStyle = '#2c332c'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  for (let k = 0; k < 6; k++) {
    const a = angle + k * (TAU / 6)
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(a) * (r - 6), y + Math.sin(a) * (r - 6))
  }
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x, y, 3, 0, TAU)
  ctx.fillStyle = C.green
  ctx.fill()
}

function drawBike(ctx: CanvasRenderingContext2D, bike: Bike): void {
  const wb = bike.wheelBack.position
  const wf = bike.wheelFront.position
  const ch = bike.chassis.position
  const a = bike.chassis.angle
  const head = bike.riderHead.position
  const r = 20

  if (bikeReady && bikeImg) {
    drawWheel(ctx, wb.x, wb.y, bike.wheelBack.angle, r)
    drawWheel(ctx, wf.x, wf.y, bike.wheelFront.angle, r)
    ctx.save()
    ctx.translate(ch.x, ch.y)
    ctx.rotate(a)
    const bw = 140
    const bh = 70
    ctx.drawImage(bikeImg, -bw / 2, -bh * 0.62, bw, bh)
    ctx.restore()
    return
  }

  const fx = Math.cos(a)
  const fy = Math.sin(a)
  const ux = Math.sin(a)
  const uy = -Math.cos(a)

  drawWheel(ctx, wb.x, wb.y, bike.wheelBack.angle, r)
  drawWheel(ctx, wf.x, wf.y, bike.wheelFront.angle, r)

  ctx.lineCap = 'round'
  ctx.strokeStyle = '#3a423a'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(ch.x - fx * 8 + ux * 2, ch.y - fy * 8 + uy * 2)
  ctx.lineTo(wb.x, wb.y)
  ctx.stroke()
  ctx.strokeStyle = '#4a524a'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(ch.x + fx * 26 + ux * 6, ch.y + fy * 26 + uy * 6)
  ctx.lineTo(wf.x, wf.y)
  ctx.stroke()

  ctx.strokeStyle = '#20261f'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(ch.x + fx * 2 - ux * 6, ch.y + fy * 2 - uy * 6)
  ctx.lineTo(ch.x - fx * 34 - ux * 2, ch.y - fy * 34 - uy * 2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(245,165,36,0.6)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(ch.x - fx * 30 - ux * 2, ch.y - fy * 30 - uy * 2)
  ctx.lineTo(ch.x - fx * 36 - ux * 2, ch.y - fy * 36 - uy * 2)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(ch.x - fx * 30 + ux * 4, ch.y - fy * 30 + uy * 4)
  ctx.lineTo(ch.x - fx * 30 + ux * 18, ch.y - fy * 30 + uy * 18)
  ctx.lineTo(ch.x - fx * 6 + ux * 20, ch.y - fy * 6 + uy * 20)
  ctx.lineTo(ch.x + fx * 14 + ux * 22, ch.y + fy * 14 + uy * 22)
  ctx.lineTo(ch.x + fx * 30 + ux * 12, ch.y + fy * 30 + uy * 12)
  ctx.lineTo(ch.x + fx * 30 + ux * 2, ch.y + fy * 30 + uy * 2)
  ctx.lineTo(ch.x - fx * 20 - ux * 4, ch.y - fy * 20 - uy * 4)
  ctx.closePath()
  ctx.fillStyle = '#20261f'
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = C.greenDim
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(ch.x + fx * 4 + ux * 20, ch.y + fy * 4 + uy * 20)
  ctx.lineTo(ch.x + fx * 26 + ux * 13, ch.y + fy * 26 + uy * 13)
  ctx.lineWidth = 3
  ctx.strokeStyle = C.green
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(ch.x + fx * 34 + ux * 14, ch.y + fy * 34 + uy * 14, 4, 0, TAU)
  ctx.fillStyle = C.amber
  ctx.fill()

  ctx.strokeStyle = '#5a625a'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(ch.x + fx * 30 + ux * 12, ch.y + fy * 30 + uy * 12)
  ctx.lineTo(ch.x + fx * 30 + ux * 34, ch.y + fy * 30 + uy * 34)
  ctx.stroke()

  const hipx = ch.x - fx * 6 + ux * 22
  const hipy = ch.y - fy * 6 + uy * 22
  const shx2 = head.x - ux * 6
  const shy2 = head.y - uy * 6
  const hbx = ch.x + fx * 30 + ux * 34
  const hby = ch.y + fy * 30 + uy * 34
  const footx = ch.x + fx * 6 + ux * 4
  const footy = ch.y + fy * 6 + uy * 4
  ctx.lineCap = 'round'
  ctx.strokeStyle = '#15181a'
  ctx.lineWidth = 8
  ctx.beginPath()
  ctx.moveTo(hipx, hipy)
  ctx.lineTo(ch.x + fx * 16 + ux * 8, ch.y + fy * 16 + uy * 8)
  ctx.lineTo(footx, footy)
  ctx.stroke()
  ctx.strokeStyle = '#1b1f22'
  ctx.lineWidth = 11
  ctx.beginPath()
  ctx.moveTo(hipx, hipy)
  ctx.lineTo(shx2, shy2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(52,217,123,0.5)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(hipx, hipy)
  ctx.lineTo(shx2, shy2)
  ctx.stroke()
  ctx.strokeStyle = '#15181a'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.moveTo(shx2, shy2)
  ctx.lineTo(hbx, hby)
  ctx.stroke()

  const ha = bike.riderHead.angle
  ctx.beginPath()
  ctx.arc(head.x, head.y, 9, 0, TAU)
  ctx.fillStyle = '#0e100e'
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = C.greenDim
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(head.x, head.y, 6.5, ha - 0.7, ha + 0.7)
  ctx.lineWidth = 3
  ctx.strokeStyle = C.green
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(head.x + Math.cos(ha - 0.4) * 8, head.y + Math.sin(ha - 0.4) * 8)
  ctx.lineTo(head.x + Math.cos(ha) * 14, head.y + Math.sin(ha) * 14)
  ctx.lineWidth = 2
  ctx.strokeStyle = '#0e100e'
  ctx.stroke()
}

// ---------------------------------------------------------------------------
// Particles (world space). Unchanged.
// ---------------------------------------------------------------------------
const GLOW_R = 8
const GLOW_HALF = GLOW_R * 2
const glowSprites = new Map<string, HTMLCanvasElement>()
function glowSprite(color: string): HTMLCanvasElement {
  let cv = glowSprites.get(color)
  if (!cv) {
    cv = document.createElement('canvas')
    cv.width = GLOW_HALF * 2
    cv.height = GLOW_HALF * 2
    const c = cv.getContext('2d')!
    c.fillStyle = color
    c.shadowBlur = 8
    c.shadowColor = color
    c.beginPath()
    c.arc(GLOW_HALF, GLOW_HALF, GLOW_R, 0, TAU)
    c.fill()
    glowSprites.set(color, cv)
  }
  return cv
}

function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]): void {
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]
    if (p.life <= 0 || p.glow) continue
    ctx.globalAlpha = p.life / p.maxLife
    ctx.fillStyle = p.color
    ctx.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2)
  }
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]
    if (p.life <= 0 || !p.glow) continue
    ctx.globalAlpha = p.life / p.maxLife
    const half = (p.size / GLOW_R) * GLOW_HALF
    ctx.drawImage(glowSprite(p.color), p.x - half, p.y - half, half * 2, half * 2)
  }
  ctx.globalAlpha = 1
}

// ---------------------------------------------------------------------------
// Speed lines (screen space). Unchanged.
// ---------------------------------------------------------------------------
function drawSpeedLines(ctx: CanvasRenderingContext2D, w: number, h: number, speed: number, timeMs: number): void {
  const s = (speed - 520) / 90
  if (s <= 0) return
  const n = s > 9 ? 9 : s | 0
  const len = 40 + s * 22
  ctx.strokeStyle = 'rgba(230,236,230,0.16)'
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let k = 0; k < n; k++) {
    const t = (k * 137 + timeMs * 0.9) % (h + 200) - 100
    const yl = ((k * 71 + timeMs * 0.6) % h)
    ctx.moveTo(w - 6, t)
    ctx.lineTo(w - 6 - len, t)
    ctx.moveTo(6, yl)
    ctx.lineTo(6 + len, yl)
  }
  ctx.stroke()
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------
export function render(ctx: CanvasRenderingContext2D, state: GameState, w: number, h: number): void {
  ensureSprites()
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const cam = state.camera
  const zoom = cam.zoom > 0 ? cam.zoom : 1
  const shx = state.effects.shake.x
  const shy = state.effects.shake.y

  const t = state.terrain
  if (t) {
    if (!tcache || tcache.ref !== t) tcache = buildTerrainCache(t)
  }

  // --- screen-space background: pure black + grid ---
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = C.bg0
  ctx.fillRect(0, 0, w, h)
  if (t) drawGrid(ctx, w, h, t, cam.x, cam.y, zoom, shx, shy)

  // --- world-space layers ---
  const sx = dpr * zoom
  ctx.setTransform(sx, 0, 0, sx, dpr * (w / 2 - cam.x * zoom + shx), dpr * (h / 2 - cam.y * zoom + shy))
  if (t) {
    drawTerrain(ctx, t, cam.x, w, zoom)
    drawMarkers(ctx, t, cam.x, w, zoom, state.collected, state.timeMs)
    drawFinish(ctx, t, zoom, state.timeMs)
  }
  if (state.bike) drawBike(ctx, state.bike)
  drawParticles(ctx, state.effects.particles)

  // --- screen-space foreground: date labels, chip, tooltip, speed lines ---
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  if (t) {
    drawDateLabels(ctx, t, cam.x, w, h, zoom, shx)
    const bikeX = state.bike ? state.bike.chassis.position.x : cam.x
    drawPriceChip(ctx, w, h, bikeX, cam.x, cam.y, zoom, shx, shy, t)
    if (state.bike) drawTooltip(ctx, w, h, state.bike, cam.x, cam.y, zoom, shx, shy, t)
  }
  if (state.bike) drawSpeedLines(ctx, w, h, state.bike.speed, state.timeMs)

  ctx.setTransform(1, 0, 0, 1, 0, 0)
}
