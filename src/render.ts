// Canvas 2D renderer for Ornn Rider. Ornn dark-market aesthetic.
// Layers back->front: sky+grid, parallax datacenter skyline, terrain, markers,
// finish flag, bike (vector or sprite), particles, speed lines.
// Perf: setTransform once per layer, cached offscreen skyline/gradients,
// per-segment terrain colours precomputed, zero per-frame allocations.
import type { GameState, Terrain, Bike, Particle } from './types'
import { C } from './types'

const TAU = Math.PI * 2
const MAX_SLOPE = 0.66 // ~38deg, matches terrain clamp

// ---------------------------------------------------------------------------
// Sprite override: use public/assets/{bike-body,wheel}.png if present.
// Loaded lazily; falls back to procedural vector until both are ready.
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
// Cached sky gradient (keyed by height + dpr).
// ---------------------------------------------------------------------------
let skyGrad: CanvasGradient | null = null
let skyGradH = -1
function drawSky(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  if (!skyGrad || skyGradH !== h) {
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, C.bg0)
    g.addColorStop(0.55, C.bg1)
    g.addColorStop(1, '#0a0d0a')
    skyGrad = g
    skyGradH = h
  }
  ctx.fillStyle = skyGrad
  ctx.fillRect(0, 0, w, h)
}

// ---------------------------------------------------------------------------
// Parallax datacenter skyline: two offscreen tiles, blitted with wrap.
// ---------------------------------------------------------------------------
const TILE_W = 640
let farTile: HTMLCanvasElement | null = null
let nearTile: HTMLCanvasElement | null = null
let tilesForH = -1

function buildTile(h: number, near: boolean): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = TILE_W
  cv.height = h
  const c = cv.getContext('2d')!
  const baseTop = near ? h * 0.5 : h * 0.42
  const bodyCol = near ? '#0d110d' : '#0a0d0a'
  const edgeCol = near ? '#141a14' : '#0f130f'
  // deterministic pseudo-random so tiles are stable
  let seed = near ? 1337 : 7331
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) & 0x7fffffff
    return seed / 0x7fffffff
  }
  let x = -20
  while (x < TILE_W + 40) {
    const rw = (near ? 46 : 34) + rnd() * (near ? 58 : 40)
    const rh = (near ? 90 : 60) + rnd() * (near ? 150 : 90)
    const rx = x
    const ry = baseTop + (near ? 0 : rnd() * 30) - rh + h * 0.18
    // rack body (rounded rect)
    const rr = 5
    c.beginPath()
    c.moveTo(rx + rr, ry)
    c.arcTo(rx + rw, ry, rx + rw, ry + rh, rr)
    c.arcTo(rx + rw, ry + rh, rx, ry + rh, rr)
    c.arcTo(rx, ry + rh, rx, ry, rr)
    c.arcTo(rx, ry, rx + rw, ry, rr)
    c.closePath()
    c.fillStyle = bodyCol
    c.fill()
    c.lineWidth = 1
    c.strokeStyle = edgeCol
    c.stroke()
    // LED dots
    const rows = (rh / 16) | 0
    for (let r = 0; r < rows; r++) {
      if (rnd() > (near ? 0.55 : 0.4)) continue
      const lx = rx + 6 + rnd() * (rw - 12)
      const ly = ry + 8 + r * 15
      const amber = rnd() > 0.85
      c.fillStyle = amber ? 'rgba(245,165,36,0.7)' : 'rgba(52,217,123,0.65)'
      c.fillRect(lx, ly, 2, 2)
    }
    x += rw + 6 + rnd() * (near ? 22 : 14)
  }
  return cv
}

function drawParallax(ctx: CanvasRenderingContext2D, w: number, h: number, camX: number): void {
  if (!farTile || !nearTile || tilesForH !== h) {
    farTile = buildTile(h, false)
    nearTile = buildTile(h, true)
    tilesForH = h
  }
  blitLayer(ctx, farTile, w, camX * 0.12)
  blitLayer(ctx, nearTile, w, camX * 0.26)
}

function blitLayer(ctx: CanvasRenderingContext2D, tile: HTMLCanvasElement, w: number, scroll: number): void {
  let off = -(scroll % TILE_W)
  if (off > 0) off -= TILE_W
  for (let x = off; x < w; x += TILE_W) {
    ctx.drawImage(tile, x, 0)
  }
}

// ---------------------------------------------------------------------------
// Terrain cache: per-segment slope colours + price-axis level mapping.
// ---------------------------------------------------------------------------
interface TerrainCache {
  ref: Terrain
  colors: string[]
  mVal: number // value = mVal * worldY + cVal
  cVal: number
  levelY: number[]
  labels: string[]
}
let tcache: TerrainCache | null = null

function toHex(n: number): string {
  const v = n < 0 ? 0 : n > 255 ? 255 : n | 0
  return v < 16 ? '0' + v.toString(16) : v.toString(16)
}
// tint: +1 = steep up (green), -1 = steep down (red), 0 = flat (neutral dark)
// Quantized to 1/8 steps so adjacent segments usually share a colour and can
// be merged into a single fill (see drawTerrain).
function slopeColor(tint: number): string {
  const q = Math.round(tint * 8) / 8
  // base neutral dark
  const nr = 15, ng = 20, nb = 15
  let r = nr, g = ng, b = nb
  if (q > 0) { r += q * 2; g += q * 22; b += q * 10 }
  else { r += -q * 26; g += -q * 6; b += -q * 4 }
  return '#' + toHex(r) + toHex(g) + toHex(b)
}

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / p
  const n = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10
  return n * p
}
function fmtPrice(v: number): string {
  if (v >= 100) return '$' + Math.round(v)
  if (v >= 10) return '$' + v.toFixed(1)
  return '$' + v.toFixed(2)
}

function buildTerrainCache(t: Terrain): TerrainCache {
  const pts = t.points
  const n = pts.length
  const colors = new Array<string>(n > 1 ? n - 1 : 0)
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x
    const dy = pts[i + 1].y - pts[i].y
    const slope = dx !== 0 ? Math.atan(dy / dx) : 0
    // uphill (price up) => dy < 0 => want green (positive tint)
    let tint = -slope / MAX_SLOPE
    if (tint > 1) tint = 1
    else if (tint < -1) tint = -1
    colors[i] = slopeColor(tint)
  }
  // Linear value<->worldY mapping derived from two markers with distinct y.
  const mk = t.markers
  let mVal = 0
  let cVal = 0
  let vMin = Infinity
  let vMax = -Infinity
  if (mk.length > 0) {
    const a = mk[0]
    let b = a
    for (let i = 1; i < mk.length; i++) {
      if (Math.abs(mk[i].y - a.y) > 1) { b = mk[i]; break }
    }
    if (b !== a) {
      mVal = (b.v - a.v) / (b.y - a.y)
      cVal = a.v - mVal * a.y
    } else {
      cVal = a.v
    }
    for (let i = 0; i < mk.length; i++) {
      const v = mk[i].v
      if (v < vMin) vMin = v
      if (v > vMax) vMax = v
    }
  }
  // Price grid levels.
  const levelY: number[] = []
  const labels: string[] = []
  if (mk.length > 0 && vMax > vMin && mVal !== 0) {
    const step = niceStep((vMax - vMin) / 5)
    const start = Math.ceil(vMin / step) * step
    for (let v = start; v <= vMax + step * 0.001; v += step) {
      levelY.push((v - cVal) / mVal)
      labels.push(fmtPrice(v))
    }
  }
  return { ref: t, colors, mVal, cVal, levelY, labels }
}

// binary search: index of last point with x <= target
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

// ---------------------------------------------------------------------------
// Price grid + axis labels (screen space).
// ---------------------------------------------------------------------------
function drawPriceGrid(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  camX: number, camY: number, zoom: number, shx: number, shy: number,
): void {
  const c = tcache
  if (!c) return
  ctx.font = '11px "SF Mono", ui-monospace, Menlo, monospace'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.lineWidth = 1
  // vertical chart lines (faint, world-anchored for subtle scroll)
  const spacing = 120
  const startWx = Math.floor((camX - w / 2 / zoom) / spacing) * spacing
  ctx.strokeStyle = 'rgba(30,36,30,0.5)'
  ctx.beginPath()
  for (let wx = startWx; ; wx += spacing) {
    const sx = w / 2 + (wx - camX) * zoom + shx
    if (sx > w) break
    if (sx < 0) continue
    ctx.moveTo(sx, 0)
    ctx.lineTo(sx, h)
  }
  ctx.stroke()
  // horizontal price levels
  for (let i = 0; i < c.levelY.length; i++) {
    const sy = h / 2 + (c.levelY[i] - camY) * zoom + shy
    if (sy < 14 || sy > h - 4) continue
    ctx.strokeStyle = 'rgba(30,36,30,0.7)'
    ctx.beginPath()
    ctx.moveTo(0, sy)
    ctx.lineTo(w, sy)
    ctx.stroke()
    ctx.fillStyle = C.dim
    ctx.fillText(c.labels[i], 8, sy - 7)
  }
}

// ---------------------------------------------------------------------------
// Terrain (world space).
// ---------------------------------------------------------------------------
function drawTerrain(ctx: CanvasRenderingContext2D, t: Terrain, camX: number, w: number, zoom: number): void {
  const c = tcache!
  const pts = t.points
  const half = w / 2 / zoom + 80
  const i0 = pointIndex(pts, camX - half)
  const i1 = pointIndex(pts, camX + half)
  const bottomY = t.maxY + 4000
  // Slope-tinted fill down to bottom. Colours are quantized, so runs of
  // same-colour segments merge into one path/fill (~5-10x fewer fills).
  let i = i0
  const iEnd = Math.min(i1, pts.length - 1)
  while (i < iEnd) {
    const color = c.colors[i]
    let j = i + 1
    while (j < iEnd && c.colors[j] === color) j++
    ctx.beginPath()
    ctx.moveTo(pts[i].x, pts[i].y)
    for (let k = i + 1; k <= j; k++) ctx.lineTo(pts[k].x, pts[k].y)
    ctx.lineTo(pts[j].x, bottomY)
    ctx.lineTo(pts[i].x, bottomY)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
    i = j
  }
  // Crisp green top line (no glow on terrain per perf rules).
  ctx.beginPath()
  ctx.moveTo(pts[i0].x, pts[i0].y)
  for (let i = i0 + 1; i <= i1 && i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.lineWidth = 2 / zoom
  ctx.strokeStyle = C.green
  ctx.lineJoin = 'round'
  ctx.stroke()
  // subtle brighter under-line highlight
  ctx.beginPath()
  ctx.moveTo(pts[i0].x, pts[i0].y + 2 / zoom)
  for (let i = i0 + 1; i <= i1 && i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y + 2 / zoom)
  ctx.lineWidth = 1 / zoom
  ctx.strokeStyle = 'rgba(52,217,123,0.18)'
  ctx.stroke()
}

// ---------------------------------------------------------------------------
// Day markers: ticks + candlestick glyph + floating credit coins (world space).
// ---------------------------------------------------------------------------
function drawMarkers(ctx: CanvasRenderingContext2D, t: Terrain, camX: number, w: number, zoom: number, bikeX: number, timeMs: number): void {
  const mk = t.markers
  const half = w / 2 / zoom + 80
  const left = camX - half
  const right = camX + half
  const bob = Math.sin(timeMs * 0.005) * 4
  for (let i = 0; i < mk.length; i++) {
    const m = mk[i]
    if (m.x < left) continue
    if (m.x > right) break
    const up = m.changePct >= 0
    const col = up ? C.green : C.red
    // thin tick from surface
    ctx.strokeStyle = 'rgba(122,133,122,0.35)'
    ctx.lineWidth = 1 / zoom
    ctx.beginPath()
    ctx.moveTo(m.x, m.y)
    ctx.lineTo(m.x, m.y - 22)
    ctx.stroke()
    // candlestick glyph above the surface
    const gy = m.y - 34
    let bodyH = Math.abs(m.changePct) * 2.2
    if (bodyH > 16) bodyH = 16
    if (bodyH < 3) bodyH = 3
    const bw = 4
    ctx.strokeStyle = col
    ctx.lineWidth = 1 / zoom
    ctx.beginPath()
    ctx.moveTo(m.x, gy - bodyH - 4)
    ctx.lineTo(m.x, gy + bodyH + 4)
    ctx.stroke()
    ctx.fillStyle = up ? col : '#1a0f0e'
    ctx.fillRect(m.x - bw / 2, up ? gy - bodyH : gy, bw, bodyH)
    if (!up) { ctx.strokeRect(m.x - bw / 2, gy, bw, bodyH) }
    // floating credit coin above uncollected (ahead of bike) markers
    if (m.x > bikeX + 24) {
      const cy = m.y - 66 + bob
      ctx.beginPath()
      ctx.arc(m.x, cy, 6, 0, TAU)
      ctx.fillStyle = 'rgba(52,217,123,0.14)'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(m.x, cy, 4, 0, TAU)
      ctx.fillStyle = C.green
      ctx.fill()
      ctx.beginPath()
      ctx.arc(m.x, cy, 4, 0, TAU)
      ctx.lineWidth = 1 / zoom
      ctx.strokeStyle = C.amber
      ctx.stroke()
    }
  }
}

// ---------------------------------------------------------------------------
// Finish flag (world space).
// ---------------------------------------------------------------------------
function drawFinish(ctx: CanvasRenderingContext2D, t: Terrain, zoom: number, timeMs: number): void {
  const x = t.endX
  const gy = t.groundY(x)
  const topY = gy - 130
  ctx.strokeStyle = C.dim
  ctx.lineWidth = 3 / zoom
  ctx.beginPath()
  ctx.moveTo(x, gy)
  ctx.lineTo(x, topY)
  ctx.stroke()
  // waving checkered flag
  const wave = Math.sin(timeMs * 0.006) * 4
  const fw = 48
  const fh = 34
  const cols = 4
  const rows = 3
  const cw = fw / cols
  const chh = fh / rows
  for (let r = 0; r < rows; r++) {
    for (let cX = 0; cX < cols; cX++) {
      const dark = (r + cX) % 2 === 0
      ctx.fillStyle = dark ? '#0b0d0b' : C.green
      const sway = (cX / cols) * wave
      ctx.fillRect(x + cX * cw, topY + r * chh + sway, cw + 0.5, chh + 0.5)
    }
  }
}

// ---------------------------------------------------------------------------
// Bike: sprite override or procedural vector (world space).
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
  // tire
  ctx.beginPath()
  ctx.arc(x, y, r, 0, TAU)
  ctx.fillStyle = '#0a0c0a'
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = '#1b201b'
  ctx.stroke()
  // rim
  ctx.beginPath()
  ctx.arc(x, y, r - 5, 0, TAU)
  ctx.lineWidth = 2
  ctx.strokeStyle = C.greenDim
  ctx.stroke()
  // spokes (rotate with wheel angle)
  ctx.strokeStyle = '#2c332c'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  for (let k = 0; k < 6; k++) {
    const a = angle + k * (TAU / 6)
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(a) * (r - 6), y + Math.sin(a) * (r - 6))
  }
  ctx.stroke()
  // hub
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

  // Sprite override (both loaded): body sprite + wheel sprites.
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

  // frame basis vectors
  const fx = Math.cos(a)
  const fy = Math.sin(a)
  const ux = Math.sin(a)
  const uy = -Math.cos(a)

  // wheels first so frame overlaps hubs
  drawWheel(ctx, wb.x, wb.y, bike.wheelBack.angle, r)
  drawWheel(ctx, wf.x, wf.y, bike.wheelFront.angle, r)

  // swingarm (rear) + fork (front)
  ctx.lineCap = 'round'
  ctx.strokeStyle = '#3a423a'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(ch.x - fx * 8 + ux * 2, ch.y - fy * 8 + uy * 2)
  ctx.lineTo(wb.x, wb.y)
  ctx.stroke()
  // front fork (two struts)
  ctx.strokeStyle = '#4a524a'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(ch.x + fx * 26 + ux * 6, ch.y + fy * 26 + uy * 6)
  ctx.lineTo(wf.x, wf.y)
  ctx.stroke()

  // exhaust pipe (low, amber tip)
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

  // frame body: belly -> tank -> seat (a filled shell)
  ctx.beginPath()
  ctx.moveTo(ch.x - fx * 30 + ux * 4, ch.y - fy * 30 + uy * 4)   // rear seat base
  ctx.lineTo(ch.x - fx * 30 + ux * 18, ch.y - fy * 30 + uy * 18) // seat top rear
  ctx.lineTo(ch.x - fx * 6 + ux * 20, ch.y - fy * 6 + uy * 20)   // seat top front
  ctx.lineTo(ch.x + fx * 14 + ux * 22, ch.y + fy * 14 + uy * 22) // tank top
  ctx.lineTo(ch.x + fx * 30 + ux * 12, ch.y + fy * 30 + uy * 12) // tank front
  ctx.lineTo(ch.x + fx * 30 + ux * 2, ch.y + fy * 30 + uy * 2)   // belly front
  ctx.lineTo(ch.x - fx * 20 - ux * 4, ch.y - fy * 20 - uy * 4)   // belly rear
  ctx.closePath()
  ctx.fillStyle = '#20261f'
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = C.greenDim
  ctx.stroke()
  // green tank accent stripe
  ctx.beginPath()
  ctx.moveTo(ch.x + fx * 4 + ux * 20, ch.y + fy * 4 + uy * 20)
  ctx.lineTo(ch.x + fx * 26 + ux * 13, ch.y + fy * 26 + uy * 13)
  ctx.lineWidth = 3
  ctx.strokeStyle = C.green
  ctx.stroke()
  // front number plate / headlight
  ctx.beginPath()
  ctx.arc(ch.x + fx * 34 + ux * 14, ch.y + fy * 34 + uy * 14, 4, 0, TAU)
  ctx.fillStyle = C.amber
  ctx.fill()

  // handlebar
  ctx.strokeStyle = '#5a625a'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(ch.x + fx * 30 + ux * 12, ch.y + fy * 30 + uy * 12)
  ctx.lineTo(ch.x + fx * 30 + ux * 34, ch.y + fy * 30 + uy * 34)
  ctx.stroke()

  // --- rider (leaning forward, motocross stance) ---
  // hip near seat
  const hipx = ch.x - fx * 6 + ux * 22
  const hipy = ch.y - fy * 6 + uy * 22
  // shoulder toward head
  const shx = head.x - ux * 6
  const shy = head.y - uy * 6
  // hand at bar
  const hbx = ch.x + fx * 30 + ux * 34
  const hby = ch.y + fy * 30 + uy * 34
  // knee/foot near peg
  const footx = ch.x + fx * 6 + ux * 4
  const footy = ch.y + fy * 6 + uy * 4
  // leg
  ctx.lineCap = 'round'
  ctx.strokeStyle = '#15181a'
  ctx.lineWidth = 8
  ctx.beginPath()
  ctx.moveTo(hipx, hipy)
  ctx.lineTo(ch.x + fx * 16 + ux * 8, ch.y + fy * 16 + uy * 8) // knee
  ctx.lineTo(footx, footy)
  ctx.stroke()
  // torso
  ctx.strokeStyle = '#1b1f22'
  ctx.lineWidth = 11
  ctx.beginPath()
  ctx.moveTo(hipx, hipy)
  ctx.lineTo(shx, shy)
  ctx.stroke()
  // green back trim
  ctx.strokeStyle = 'rgba(52,217,123,0.5)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(hipx, hipy)
  ctx.lineTo(shx, shy)
  ctx.stroke()
  // arm to bar
  ctx.strokeStyle = '#15181a'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.moveTo(shx, shy)
  ctx.lineTo(hbx, hby)
  ctx.stroke()

  // helmet
  const ha = bike.riderHead.angle
  ctx.beginPath()
  ctx.arc(head.x, head.y, 9, 0, TAU)
  ctx.fillStyle = '#0e100e'
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = C.greenDim
  ctx.stroke()
  // visor (forward-facing green arc)
  ctx.beginPath()
  ctx.arc(head.x, head.y, 6.5, ha - 0.7, ha + 0.7)
  ctx.lineWidth = 3
  ctx.strokeStyle = C.green
  ctx.stroke()
  // helmet peak
  ctx.beginPath()
  ctx.moveTo(head.x + Math.cos(ha - 0.4) * 8, head.y + Math.sin(ha - 0.4) * 8)
  ctx.lineTo(head.x + Math.cos(ha) * 14, head.y + Math.sin(ha) * 14)
  ctx.lineWidth = 2
  ctx.strokeStyle = '#0e100e'
  ctx.stroke()
}

// ---------------------------------------------------------------------------
// Particles (world space).
// ---------------------------------------------------------------------------
// Pre-rendered glow sprites, one per particle colour (palettes are constant
// strings, so this map stays tiny). Canvas shadowBlur costs a blur pass per
// fill; blitting a cached sprite avoids that entirely in the hot loop.
const GLOW_R = 8 // sprite dot radius; blur margin doubles the canvas size
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
  // non-glow pass
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]
    if (p.life <= 0 || p.glow) continue
    ctx.globalAlpha = p.life / p.maxLife
    ctx.fillStyle = p.color
    ctx.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2)
  }
  // glow pass: alpha-modulated sprite blit, scaled so the dot radius matches
  // p.size (shadow state untouched — no per-particle blur passes).
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
// Speed lines near screen edges at high speed (screen space).
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
    // right edge (moving toward you)
    ctx.moveTo(w - 6, t)
    ctx.lineTo(w - 6 - len, t)
    // left edge
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

  // --- screen-space background layers ---
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  drawSky(ctx, w, h)
  drawParallax(ctx, w, h, cam.x)
  if (t) drawPriceGrid(ctx, w, h, cam.x, cam.y, zoom, shx, shy)

  // --- world-space layers ---
  const sx = dpr * zoom
  ctx.setTransform(sx, 0, 0, sx, dpr * (w / 2 - cam.x * zoom + shx), dpr * (h / 2 - cam.y * zoom + shy))
  if (t) {
    drawTerrain(ctx, t, cam.x, w, zoom)
    const bikeX = state.bike ? state.bike.chassis.position.x : cam.x
    drawMarkers(ctx, t, cam.x, w, zoom, bikeX, state.timeMs)
    drawFinish(ctx, t, zoom, state.timeMs)
  }
  if (state.bike) drawBike(ctx, state.bike)
  drawParticles(ctx, state.effects.particles)

  // --- screen-space foreground ---
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  if (state.bike) drawSpeedLines(ctx, w, h, state.bike.speed, state.timeMs)

  ctx.setTransform(1, 0, 0, 1, 0, 0)
}
