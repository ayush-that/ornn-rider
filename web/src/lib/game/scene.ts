// OrnnScene — the whole game world + chart chrome in Phaser (Matter physics,
// WebGL rendering). Ported 1:1 from the old Canvas2D + matter-js engine
// (render.ts / bike.ts / effects.ts / game.ts internals) plus two new features:
// ragdoll crashes and nitro. game.ts owns the Phaser.Game lifecycle, DOM hud,
// audio, input listeners and data loading; this scene owns everything visual
// and physical. Matter access is via the raw modules Phaser exposes on
// `this.matter` (bodies/body/constraint/composite/world) so tuning matches the
// original matter-js code exactly.
import * as Phaser from 'phaser'
import type { GameState, Terrain, DayMarker, BikeView } from './types'
import { CN } from './types'
import type { createHud } from './hud'
import type { Audio } from './audio'

type Hud = ReturnType<typeof createHud>
type Body = MatterJS.BodyType
type Constraint = MatterJS.ConstraintType

// --- Bike body layout (offsets from chassis spawn centre) ------------------
// Wheelbase widened to 112 (±56) so the bike-solo.png fork/swingarm actually
// socket the wheel bodies. bike-solo.png (512x267) axle mounts measured by
// opaque-pixel analysis: rear (54,261), front (450,265) → visual wheelbase
// 396px. Sprite scale/origin below are derived from these so the sprite axles
// map exactly onto the wheel body centres. See BIKE_SCALE / BIKE_ORIGIN_*.
const BACK_DX = -56
const FRONT_DX = 56
const WHEEL_DY = 18
const HEAD_DX = -6
const HEAD_DY = -30
const WHEEL_R = 20
const CHASSIS_W = 90
const CHASSIS_H = 22
const HEAD_R = 11

// Bike sprite anchoring, derived from the axle measurements (do not eyeball):
//   scale = physicsWheelbase (112) / spriteWheelbase (396)
//   origin maps sprite pixel (252, 263) → chassis centre, so the two axle
//   pixels land on the wheel centres at (±56, +18) from the chassis. Solving
//   (263 - oy*267)*scale = WHEEL_DY gives origin_y ≈ 0.7467.
const BIKE_SPRITE_W = 128
const BIKE_SPRITE_H = 67
const BIKE_AXLE_Y = 65.75 // avg axle y in 128x67 pixel-art sprite space (orig/4)
const BIKE_SCALE = 112 / 99 // physics wheelbase / pixel-sprite wheelbase (396/4)
const BIKE_ORIGIN_X = 63 / BIKE_SPRITE_W // midpoint of axle x's (13.5, 112.5)
const BIKE_ORIGIN_Y = (BIKE_AXLE_Y - WHEEL_DY / BIKE_SCALE) / BIKE_SPRITE_H // ≈ 0.7467

// --- Drive tuning (per 60fps physics step) ---------------------------------
const MAX_WHEEL_AV = 1.15
const WHEEL_ACCEL = 0.12
const BRAKE_DECEL = 0.09
const REVERSE_TARGET_AV = -0.28
const WHEELIE_TORQUE = 0.018 // raised for the wider 112 wheelbase (was 0.007 at 64)
const MAX_WHEELIE_AV = 0.11
const AIR_LEAN = 0.022
const GROUND_LEAN = 0.006

// --- Terrain body tuning ---------------------------------------------------
const SEG_THICKNESS = 50
const SEG_OVERLAP = 8
const COLLIDER_WINDOW = 2000

// --- Loop / spawn ----------------------------------------------------------
const STEP = 1000 / 60
const MAX_STEPS = 4
const TWO_PI = Math.PI * 2
const SPAWN_DX = 90
const SPAWN_DY = 60

// --- Nitro tuning ----------------------------------------------------------
// Scarce by design: a full tank lasts ~1.8s and refills slowly, so sustained
// boost is impossible even while hoovering up coins at speed.
const NITRO_DRAIN = 0.55 // per second while active
const NITRO_TRICKLE = 0.02 // per second, always
const NITRO_PER_COIN = 0.04
const NITRO_PER_FLIP = 0.2
const NITRO_ARM = 0.10 // min charge to (re)start a boost — hysteresis vs empty-tank stutter
const NITRO_FORCE = 0.0027 // ~3x the peak trend-wind force per step

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
function approach(cur: number, target: number, step: number): number {
  if (cur < target) return Math.min(cur + step, target)
  if (cur > target) return Math.max(cur - step, target)
  return target
}

const DAY_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
function fmtAxis(v: number): string { return v >= 100 ? v.toFixed(1) : v.toFixed(2) }

// Everything the scene needs from game.ts (shared, mutated in place).
export interface GameCtx {
  state: GameState
  hud: Hud
  audio: Audio
  keys: Set<string>
  touch: { throttle: boolean; brake: boolean; nitro: boolean }
  isMuted: () => boolean
  saveBest: () => void // persist best distance + set state.newBest
  onReady: () => void // fired once the scene has booted (kick off first load)
}

// Price-axis mapping cache (least-squares value = m*y + c over markers).
interface AxisCache {
  mVal: number
  cVal: number
  levelV: number[]
  levelY: number[]
}
function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / p
  const n = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10
  return n * p
}
function buildAxisCache(t: Terrain): AxisCache {
  const mk = t.markers
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
  return { mVal, cVal, levelV, levelY }
}
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
  return a.v + (b.v - a.v) * ((x - a.x) / (b.x - a.x))
}
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
  let lo = 0, hi = pts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (pts[mid].x <= x) lo = mid
    else hi = mid - 1
  }
  return lo
}

const MONO = '"Space Grotesk Variable", ui-sans-serif, system-ui, sans-serif'
const SANS = '"Space Grotesk Variable", ui-sans-serif, system-ui, sans-serif'

export class OrnnScene extends Phaser.Scene {
  private ctx!: GameCtx

  // graphics / text layers
  private worldGfx!: Phaser.GameObjects.Graphics
  private chromeGfx!: Phaser.GameObjects.Graphics
  private axisTexts: Phaser.GameObjects.Text[] = []
  private dateTexts: Phaser.GameObjects.Text[] = []
  private chipText!: Phaser.GameObjects.Text

  // sprites
  private bikeSprite!: Phaser.GameObjects.Image
  private riderSprite!: Phaser.GameObjects.Image
  private ragdollSprite!: Phaser.GameObjects.Image
  private wheelBackSprite!: Phaser.GameObjects.Image
  private wheelFrontSprite!: Phaser.GameObjects.Image
  private coinSprites: Phaser.GameObjects.Image[] = []
  private flagSprite: Phaser.GameObjects.Image | null = null

  // particle emitters
  private eDust!: Phaser.GameObjects.Particles.ParticleEmitter
  private eBoost!: Phaser.GameObjects.Particles.ParticleEmitter
  private eEmber!: Phaser.GameObjects.Particles.ParticleEmitter
  private eCrash!: Phaser.GameObjects.Particles.ParticleEmitter
  private ePickup!: Phaser.GameObjects.Particles.ParticleEmitter
  private eNitroCore!: Phaser.GameObjects.Particles.ParticleEmitter
  private eNitroFringe!: Phaser.GameObjects.Particles.ParticleEmitter

  // physics bodies
  private chassis!: Body
  private wheelBack!: Body
  private wheelFront!: Body
  private riderHead!: Body
  private bikeBodies: (Body | Constraint)[] = []
  private ragdoll: Body | null = null

  // terrain collider (sliding window)
  private segBodies: Body[] = []
  private segXs: number[] = []
  private loIdx = 0
  private hiIdx = 0

  // bike readonly-facing state
  private contacts = 0
  private grounded = false
  private crashed = false
  private headHit = false
  private _speed = 0
  private _rpm = 0
  private bikeView!: BikeView

  private axis: AxisCache | null = null
  private built = false

  // run-scoped logic state
  private startX = 0
  private collectIdx = 0
  private trendIdx = 0
  private prevGrounded = true
  private curAirMs = 0 // continuous current-air duration (resets on landing)
  private airMaxVy = 0
  private flipAccum = 0
  private pendingFlips = 0
  private lastAngle = 0
  private resultsShown = false
  private outcomeAt = 0
  private fxTick = 0
  private prevNitroActive = false
  private nitroLatch = false
  private ejectCamUntil = 0

  // fixed-timestep accumulator
  private acc = 0


  // camera shake (ported from effects.ts)
  private shakeMag = 0
  private shx = 0
  private shy = 0

  constructor(ctx: GameCtx) {
    super({ key: 'ornn' })
    this.ctx = ctx
  }

  preload(): void {
    this.load.image('bike', '/assets/px/bike-solo.png')
    this.load.image('rider', '/assets/px/rider.png')
    this.load.image('ragdoll', '/assets/px/rider-ragdoll.png')
    this.load.image('wheel', '/assets/px/wheel.png')
    this.load.image('coin', '/assets/px/coin.png')
    this.load.image('flag', '/assets/px/flag.png')
  }

  create(): void {
    this.cameras.main.setBackgroundColor(CN.bg0)

    this.makeParticleTextures()

    // Layers (world space is transformed by the camera; chrome is pinned).
    this.worldGfx = this.add.graphics().setDepth(0)

    // Bike sprites — created hidden, positioned once the world is built.
    this.wheelBackSprite = this.add.image(0, 0, 'wheel').setDepth(5).setScale(44 / 32).setVisible(false)
    this.wheelFrontSprite = this.add.image(0, 0, 'wheel').setDepth(5).setScale(44 / 32).setVisible(false)
    this.bikeSprite = this.add.image(0, 0, 'bike').setDepth(6).setOrigin(BIKE_ORIGIN_X, BIKE_ORIGIN_Y).setScale(BIKE_SCALE).setVisible(false)
    // Rider sits on the bike: origin at his hips, scaled so his torso doesn't
    // tower over the handlebars. Seat offset is derived in syncSprites().
    this.riderSprite = this.add.image(0, 0, 'rider').setDepth(7).setOrigin(0.5, 0.66).setScale(103 / 88).setVisible(false)
    this.ragdollSprite = this.add.image(0, 0, 'ragdoll').setDepth(7).setOrigin(0.5, 0.5).setScale(100 / 66).setVisible(false)

    this.chromeGfx = this.add.graphics().setScrollFactor(0).setDepth(20)

    // Text pools (screen space).
    for (let i = 0; i < 14; i++) {
      this.axisTexts.push(this.add.text(0, 0, '', { fontFamily: MONO, fontSize: '11px', color: '#6a6a6a' })
        .setScrollFactor(0).setDepth(21).setOrigin(1, 0.5).setVisible(false))
    }
    for (let i = 0; i < 48; i++) {
      this.dateTexts.push(this.add.text(0, 0, '', { fontFamily: MONO, fontSize: '11px', color: '#6a6a6a' })
        .setScrollFactor(0).setDepth(21).setOrigin(0.5, 1).setVisible(false))
    }
    this.chipText = this.add.text(0, 0, '', { fontFamily: MONO, fontSize: '11px', color: '#050505' })
      .setScrollFactor(0).setDepth(22).setOrigin(0.5, 0.5).setVisible(false)

    this.makeEmitters()

    this.bikeView = {
      chassis: { position: { x: 0, y: 0 }, angle: 0 },
      speed: 0, rpm: 0, grounded: false, crashed: false, ejected: false,
    }

    // Collision bookkeeping (grounded + crash sensor), zero per-frame alloc.
    this.matter.world.on('collisionstart', (e: { pairs: MatterJS.IPair[] }) => {
      const pairs = e.pairs
      for (let i = 0; i < pairs.length; i++) {
        const a = (pairs[i].bodyA as unknown as Body).label
        const b = (pairs[i].bodyB as unknown as Body).label
        if (a !== 'terrain' && b !== 'terrain') continue
        if (a === 'wheel' || b === 'wheel') this.contacts++
        if (a === 'head' || b === 'head') this.headHit = true
      }
    })
    this.matter.world.on('collisionend', (e: { pairs: MatterJS.IPair[] }) => {
      const pairs = e.pairs
      for (let i = 0; i < pairs.length; i++) {
        const a = (pairs[i].bodyA as unknown as Body).label
        const b = (pairs[i].bodyB as unknown as Body).label
        if (a !== 'terrain' && b !== 'terrain') continue
        if (a === 'wheel' || b === 'wheel') this.contacts = Math.max(0, this.contacts - 1)
      }
    })

    this.built = false
    this.ctx.onReady()
  }

  // ---- particle textures -------------------------------------------------
  private makeParticleTextures(): void {
    // soft radial blob for glow particles (tinted per emitter)
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    for (let i = 8; i >= 1; i--) {
      g.fillStyle(0xffffff, 0.16)
      g.fillCircle(8, 8, i)
    }
    g.generateTexture('soft', 16, 16)
    g.clear()
    // tiny square for opaque dust
    g.fillStyle(0xffffff, 1)
    g.fillRect(0, 0, 4, 4)
    g.generateTexture('px', 4, 4)
    g.destroy()
  }

  private makeEmitters(): void {
    const ADD = Phaser.BlendModes.ADD
    this.eDust = this.add.particles(0, 0, 'px', {
      lifespan: 520, speed: { min: 4, max: 34 }, angle: { min: 200, max: 340 },
      scale: { start: 1.1, end: 0 }, alpha: { start: 0.55, end: 0 },
      gravityY: 60, tint: [CN.dust, 0x75846f, 0xa2ad9c], emitting: false,
    }).setDepth(10)
    this.eBoost = this.add.particles(0, 0, 'soft', {
      lifespan: 420, speed: { min: 60, max: 180 }, angle: { min: 150, max: 210 },
      scale: { start: 0.5, end: 0 }, alpha: { start: 0.9, end: 0 },
      tint: [CN.green, CN.greenDim, CN.greenBright], blendMode: ADD, emitting: false,
    }).setDepth(10)
    this.eEmber = this.add.particles(0, 0, 'soft', {
      lifespan: 720, speed: { min: 10, max: 40 }, angle: { min: 240, max: 300 },
      scale: { start: 0.4, end: 0 }, alpha: { start: 0.8, end: 0 },
      gravityY: -20, tint: [CN.red, CN.amber, CN.amberBright], blendMode: ADD, emitting: false,
    }).setDepth(10)
    this.eCrash = this.add.particles(0, 0, 'soft', {
      lifespan: { min: 360, max: 880 }, speed: { min: 60, max: 340 }, angle: { min: 0, max: 360 },
      scale: { start: 0.6, end: 0 }, alpha: { start: 1, end: 0 },
      gravityY: 220, tint: [CN.red, CN.amber, CN.green, 0xe6ece6, CN.amberBright], blendMode: ADD, emitting: false,
    }).setDepth(11)
    this.ePickup = this.add.particles(0, 0, 'soft', {
      lifespan: 340, speed: { min: 70, max: 130 }, angle: { min: 0, max: 360 },
      scale: { start: 0.4, end: 0 }, alpha: { start: 0.9, end: 0 },
      tint: [CN.green, CN.greenBright], blendMode: ADD, emitting: false,
    }).setDepth(11)
    // nitro flame: amber core + green fringe cone from the exhaust
    this.eNitroCore = this.add.particles(0, 0, 'soft', {
      lifespan: 260, speed: { min: 120, max: 260 }, angle: { min: 150, max: 210 },
      scale: { start: 0.7, end: 0 }, alpha: { start: 0.95, end: 0 },
      tint: [CN.amber, CN.amberBright, 0xffe08a], blendMode: ADD, emitting: false,
    }).setDepth(9)
    this.eNitroFringe = this.add.particles(0, 0, 'soft', {
      lifespan: 340, speed: { min: 60, max: 160 }, angle: { min: 140, max: 220 },
      scale: { start: 0.5, end: 0 }, alpha: { start: 0.7, end: 0 },
      tint: [CN.green, CN.greenBright], blendMode: ADD, emitting: false,
    }).setDepth(9)
  }

  // ---- world build / teardown -------------------------------------------
  // Called by game.ts once a track's terrain is ready. Rebuilds the bike,
  // terrain collider, coins and finish flag for the new terrain.
  buildWorld(terrain: Terrain): void {
    this.destroyWorld()
    this.axis = buildAxisCache(terrain)

    const sx = terrain.startX + SPAWN_DX
    const sy = terrain.groundY(sx) - SPAWN_DY

    this.buildTerrainBodies(terrain, sx)
    this.buildBike(sx, sy)
    this.buildCoins(terrain)
    this.buildFlag(terrain)

    this.ctx.state.bike = this.bikeView
    this.resetRunState(sx)
    this.built = true
    this.ctx.state.phase = 'playing'
  }

  private destroyWorld(): void {
    // remove terrain segments still in the world
    for (let i = this.loIdx; i < this.hiIdx; i++) this.matter.world.remove(this.segBodies[i])
    this.segBodies = []
    this.segXs = []
    this.loIdx = this.hiIdx = 0
    // remove bike bodies + constraints
    if (this.bikeBodies.length) this.matter.world.remove(this.bikeBodies)
    this.bikeBodies = []
    if (this.ragdoll) { this.matter.world.remove(this.ragdoll); this.ragdoll = null }
    // sprites
    for (const c of this.coinSprites) c.destroy()
    this.coinSprites = []
    if (this.flagSprite) { this.flagSprite.destroy(); this.flagSprite = null }
    this.bikeSprite.setVisible(false)
    this.riderSprite.setVisible(false)
    this.ragdollSprite.setVisible(false)
    this.wheelBackSprite.setVisible(false)
    this.wheelFrontSprite.setVisible(false)
    this.built = false
    this.contacts = 0
    this.grounded = false
    this.crashed = false
    this.headHit = false
  }

  private buildTerrainBodies(terrain: Terrain, startX: number): void {
    const pts = terrain.points
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const dx = p2.x - p1.x
      const dy = p2.y - p1.y
      const len = Math.hypot(dx, dy)
      if (len < 0.001) continue
      const angle = Math.atan2(dy, dx)
      const nx = -dy / len
      const ny = dx / len
      const cx = (p1.x + p2.x) * 0.5 + nx * (SEG_THICKNESS * 0.5)
      const cy = (p1.y + p2.y) * 0.5 + ny * (SEG_THICKNESS * 0.5)
      const seg = this.matter.bodies.rectangle(cx, cy, len + SEG_OVERLAP, SEG_THICKNESS, {
        isStatic: true, label: 'terrain', friction: 1, frictionStatic: 1, restitution: 0,
      })
      this.matter.body.setAngle(seg, angle)
      this.segBodies.push(seg)
      this.segXs.push((p1.x + p2.x) * 0.5)
    }
    this.loIdx = this.hiIdx = 0
    this.updateCollider(startX)
  }

  private updateCollider(bikeX: number): void {
    const xs = this.segXs
    const bodies = this.segBodies
    const n = bodies.length
    const lo = bikeX - COLLIDER_WINDOW
    const hi = bikeX + COLLIDER_WINDOW
    // Teleport (reset/retry far away): rebuild the window directly.
    if (this.hiIdx > this.loIdx && (xs[this.hiIdx - 1] < lo || xs[this.loIdx] > hi)) {
      for (let i = this.loIdx; i < this.hiIdx; i++) this.matter.world.remove(bodies[i])
      let a = 0, b = n
      while (a < b) {
        const mid = (a + b) >> 1
        if (xs[mid] < lo) a = mid + 1
        else b = mid
      }
      this.loIdx = this.hiIdx = a
    }
    while (this.hiIdx < n && xs[this.hiIdx] <= hi) this.matter.world.add(bodies[this.hiIdx++])
    while (this.hiIdx > this.loIdx && xs[this.hiIdx - 1] > hi) this.matter.world.remove(bodies[--this.hiIdx])
    while (this.loIdx < this.hiIdx && xs[this.loIdx] < lo) this.matter.world.remove(bodies[this.loIdx++])
    while (this.loIdx > 0 && xs[this.loIdx - 1] >= lo) this.matter.world.add(bodies[--this.loIdx])
  }

  private buildBike(x: number, y: number): void {
    const group = this.matter.world.nextGroup(true)
    const filter = { group, category: 0x0001, mask: 0xffffffff }

    this.chassis = this.matter.bodies.rectangle(x, y, CHASSIS_W, CHASSIS_H, {
      label: 'chassis', density: 0.0022, friction: 0.2, frictionAir: 0.012,
      restitution: 0.1, collisionFilter: filter,
    })
    const wheelOpts = {
      label: 'wheel', density: 0.0016, friction: 1.4, frictionStatic: 2.0,
      restitution: 0.15, frictionAir: 0, collisionFilter: filter,
    }
    this.wheelBack = this.matter.bodies.circle(x + BACK_DX, y + WHEEL_DY, WHEEL_R, wheelOpts)
    this.wheelFront = this.matter.bodies.circle(x + FRONT_DX, y + WHEEL_DY, WHEEL_R, wheelOpts)
    this.riderHead = this.matter.bodies.circle(x + HEAD_DX, y + HEAD_DY, HEAD_R, {
      label: 'head', density: 0.0008, friction: 0.4, restitution: 0.1, collisionFilter: filter,
    })

    const susp = (wheel: Body, ax: number) => this.matter.constraint.create({
      bodyA: this.chassis, pointA: { x: ax, y: 0 }, bodyB: wheel, pointB: { x: 0, y: 0 },
      stiffness: 0.62, damping: 0.2,
    })
    const head = (px: number) => this.matter.constraint.create({
      bodyA: this.chassis, pointA: { x: px, y: -8 }, bodyB: this.riderHead, pointB: { x: 0, y: 0 },
      stiffness: 0.9, damping: 0.1,
    })
    this.bikeBodies = [
      this.chassis, this.wheelBack, this.wheelFront, this.riderHead,
      susp(this.wheelBack, BACK_DX - 14), susp(this.wheelBack, BACK_DX + 14),
      susp(this.wheelFront, FRONT_DX - 14), susp(this.wheelFront, FRONT_DX + 14),
      head(HEAD_DX - 10), head(HEAD_DX + 10),
    ]
    this.matter.world.add(this.bikeBodies)

    this.bikeSprite.setVisible(true)
    this.riderSprite.setVisible(true)
    this.wheelBackSprite.setVisible(true)
    this.wheelFrontSprite.setVisible(true)
    this.ragdollSprite.setVisible(false)
    this.syncBikeState()
    this.syncSprites()
  }

  private buildCoins(terrain: Terrain): void {
    const scale = 20 / 24
    for (let i = 0; i < terrain.markers.length; i++) {
      const m = terrain.markers[i]
      const c = this.add.image(m.x, m.y - 40, 'coin').setScale(scale).setDepth(4)
      this.coinSprites.push(c)
    }
  }

  private buildFlag(terrain: Terrain): void {
    const gy = terrain.groundY(terrain.endX)
    this.flagSprite = this.add.image(terrain.endX, gy, 'flag').setOrigin(0.12, 0.98).setScale(120 / 67).setDepth(4)
  }

  private resetRunState(sx: number): void {
    const state = this.ctx.state
    this.startX = sx
    state.started = false
    state.distance = 0
    state.credits = 0
    state.flips = 0
    state.airTimeMs = 0
    state.trend = 0
    state.timeMs = 0
    state.nitro = 0
    state.nitroActive = false
    state.collected = new Uint8Array(state.terrain!.markers.length)
    state.newBest = false
    for (const c of this.coinSprites) c.setVisible(true)
    this.collectIdx = 0
    this.trendIdx = 0
    this.prevGrounded = true
    this.airMaxVy = 0
    this.flipAccum = 0
    this.pendingFlips = 0
    this.lastAngle = this.chassis.angle
    this.resultsShown = false
    this.outcomeAt = 0
    this.prevNitroActive = false
    this.nitroLatch = false
    this.ejectCamUntil = 0
    this.crashed = false
    this.headHit = false
    this.bikeView.ejected = false
    this.ragdollSprite.setVisible(false)
    this.riderSprite.setVisible(true)
    this.acc = 0
    const p = this.chassis.position
    state.camera.x = p.x
    state.camera.y = p.y - 40
    state.camera.zoom = 1
  }

  // Same-track restart: reset the existing bike/world (no rebuild).
  restartRun(): void {
    const state = this.ctx.state
    if (!state.terrain || !this.built) return
    this.ctx.hud.hideResults()
    if (this.ragdoll) { this.matter.world.remove(this.ragdoll); this.ragdoll = null }
    const sx = state.terrain.startX + SPAWN_DX
    const sy = state.terrain.groundY(sx) - SPAWN_DY
    this.bikeReset(sx, sy)
    this.resetRunState(sx)
    state.phase = 'playing'
  }

  private bikeReset(rx: number, ry: number): void {
    const B = this.matter.body
    const place = (b: Body, ox: number, oy: number) => {
      B.setPosition(b, { x: rx + ox, y: ry + oy })
      B.setVelocity(b, { x: 0, y: 0 })
      B.setAngularVelocity(b, 0)
      B.setAngle(b, 0)
    }
    place(this.chassis, 0, 0)
    place(this.wheelBack, BACK_DX, WHEEL_DY)
    place(this.wheelFront, FRONT_DX, WHEEL_DY)
    place(this.riderHead, HEAD_DX, HEAD_DY)
    this.contacts = 0
    this.grounded = false
    this.crashed = false
    this.headHit = false
    this._speed = 0
    this._rpm = 0
    this.riderSprite.setVisible(true)
    this.ragdollSprite.setVisible(false)
    this.updateCollider(rx)
  }

  // ---- bike control (ported tuning) -------------------------------------
  private throttle(dir: -1 | 0 | 1): void {
    const B = this.matter.body
    if (dir === 1) {
      B.setAngularVelocity(this.wheelBack, Math.min(this.wheelBack.angularVelocity + WHEEL_ACCEL, MAX_WHEEL_AV))
      if (this.grounded && this.chassis.angularVelocity > -MAX_WHEELIE_AV) {
        B.setAngularVelocity(this.chassis, this.chassis.angularVelocity - WHEELIE_TORQUE)
      }
    } else if (dir === -1) {
      B.setAngularVelocity(this.wheelBack, approach(this.wheelBack.angularVelocity, REVERSE_TARGET_AV, BRAKE_DECEL))
      B.setAngularVelocity(this.wheelFront, approach(this.wheelFront.angularVelocity, 0, BRAKE_DECEL))
    }
  }
  private lean(dir: -1 | 0 | 1): void {
    if (dir === 0) return
    const k = this.grounded ? GROUND_LEAN : AIR_LEAN
    this.matter.body.setAngularVelocity(this.chassis, this.chassis.angularVelocity + dir * k)
  }

  private down(code: string): boolean {
    return this.ctx.keys.has(code)
  }

  // ---- main loop ---------------------------------------------------------
  update(_time: number, delta: number): void {
    const state = this.ctx.state
    const simulating = state.phase === 'playing' || state.phase === 'crashed' || state.phase === 'finished'
    if (!simulating || !this.built) return
    const dt = Math.min(delta, 100)
    state.timeMs += dt
    this.acc += dt
    let steps = 0
    while (this.acc >= STEP && steps < MAX_STEPS) {
      this.physicsStep()
      this.acc -= STEP
      steps++
    }
    if (steps === MAX_STEPS && this.acc > STEP) this.acc = 0
    this.presentation(dt)
  }

  private physicsStep(): void {
    const state = this.ctx.state
    const chassis = this.chassis
    const bx = chassis.position.x

    this.updateTrend(bx)

    const playing = state.phase === 'playing'
    const airborne = !this.grounded

    if (playing) {
      const fwd = this.down('ArrowRight') || this.down('KeyD') || this.down('KeyW') || this.down('Space') || this.ctx.touch.throttle
      const brk = this.down('ArrowLeft') || this.down('KeyS') || this.ctx.touch.brake
      if (fwd) state.started = true
      this.throttle(fwd ? 1 : brk ? -1 : 0)

      const leanBack = this.down('ArrowUp') || (airborne && (this.down('KeyA') || this.down('ArrowLeft')))
      const leanFwd = this.down('ArrowDown') || (airborne && (this.down('KeyD') || this.down('ArrowRight')))
      this.lean(leanFwd ? 1 : leanBack ? -1 : 0)

      // Trend tailwind: a strong bull market pushes you forward.
      if (state.started && Math.abs(state.trend) > 0.3) {
        const f = state.trend * 0.0009 * chassis.mass
        this.matter.body.applyForce(chassis, chassis.position, { x: f, y: 0 })
      }

      this.updateNitro(chassis)
    } else {
      this.throttle(0)
      this.lean(0)
      state.nitroActive = false
      this.nitroLatch = false
    }

    const preVy = Math.max(this.wheelBack.velocity.y, this.wheelFront.velocity.y)

    this.updateCollider(bx)
    this.matter.world.step(STEP)
    this.syncBikeState()

    const grounded = this.grounded
    this.integrateFlips(!grounded, chassis.angle)

    if (!grounded) {
      if (this.prevGrounded) { this.airMaxVy = 0; this.flipAccum = 0; this.pendingFlips = 0 }
      state.airTimeMs += STEP
      this.curAirMs += STEP
      if (preVy > this.airMaxVy) this.airMaxVy = preVy
    } else {
      if (!this.prevGrounded) this.onLanding()
      this.curAirMs = 0
    }
    this.prevGrounded = grounded

    if (playing) {
      this.collectCredits(bx, chassis.position.y)
      const d = bx - this.startX
      if (d > state.distance) state.distance = d
      if (this.crashed) this.onCrash()
      else if (bx >= state.terrain!.endX) this.onFinish()
    }
  }

  // Hard landings can blow a wheel out of its suspension socket: the soft
  // constraints stretch/flip under extreme impact and never recover, so the
  // sprite's swingarm/silencer no longer lines up with the wheel and the
  // wedged wheel blocks the bike. Terminal fall speed + hard bump stops keep
  // the bike assembled no matter how hard it smashes down.
  private enforceBikeIntegrity(): void {
    const MAX_FALL = 26 // px/step terminal velocity
    const MAX_HORIZ = 40 // px/step terminal horizontal speed
    for (const b of [this.chassis, this.wheelBack, this.wheelFront]) {
      const vx = clamp(b.velocity.x, -MAX_HORIZ, MAX_HORIZ)
      const vy = Math.min(b.velocity.y, MAX_FALL)
      if (vx !== b.velocity.x || vy !== b.velocity.y) this.matter.body.setVelocity(b, { x: vx, y: vy })
    }
    const a = this.chassis.angle
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    const p = this.chassis.position
    // Generous travel so normal suspension work never triggers a correction
    // (hard 26px stops fired constantly on jagged terrain = visible jitter).
    // Within the soft band, ease back; only a true blow-out gets snapped.
    const MAX_TRAVEL = 20
    const SNAP = 55
    const fix = (wheel: Body, dx: number): void => {
      const sx = p.x + cos * dx - sin * WHEEL_DY
      const sy = p.y + sin * dx + cos * WHEEL_DY
      const ex = wheel.position.x - sx
      const ey = wheel.position.y - sy
      const d2 = ex * ex + ey * ey
      if (d2 <= MAX_TRAVEL * MAX_TRAVEL) return
      const d = Math.sqrt(d2)
      if (d > SNAP) {
        const k = MAX_TRAVEL / d
        this.matter.body.setPosition(wheel, { x: sx + ex * k, y: sy + ey * k })
        // damp toward chassis velocity instead of overwriting — a hard
        // velocity reset mid-motion injects constraint-fighting energy
        this.matter.body.setVelocity(wheel, {
          x: (wheel.velocity.x + this.chassis.velocity.x) * 0.5,
          y: (wheel.velocity.y + this.chassis.velocity.y) * 0.5,
        })
      } else {
        // Soft ease of the excess, position only. Runs during flips too — the
        // socket target rotates with the chassis so gentle easing follows the
        // spin instead of fighting it (crash tumbles previously scattered the
        // wheels because correction was disabled whenever the bike rotated).
        const k = 1 - 0.35 * (1 - MAX_TRAVEL / d)
        this.matter.body.setPosition(wheel, { x: sx + ex * k, y: sy + ey * k })
      }
    }
    fix(this.wheelBack, BACK_DX)
    fix(this.wheelFront, FRONT_DX)
  }

  private syncBikeState(): void {
    this.enforceBikeIntegrity()
    this.grounded = this.contacts > 0
    this._speed = this.chassis.speed * 60
    this._rpm = Math.min(Math.abs(this.wheelBack.angularVelocity) / MAX_WHEEL_AV, 1)
    if (this.headHit) {
      // Only a real wipeout kills: head contact while the bike is pitched past
      // ~52 deg. A nose-down landing that grazes the helmet is a scrape, not a
      // crash — instant deaths on ordinary jumps read as unfair.
      const a2p = this.chassis.angle % (Math.PI * 2)
      const norm = a2p > Math.PI ? a2p - Math.PI * 2 : a2p < -Math.PI ? a2p + Math.PI * 2 : a2p
      if (Math.abs(norm) > 0.9) {
        this.crashed = true
      } else {
        this.headHit = false
        this.addShake(2)
      }
    }
    // keep the read-only view (hud + debug handle) live
    const v = this.bikeView
    v.chassis.position.x = this.chassis.position.x
    v.chassis.position.y = this.chassis.position.y
    v.chassis.angle = this.chassis.angle
    ;(v as { speed: number }).speed = this._speed
    ;(v as { rpm: number }).rpm = this._rpm
    v.grounded = this.grounded
    v.crashed = this.crashed
  }

  private updateNitro(chassis: Body): void {
    const state = this.ctx.state
    const dtS = STEP / 1000
    const want = (this.down('ShiftLeft') || this.down('ShiftRight') || this.ctx.touch.nitro) && state.started
    // Hysteresis: needs NITRO_ARM to START, runs until the tank empties or the
    // key is released. Prevents a held Shift from re-firing every frame as the
    // trickle tops the meter back above zero (which would machine-gun the audio).
    if (this.nitroLatch) {
      if (!want || state.nitro <= 0) this.nitroLatch = false
    } else if (want && state.nitro >= NITRO_ARM) {
      this.nitroLatch = true
    }
    const active = this.nitroLatch && state.nitro > 0
    state.nitroActive = active
    if (active) {
      // Burning: drain only — no refuel while boosting (collectCredits / onLanding
      // gate their nitro gains on !nitroActive), so a burst ALWAYS depletes to
      // empty even while hoovering coins on a dense track. Sustained boost is
      // impossible by construction.
      state.nitro = clamp(state.nitro - NITRO_DRAIN * dtS, 0, 1)
      const a = chassis.angle
      const f = NITRO_FORCE * chassis.mass
      this.matter.body.applyForce(chassis, chassis.position, { x: Math.cos(a) * f, y: Math.sin(a) * f })
      this.addShake(1.4)
      if (!this.prevNitroActive && !this.ctx.isMuted()) this.ctx.audio.boost()
    } else {
      // Idle recharge (trickle) only when not boosting.
      state.nitro = clamp(state.nitro + NITRO_TRICKLE * dtS, 0, 1)
    }
    this.prevNitroActive = active
  }

  private updateTrend(bx: number): void {
    const markers = this.ctx.state.terrain!.markers
    if (markers.length === 0) return
    while (this.trendIdx < markers.length - 1 && markers[this.trendIdx + 1].x <= bx) this.trendIdx++
    let sum = 0, n = 0
    const lo = Math.max(0, this.trendIdx - 2)
    const hi = Math.min(markers.length - 1, this.trendIdx + 2)
    for (let j = lo; j <= hi; j++) { sum += markers[j].changePct; n++ }
    const avg = n > 0 ? sum / n : 0
    const target = clamp(avg / 3, -1, 1)
    this.ctx.state.trend += (target - this.ctx.state.trend) * 0.06
  }

  private collectCredits(bx: number, by: number): void {
    const state = this.ctx.state
    const markers = state.terrain!.markers
    const collected = state.collected!
    while (this.collectIdx < markers.length && markers[this.collectIdx].x < bx - 60) this.collectIdx++
    for (let j = this.collectIdx; j < markers.length && markers[j].x < bx + 60; j++) {
      if (collected[j]) continue
      const m = markers[j]
      // Check against the coin's DRAWN position (40px above the marker), not
      // the ground point — the chassis passes right at coin height, so this
      // is the difference between hoovering coins up and sailing past them.
      const dx = m.x - bx
      const dy = m.y - 40 - by
      if (dx * dx + dy * dy < 55 * 55) {
        collected[j] = 1
        state.credits += 1
        if (!state.nitroActive) state.nitro = clamp(state.nitro + NITRO_PER_COIN, 0, 1)
        this.coinSprites[j]?.setVisible(false)
        if (!this.ctx.isMuted()) this.ctx.audio.coin()
        this.ePickup.emitParticleAt(m.x, m.y - 40, 10)
      }
    }
  }

  private integrateFlips(airborne: boolean, angle: number): void {
    if (airborne) {
      let da = angle - this.lastAngle
      while (da > Math.PI) da -= TWO_PI
      while (da < -Math.PI) da += TWO_PI
      this.flipAccum += da
      while (Math.abs(this.flipAccum) >= TWO_PI) {
        this.pendingFlips++
        this.flipAccum -= Math.sign(this.flipAccum) * TWO_PI
      }
    }
    this.lastAngle = angle
  }

  private onLanding(): void {
    const state = this.ctx.state
    const impact = this.airMaxVy
    if (impact > 3) {
      const mag = clamp(impact / 18, 0, 1)
      if (!this.ctx.isMuted()) this.ctx.audio.thud(mag)
      this.eDust.emitParticleAt(this.wheelBack.position.x, this.wheelBack.position.y + 18, 3 + (mag * 5) | 0)
      this.addShake(impact * 0.35)
    }
    if (this.pendingFlips > 0 && state.phase === 'playing') {
      state.flips += this.pendingFlips
      state.credits += this.pendingFlips * 5
      if (!state.nitroActive) state.nitro = clamp(state.nitro + this.pendingFlips * NITRO_PER_FLIP, 0, 1)
      if (!this.ctx.isMuted()) { this.ctx.audio.ping(); this.ctx.audio.boost() }
      this.eBoost.emitParticleAt(this.chassis.position.x, this.chassis.position.y - 24, 8)
    }
    this.pendingFlips = 0
    this.flipAccum = 0
  }

  private onCrash(): void {
    const state = this.ctx.state
    state.phase = 'crashed'
    this.ejectRider()
    this.eCrash.emitParticleAt(this.chassis.position.x, this.chassis.position.y, 40)
    this.addShake(20)
    if (!this.ctx.isMuted()) this.ctx.audio.crash()
    this.ctx.saveBest()
    this.outcomeAt = state.timeMs
    this.ejectCamUntil = state.timeMs + 900
  }

  // New feature: break the rider off the bike as a free ragdoll body, flung
  // with the chassis velocity plus an upward-forward impulse and spin.
  private ejectRider(): void {
    const B = this.matter.body
    const chassis = this.chassis
    const a = chassis.angle
    const hp = this.riderHead.position
    // ragdoll spawns at the rider/head position
    const group = this.matter.world.nextGroup(true)
    const body = this.matter.bodies.rectangle(hp.x, hp.y + 6, 16, 34, {
      label: 'ragdoll', density: 0.0012, friction: 0.6, frictionAir: 0.02, restitution: 0.25,
      collisionFilter: { group, category: 0x0001, mask: 0xffffffff },
      chamfer: { radius: 7 },
    })
    B.setAngle(body, a)
    // chassis velocity + forward-up fling
    const cv = chassis.velocity
    const fling = 5.5
    B.setVelocity(body, {
      x: cv.x + Math.cos(a) * fling * 0.5 + 1.5,
      y: cv.y - fling,
    })
    B.setAngularVelocity(body, 0.35 + Math.random() * 0.25)
    this.matter.world.add(body)
    this.ragdoll = body

    this.riderSprite.setVisible(false)
    this.ragdollSprite.setVisible(true)
    this.bikeView.ejected = true
  }

  private onFinish(): void {
    const state = this.ctx.state
    state.phase = 'finished'
    const p = this.chassis.position
    for (let i = 0; i < 6; i++) this.eBoost.emitParticleAt(p.x, p.y - 30, 3)
    this.ePickup.emitParticleAt(p.x, p.y - 20, 10)
    if (!this.ctx.isMuted()) this.ctx.audio.finish()
    this.ctx.saveBest()
    this.outcomeAt = state.timeMs
  }

  // ---- presentation ------------------------------------------------------
  private presentation(dt: number): void {
    const state = this.ctx.state
    this.updateShake(dt)
    this.updateCamera()
    this.ambientFx()
    this.syncSprites()
    this.applyCamera()
    this.drawWorld()
    this.drawChrome()
    this.ctx.hud.update(state)
    this.ctx.audio.setEngine(this._rpm, this.throttleAudioOn())

    if ((state.phase === 'crashed' || state.phase === 'finished') && !this.resultsShown) {
      const wait = state.phase === 'crashed' ? 1200 : 700
      if (state.timeMs - this.outcomeAt >= wait) {
        this.resultsShown = true
        this.ctx.hud.showResults(state, () => this.restartRun())
      }
    }
  }

  private throttleAudioOn(): boolean {
    const state = this.ctx.state
    if (state.phase !== 'playing' || this.ctx.isMuted()) return false
    return this.down('ArrowRight') || this.down('KeyD') || this.down('KeyW') || this.down('Space') || this.ctx.touch.throttle
  }

  private updateCamera(): void {
    const state = this.ctx.state
    const p = this.chassis.position
    const spd = Math.abs(this._speed)
    const dir = Math.sign(this.chassis.velocity.x) || 1
    const look = dir * Math.min(spd * 0.22, 220)
    // Briefly follow the ragdoll right after a crash.
    let tx = p.x + look
    let ty = p.y - 40
    if (this.ragdoll && state.timeMs < this.ejectCamUntil) {
      tx = this.ragdoll.position.x
      ty = this.ragdoll.position.y - 20
    }
    // Scenario-driven zoom: idle = close-up, speed widens, big air widens more
    // (so the landing stays framed), nitro punches out, crash punches IN on
    // the ragdoll. Zoom-out reacts fast, zoom-in relaxes slowly.
    let targetZoom: number
    if (this.ragdoll && state.timeMs < this.ejectCamUntil) {
      targetZoom = 1.18 // crash drama close-up
    } else if (!state.started) {
      targetZoom = 1.1 // idle at the start line
    } else {
      targetZoom = 1.0 - (Math.min(spd, 1400) / 1400) * 0.18
      // Only sustained air widens the view — the grounded flag flickers over
      // jagged vertices and reacting to it makes the zoom pump.
      if (!this.grounded && this.curAirMs > 250 && state.terrain) {
        const h = state.terrain.groundY(p.x) - p.y
        if (h > 80) targetZoom -= Math.min((h - 80) / 900, 1) * 0.2
      }
      if (state.nitroActive) targetZoom -= 0.06 // FOV punch
    }
    state.camera.x += (tx - state.camera.x) * 0.08
    state.camera.y += (ty - state.camera.y) * 0.08
    const zoomRate = targetZoom < state.camera.zoom ? 0.09 : 0.028
    state.camera.zoom += (targetZoom - state.camera.zoom) * zoomRate
  }

  private applyCamera(): void {
    const cam = this.cameras.main
    const c = this.ctx.state.camera
    const zoom = c.zoom > 0 ? c.zoom : 1
    cam.setZoom(zoom)
    // Fold screen-space shake into the camera centre (world units).
    cam.centerOn(c.x + this.shx / zoom, c.y + this.shy / zoom)
  }

  private ambientFx(): void {
    const state = this.ctx.state
    this.fxTick++
    const spd = Math.abs(this._speed)
    if (this.grounded && spd > 200 && (this.fxTick & 1) === 0) {
      this.eDust.emitParticleAt(this.wheelBack.position.x, this.wheelBack.position.y + 18, 1)
    }
    if (state.trend > 0.3 && spd > 300 && (this.fxTick & 3) === 0) {
      this.eBoost.emitParticleAt(this.chassis.position.x, this.chassis.position.y - 10, 2)
    } else if (state.trend < -0.3 && (this.fxTick & 3) === 0) {
      this.eEmber.emitParticleAt(this.chassis.position.x, this.chassis.position.y - 10, 1)
    }
    // Nitro flame cone from the exhaust (rear-low of the chassis).
    if (state.nitroActive) {
      const a = this.chassis.angle
      const ex = this.chassis.position.x + Math.cos(a) * -34 + Math.sin(a) * 6
      const ey = this.chassis.position.y + Math.sin(a) * -34 - Math.cos(a) * 6
      this.eNitroCore.emitParticleAt(ex, ey, 3)
      this.eNitroFringe.emitParticleAt(ex, ey, 2)
    }
  }

  private syncSprites(): void {
    this.wheelBackSprite.setPosition(this.wheelBack.position.x, this.wheelBack.position.y).setRotation(this.wheelBack.angle)
    this.wheelFrontSprite.setPosition(this.wheelFront.position.x, this.wheelFront.position.y).setRotation(this.wheelFront.angle)
    const a = this.chassis.angle
    this.bikeSprite.setPosition(this.chassis.position.x, this.chassis.position.y).setRotation(a)
    if (this.bikeView.ejected && this.ragdoll) {
      this.ragdollSprite.setPosition(this.ragdoll.position.x, this.ragdoll.position.y).setRotation(this.ragdoll.angle)
    } else {
      // Rider rigidly mounted on the seat. The offset is the seat pixel
      // (~208,74) in bike-solo.png mapped through the same scale/origin as the
      // bike sprite, so his hips sit on the seat regardless of bike rescaling:
      //   localX = (208 - 252)*BIKE_SCALE, localY = (74 - originY*267)*BIKE_SCALE
      // Rotated by the full chassis angle (and the sprite rotates by the full
      // angle too) so he pivots about the chassis centre, not his own origin.
      // Seat anchor (204,92)+6px: settles the crouched rider INTO the bike so
      // he never reads as hovering, verified by offline composite at 0/-0.6rad.
      const ox = (51 - 63) * BIKE_SCALE
      const oy = (23 - BIKE_ORIGIN_Y * BIKE_SPRITE_H) * BIKE_SCALE + 6
      const rx = this.chassis.position.x + Math.cos(a) * ox - Math.sin(a) * oy
      const ry = this.chassis.position.y + Math.sin(a) * ox + Math.cos(a) * oy
      this.riderSprite.setPosition(rx, ry).setRotation(a)
    }
    // coin bob (visible ones near the camera)
    const wv = this.cameras.main.worldView
    const bob = Math.sin(this.ctx.state.timeMs * 0.005) * 4
    const coins = this.coinSprites
    const markers = this.ctx.state.terrain!.markers
    for (let i = 0; i < coins.length; i++) {
      const c = coins[i]
      if (!c.visible) continue
      if (markers[i].x < wv.x - 40 || markers[i].x > wv.right + 40) continue
      c.y = markers[i].y - 40 + bob
    }
  }

  // ---- shake (ported from effects.ts) -----------------------------------
  private addShake(mag: number): void {
    if (mag > this.shakeMag) this.shakeMag = mag
  }
  private updateShake(dt: number): void {
    this.shakeMag -= this.shakeMag * 0.009 * dt
    if (this.shakeMag < 0.05) this.shakeMag = 0
    this.shx = (Math.random() * 2 - 1) * this.shakeMag
    this.shy = (Math.random() * 2 - 1) * this.shakeMag
  }

  // ---- world-space chart: grid + terrain line (redrawn each frame) -------
  private drawWorld(): void {
    const t = this.ctx.state.terrain
    if (!t) return
    const g = this.worldGfx
    g.clear()
    const cam = this.cameras.main
    const wv = cam.worldView
    const zoom = cam.zoom
    const left = wv.x - 80 / zoom
    const right = wv.right + 80 / zoom
    const top = wv.y
    const bottom = wv.bottom

    // vertical day-boundary grid lines (thinned by screen spacing)
    const mk = t.markers
    g.lineStyle(1 / zoom, CN.grid, 1)
    let lastVX = -1e9
    for (let i = 0; i < mk.length; i++) {
      const m = mk[i]
      if (!m.dayBoundary) continue
      if (m.x < left) continue
      if (m.x > right) break
      if ((m.x - lastVX) * zoom < 46) continue
      lastVX = m.x
      g.lineBetween(m.x, top, m.x, bottom)
    }

    // (horizontal price-level lines are chrome now — drawn zoom-independent
    // in drawChrome so the right-axis numbers never move with dynamic zoom)

    // terrain: faint depth fill + crisp white jagged line
    const pts = t.points
    const i0 = pointIndex(pts, left)
    const i1 = Math.min(pointIndex(pts, right) + 1, pts.length - 1)
    const bottomY = t.maxY + 4000
    g.fillStyle(CN.depth, 1)
    g.beginPath()
    g.moveTo(pts[i0].x, pts[i0].y)
    for (let i = i0 + 1; i <= i1; i++) g.lineTo(pts[i].x, pts[i].y)
    g.lineTo(pts[i1].x, bottomY)
    g.lineTo(pts[i0].x, bottomY)
    g.closePath()
    g.fillPath()

    g.lineStyle(1.8 / zoom, CN.chart, 1)
    g.beginPath()
    g.moveTo(pts[i0].x, pts[i0].y)
    for (let i = i0 + 1; i <= i1; i++) g.lineTo(pts[i].x, pts[i].y)
    g.strokePath()
  }

  // ---- screen-space chrome: axis labels, chip, tooltip, dates, speed -----
  private drawChrome(): void {
    const state = this.ctx.state
    const t = state.terrain
    if (!t) return
    const cam = this.cameras.main
    const wv = cam.worldView
    const zoom = cam.zoom
    const w = this.scale.width
    const h = this.scale.height
    const sx = (wx: number): number => (wx - wv.x) * zoom
    const sy = (wy: number): number => (wy - wv.y) * zoom
    // The main camera applies its dynamic zoom (speed/air/nitro/crash) to every
    // object it renders — even setScrollFactor(0) chrome — as
    //   screen = cOut + zoom * (pos - cIn)
    // where cIn is the screen centre and cOut is that centre with Phaser's
    // integer-floored output origin. That scaled the axis font and drifted the
    // right-edge label column sideways as zoom changed. We cancel it: render the
    // whole chrome layer in identity screen space by counter-scaling 1/zoom
    // about the centre, so labels keep a fixed screen X, fixed font size, and no
    // horizontal drift, while their Y still tracks each price level on the
    // (zooming) chart via sy(). placeUI positions a text so its anchor lands at
    // the given true screen (X, Y); g is transformed so its draws use raw screen
    // coordinates too.
    const inv = 1 / zoom
    const cInX = w / 2, cInY = h / 2
    const cOutX = Math.round(w / 2), cOutY = Math.round(h / 2)
    const placeUI = (txt: Phaser.GameObjects.Text, X: number, Y: number): void => {
      txt.setScale(inv).setPosition(cInX + (X - cOutX) * inv, cInY + (Y - cOutY) * inv)
    }

    const g = this.chromeGfx
    g.setScale(inv).setPosition(cInX - cOutX * inv, cInY - cOutY * inv)
    g.clear()

    // horizontal price-level grid lines + right-edge labels. Each line's screen
    // Y tracks its price level on the (zooming) chart via sy(); placeUI pins the
    // label to a fixed screen X and fixed font size in the identity chrome layer.
    let ai = 0
    if (this.axis) {
      for (let i = 0; i < this.axis.levelY.length; i++) {
        const py = sy(this.axis.levelY[i])
        if (py < 60 || py > h - 30) continue
        g.lineStyle(1, CN.grid, 1)
        g.lineBetween(0, py, w - 64, py)
        const txt = this.axisTexts[ai++]
        if (!txt) break
        txt.setVisible(true).setText(fmtAxis(this.axis.levelV[i]))
        placeUI(txt, w - 10, py)
      }
    }
    for (let i = ai; i < this.axisTexts.length; i++) this.axisTexts[i].setVisible(false)

    // bottom date labels at day boundaries (thinned)
    let di = 0
    const mk = t.markers
    const left = wv.x - 80 / zoom
    const right = wv.right + 80 / zoom
    let lastLX = -1e9
    for (let i = 0; i < mk.length; i++) {
      const m = mk[i]
      if (!m.dayBoundary) continue
      if (m.x < left) continue
      if (m.x > right) break
      const px = sx(m.x)
      if (px - lastLX < 70 || px < 20 || px > w - 70) continue
      lastLX = px
      const txt = this.dateTexts[di++]
      if (!txt) break
      txt.setVisible(true).setText(DAY_FMT.format(m.t))
      placeUI(txt, px, h - 10)
    }
    for (let i = di; i < this.dateTexts.length; i++) this.dateTexts[i].setVisible(false)

    const bikeX = this.built ? this.chassis.position.x : state.camera.x

    // current-price chip + dotted level line at the bike price
    const wy = t.groundY(bikeX)
    const chipY = sy(wy) // glued to the bike's price level on the chart
    if (chipY > 40 && chipY < h - 20) {
      const price = priceAtX(t.markers, bikeX)
      // dotted horizontal line
      g.lineStyle(1, 0xf5f5f5, 0.35)
      this.dottedLine(g, 0, chipY, w - 58, chipY, 2, 4)
      // white chip
      const label = fmtAxis(price)
      this.chipText.setText(label).setVisible(true)
      const cw = this.chipText.width + 12
      const cx = w - cw - 6
      g.fillStyle(0xffffff, 1)
      g.fillRect(cx, chipY - 8, cw, 16) // pixel theme: square chip
      placeUI(this.chipText, cx + cw / 2, chipY)
    } else {
      this.chipText.setVisible(false)
    }

    // live price + timestamp under the bike → shown in the DOM header (no
    // floating tooltip card; the header carries this now).
    if (this.built) {
      const bx = this.chassis.position.x
      const state = this.ctx.state
      state.livePrice = priceAtX(t.markers, bx)
      const m = markerAtX(t.markers, bx)
      state.liveTimeMs = m ? m.t : 0
      // white marker dot on the line at the bike x
      const dotY = sy(t.groundY(bx))
      g.fillStyle(0xf5f5f5, 1)
      g.fillCircle(sx(bx), dotY, 4)
      g.lineStyle(1.5, CN.bg0, 1)
      g.strokeCircle(sx(bx), dotY, 4)
    }

    // speed lines
    this.drawSpeedLines(g, w, h)
  }

  private dottedLine(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number, dash: number, gap: number): void {
    const dx = x2 - x1, dy = y2 - y1
    const len = Math.hypot(dx, dy)
    const ux = dx / len, uy = dy / len
    let d = 0
    g.beginPath()
    while (d < len) {
      const e = Math.min(d + dash, len)
      g.moveTo(x1 + ux * d, y1 + uy * d)
      g.lineTo(x1 + ux * e, y1 + uy * e)
      d += dash + gap
    }
    g.strokePath()
  }

  private drawSpeedLines(g: Phaser.GameObjects.Graphics, w: number, h: number): void {
    const speed = this._speed
    const s = (speed - 520) / 90
    if (s <= 0) return
    const n = s > 9 ? 9 : s | 0
    const len = 40 + s * 22
    const timeMs = this.ctx.state.timeMs
    g.lineStyle(2, 0xe6ece6, 0.16)
    g.beginPath()
    for (let k = 0; k < n; k++) {
      const tY = (k * 137 + timeMs * 0.9) % (h + 200) - 100
      const yl = (k * 71 + timeMs * 0.6) % h
      g.moveTo(w - 6, tY)
      g.lineTo(w - 6 - len, tY)
      g.moveTo(6, yl)
      g.lineTo(6 + len, yl)
    }
    g.strokePath()
  }
}
