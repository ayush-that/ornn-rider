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
import { CN, DPR } from './types'
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
const MAX_WHEEL_AV = 1.3
const WHEEL_ACCEL = 0.12
const BRAKE_DECEL = 0.09
const REVERSE_TARGET_AV = -0.28
const WHEELIE_TORQUE = 0.018 // raised for the wider 112 wheelbase (was 0.007 at 64)
const MAX_WHEELIE_AV = 0.11
// Arcade lean: one constant authority at every angle, grounded or not, so the
// bike can always be righted from a nose-stand (user call: no realistic physics).
// Three decoupled lean strengths (the user only wanted FLIPS faster):
// FLIP_LEAN — deliberate flip keys (Up/Down) in the air + nose-stand recovery.
// AIR_LEAN — throttle/brake doubling as subtle air correction (original feel,
//            so holding gas off a cliff doesn't pitch/"boost" you forward).
// GROUND_LEAN — weight-shift while riding; small, keeps the bike feeling heavy.
const FLIP_LEAN = 0.05
const AIR_LEAN = 0.022
const GROUND_LEAN = 0.006
// Past this tilt (|angle| from upright, rad) left/right double as lean even on
// the ground — driving inputs are useless in that orientation anyway.
const TIPPED_ANGLE = 1.75

// --- Terrain body tuning ---------------------------------------------------
const SEG_THICKNESS = 50
const SEG_OVERLAP = 8
const COLLIDER_WINDOW = 2000

// Left-edge containment: an invisible static wall whose right face sits at the
// terrain start so reversing off the lead-in is impossible. Kill-plane below
// the lowest terrain point catches any other freefall escape (physics glitch).
const WALL_THICKNESS = 400
const KILL_DROP = 600

// --- Loop / spawn ----------------------------------------------------------
const STEP = 1000 / 60
const MAX_STEPS = 4
const TWO_PI = Math.PI * 2
const SPAWN_DX = 90
const SPAWN_DY = 60

// --- Nitro tuning ----------------------------------------------------------
// Scarce by design: a full tank lasts ~1.8s and refills slowly, so sustained
// boost is impossible even while hoovering up coins at speed.
const NITRO_DRAIN = 0.4 // per second while active (~2.5s full tank)
const NITRO_TRICKLE = 0.05 // per second, always
const NITRO_PER_COIN = 0.08
const NITRO_PER_FLIP = 0.35
const NITRO_ARM = 0.10 // min charge to (re)start a boost — hysteresis vs empty-tank stutter
const NITRO_FORCE = 0.0029 // ~3x the peak trend-wind force per step

// --- Tricks & streak scoring -----------------------------------------------
// Every trick is a micro-interaction: a floating popup + a bit of camera juice.
// Chaining tricks within STREAK_WINDOW_MS builds a multiplier (×1..×5) applied
// to all TRICK points (never to pickup coins). A crash — or a quiet lapse past
// the window — drops the streak back to ×1.
const STREAK_WINDOW_MS = 7000
const STREAK_MAX = 5
// Air-time tiers (awarded on a clean landing only when NO flip happened that
// air): highest reached tier fires, not all three.
const AIR_NOHANDER_MS = 1200, AIR_NOHANDER_PTS = 10
const AIR_SUPERMAN_MS = 2000, AIR_SUPERMAN_PTS = 20
const AIR_SAILOR_MS = 3000, AIR_SAILOR_PTS = 40
// Ground tricks (per-wheel contact asymmetry). Held tricks re-award each block.
// GRACE: jagged terrain flickers the front/back wheel in and out of contact, so
// the pose timer tolerates brief breaks (a bump, a hop) before it resets — as
// long as the bike is still on the driving wheel, the wheelie/stoppie holds.
const WHEELIE_MS = 900, WHEELIE_PTS = 15, WHEELIE_MIN_SPEED = 120
const STOPPIE_MS = 700, STOPPIE_PTS = 20, STOPPIE_MIN_SPEED = 120
const GROUND_TRICK_GRACE = 350
// Speed demon reads a SMOOTHED speed (the raw px/s spikes wildly frame-to-frame
// over jagged chart terrain, so a raw threshold never sustains). Hysteresis:
// accumulate above HI, only reset below LO, hold in between — so a single bump
// dip doesn't wipe a near-complete run.
const SPEED_DEMON_MS = 3000, SPEED_DEMON_PTS = 25
const SPEED_DEMON_HI = 700, SPEED_DEMON_LO = 490
const SPEED_SMOOTH = 0.12 // EMA weight per physics step
const FLIP_PTS = 25
// Named one-shot combos (amber popup, big scale, strong shake). Flat bonuses,
// not streak-multiplied (they are already large lump sums).
const ASTRONAUT_PTS = 100 // 2+ flips in one air
const MADMAN_PTS = 250 // 3+ flips in one air (replaces Astronaut that air)
const SHOWOFF_PTS = 150 // 3 different trick TYPES within one streak
// Trick-type bits, tracked per streak for SHOWOFF.
const TT_FLIP = 1, TT_WHEELIE = 2, TT_STOPPIE = 4, TT_AIR = 8, TT_SPEED = 16

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
  touch: { throttle: boolean; brake: boolean; nitro: boolean; leanFwd: boolean }
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

const MONO = '"Space Mono", ui-monospace, monospace'
const SANS = '"Space Mono", ui-monospace, monospace'

export class OrnnScene extends Phaser.Scene {
  private ctx!: GameCtx

  // graphics / text layers
  private worldGfx!: Phaser.GameObjects.Graphics
  private starGfx!: Phaser.GameObjects.Graphics
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
  private coinSprites: (Phaser.GameObjects.Image | null)[] = []
  // Per-marker pickup: 0 = none, >0 = points value, -1 = nitro canister.
  private pickupValue = new Int16Array(0)
  // floating "+20 / FRONTFLIP" popup pool
  private popTexts: Phaser.GameObjects.Text[] = []
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

  // left-edge containment wall (always in the world, not windowed) + kill-plane
  private leftWall: Body | null = null
  private rightWall: Body | null = null
  private killY = Infinity
  private killed = false

  // bike readonly-facing state
  private contacts = 0
  // per-wheel contact counts (ground-trick detection needs the asymmetry;
  // `contacts` is aggregate and can't tell a wheelie from a stoppie)
  private backContacts = 0
  private frontContacts = 0
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
  private lastFlipDir = 1
  private parked = false
  private invertedMs = 0
  private lastAngle = 0
  private resultsShown = false
  private outcomeAt = 0
  private fxTick = 0
  private prevNitroActive = false
  private nitroLatch = false
  private ejectCamUntil = 0

  // tricks & streak (reset on every respawn / crash via clearRunFlags)
  private streak = 1
  private lastTrickMs = -1e9
  private streakTypes = 0 // bitmask of TT_* seen in the current streak
  private showoffDone = false // SHOWOFF fires once per streak
  private wheelieMs = 0 // continuous held-trick timers
  private wheelieGrace = 0
  private stoppieMs = 0
  private stoppieGrace = 0
  private speedDemonMs = 0
  private smoothSpeed = 0 // EMA of |speed| for stable speed-demon detection

  // fixed-timestep accumulator
  private acc = 0

  // Pose at the previous physics step, for render interpolation. On
  // high-refresh displays the camera pans every rendered frame while physics
  // steps at 60Hz; without interpolation the bike stair-steps relative to the
  // scrolling world and reads as a doubled image at speed.
  private prevPose = {
    cx: 0, cy: 0, ca: 0, // chassis
    bx: 0, by: 0, ba: 0, // back wheel
    fx: 0, fy: 0, fa: 0, // front wheel
    rx: 0, ry: 0, ra: 0, // ragdoll
  }


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

  // Bake `key` upscaled by the nearest integer to worldScale×DPR (nearest-
  // neighbour, so pixels stay hard), returning the baked key plus the sprite
  // scale that keeps world-space size identical. LINEAR filtering then only
  // covers the fractional remainder, softening edges by <1 physical px.
  private crisp(key: string, worldScale: number): { key: string; scale: number } {
    const k = Math.max(1, Math.round(worldScale * DPR))
    const baked = `${key}-x${k}`
    if (!this.textures.exists(baked)) {
      const src = this.textures.get(key).getSourceImage() as HTMLImageElement
      const cv = document.createElement('canvas')
      cv.width = src.width * k
      cv.height = src.height * k
      const c2 = cv.getContext('2d')!
      c2.imageSmoothingEnabled = false
      c2.drawImage(src, 0, 0, cv.width, cv.height)
      this.textures.addCanvas(baked, cv)
      this.textures.get(baked).setFilter(Phaser.Textures.FilterMode.LINEAR)
    }
    return { key: baked, scale: worldScale / k }
  }

  create(): void {
    // The bike/rider sprites live at a non-integer physical scale (world
    // ~1.1-1.5 × DPR), so plain NEAREST makes pixels crawl in motion and plain
    // LINEAR smears the whole sprite (the "driving blur"). Instead: bake each
    // texture once at the nearest integer upscale with nearest-neighbour, then
    // LINEAR only bridges the small fractional remainder (~1.1×) — crisp
    // pixels, stable edges. Coins/flag stay NEAREST (they sit still).
    const bike = this.crisp('bike', BIKE_SCALE)
    const rider = this.crisp('rider', 103 / 88)
    const ragdoll = this.crisp('ragdoll', 100 / 66)
    const wheel = this.crisp('wheel', 44 / 32)

    this.cameras.main.setBackgroundColor(CN.bg0)

    this.makeParticleTextures()

    // Layers (world space is transformed by the camera; chrome is pinned).
    this.starGfx = this.add.graphics().setScrollFactor(0).setDepth(-1)
    this.worldGfx = this.add.graphics().setDepth(0)

    // Bike sprites — created hidden, positioned once the world is built.
    this.wheelBackSprite = this.add.image(0, 0, wheel.key).setDepth(5).setScale(wheel.scale).setVisible(false)
    this.wheelFrontSprite = this.add.image(0, 0, wheel.key).setDepth(5).setScale(wheel.scale).setVisible(false)
    this.bikeSprite = this.add.image(0, 0, bike.key).setDepth(6).setOrigin(BIKE_ORIGIN_X, BIKE_ORIGIN_Y).setScale(bike.scale).setVisible(false)
    // Rider sits on the bike: origin at his hips, scaled so his torso doesn't
    // tower over the handlebars. Seat offset is derived in syncSprites().
    this.riderSprite = this.add.image(0, 0, rider.key).setDepth(7).setOrigin(0.5, 0.66).setScale(rider.scale).setVisible(false)
    this.ragdollSprite = this.add.image(0, 0, ragdoll.key).setDepth(7).setOrigin(0.5, 0.5).setScale(ragdoll.scale).setVisible(false)

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
        const ba = pairs[i].bodyA as unknown as Body
        const bb = pairs[i].bodyB as unknown as Body
        const a = ba.label, b = bb.label
        if (a !== 'terrain' && b !== 'terrain') continue
        if (a === 'wheel' || b === 'wheel') {
          this.contacts++
          const wheel = a === 'wheel' ? ba : bb
          if (wheel === this.wheelBack) this.backContacts++
          else if (wheel === this.wheelFront) this.frontContacts++
        }
        if (a === 'head' || b === 'head') this.headHit = true
      }
    })
    this.matter.world.on('collisionend', (e: { pairs: MatterJS.IPair[] }) => {
      const pairs = e.pairs
      for (let i = 0; i < pairs.length; i++) {
        const ba = pairs[i].bodyA as unknown as Body
        const bb = pairs[i].bodyB as unknown as Body
        const a = ba.label, b = bb.label
        if (a !== 'terrain' && b !== 'terrain') continue
        if (a === 'wheel' || b === 'wheel') {
          this.contacts = Math.max(0, this.contacts - 1)
          const wheel = a === 'wheel' ? ba : bb
          if (wheel === this.wheelBack) this.backContacts = Math.max(0, this.backContacts - 1)
          else if (wheel === this.wheelFront) this.frontContacts = Math.max(0, this.frontContacts - 1)
        }
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
    this.buildLeftWall(terrain)
    this.buildBike(sx, sy)
    this.buildCoins(terrain)
    this.buildFlag(terrain)

    this.ctx.state.bike = this.bikeView
    this.resetRunState(sx)
    this.snapPose()
    this.built = true
    this.ctx.state.phase = 'playing'
  }

  private destroyWorld(): void {
    // remove terrain segments still in the world
    for (let i = this.loIdx; i < this.hiIdx; i++) this.matter.world.remove(this.segBodies[i])
    this.segBodies = []
    this.segXs = []
    this.loIdx = this.hiIdx = 0
    if (this.leftWall) { this.matter.world.remove(this.leftWall); this.leftWall = null }
    if (this.rightWall) { this.matter.world.remove(this.rightWall); this.rightWall = null }
    this.killY = Infinity
    this.killed = false
    // remove bike bodies + constraints
    if (this.bikeBodies.length) this.matter.world.remove(this.bikeBodies)
    this.bikeBodies = []
    if (this.ragdoll) { this.matter.world.remove(this.ragdoll); this.ragdoll = null }
    // sprites
    for (const c of this.coinSprites) c?.destroy()
    this.coinSprites = []
    for (const t of this.popTexts) t.setVisible(false)
    if (this.flagSprite) { this.flagSprite.destroy(); this.flagSprite = null }
    this.bikeSprite.setVisible(false)
    this.riderSprite.setVisible(false)
    this.ragdollSprite.setVisible(false)
    this.wheelBackSprite.setVisible(false)
    this.wheelFrontSprite.setVisible(false)
    this.built = false
    this.contacts = 0
    this.backContacts = 0
    this.frontContacts = 0
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

  // Invisible static wall pinned just left of the terrain start. It lives in the
  // world for the whole run (not part of the sliding segment window), so the
  // bike can never reverse past the lead-in into open space. Given a distinct
  // 'wall' label so it doesn't register as grounded/head contact.
  private buildLeftWall(terrain: Terrain): void {
    const cy = (terrain.minY + terrain.maxY) * 0.5
    const height = (terrain.maxY - terrain.minY) + 4000 // tall enough to never clear
    const wall = (cx: number): Body =>
      this.matter.bodies.rectangle(cx, cy, WALL_THICKNESS, height, {
        isStatic: true, label: 'wall', friction: 0, frictionStatic: 0, restitution: 0,
      })
    // Both edges: reversing off the lead-in or riding past the lead-out would
    // otherwise be an endless fall (the finish flag sits before the terrain end).
    this.leftWall = wall(terrain.startX - WALL_THICKNESS * 0.5)
    this.rightWall = wall(terrain.points[terrain.points.length - 1].x + WALL_THICKNESS * 0.5)
    this.matter.world.add([this.leftWall, this.rightWall])
    // Kill-plane: any freefall this far below the lowest terrain point is a crash.
    this.killY = terrain.maxY + KILL_DROP
    this.killed = false
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

  // Deterministic pickup layout: seeded from the terrain itself, so every
  // rider sees the identical distribution on a given track — random, but fair
  // for the leaderboard. Mix of point values plus rare nitro canisters.
  private buildCoins(terrain: Terrain): void {
    const markers = terrain.markers
    let seed = (markers.length * 2654435761) ^ Math.round(terrain.endX)
    const rand = (): number => {
      // mulberry32
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    this.pickupValue = new Int16Array(markers.length)
    for (let i = 0; i < markers.length; i++) {
      const r = rand()
      let value = 0
      if (r >= 0.95) value = -1 // nitro canister (~5% of markers)
      else if (r >= 0.9) value = 50
      else if (r >= 0.78) value = 20
      else if (r >= 0.52) value = 5
      this.pickupValue[i] = value
      if (value === 0) {
        this.coinSprites.push(null)
        continue
      }
      const m = markers[i]
      const c = this.add.image(m.x, m.y - 40, 'coin').setDepth(4)
      // Uniform size for every pickup; tint alone tells them apart.
      c.setScale(1.15)
      if (value === -1) c.setTint(0x5ad1ff) // nitro: cyan canister
      else if (value === 50) c.setTint(0xffd766)
      this.coinSprites.push(c)
    }
  }

  private buildFlag(terrain: Terrain): void {
    const gy = terrain.groundY(terrain.endX)
    this.flagSprite = this.add.image(terrain.endX, gy, 'flag').setOrigin(0.12, 0.98).setScale(120 / 67).setDepth(4)
  }

  // Transient per-life state: cleared on every (re)spawn, full reset or resume.
  private clearRunFlags(): void {
    const state = this.ctx.state
    state.nitroActive = false
    state.newBest = false
    state.trend = 0
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
    this.killed = false
    this.headHit = false
    // reset the trick/streak machine: a crash (or fresh spawn) drops it to ×1
    this.streak = 1
    this.lastTrickMs = -1e9
    this.streakTypes = 0
    this.showoffDone = false
    this.wheelieMs = 0
    this.wheelieGrace = 0
    this.stoppieMs = 0
    this.stoppieGrace = 0
    this.speedDemonMs = 0
    this.smoothSpeed = 0
    this.bikeView.ejected = false
    this.ragdollSprite.setVisible(false)
    this.riderSprite.setVisible(true)
    this.acc = 0
    const p = this.chassis.position
    state.camera.x = p.x
    state.camera.y = p.y - 40
    state.camera.zoom = 1
  }

  private resetRunState(sx: number): void {
    const state = this.ctx.state
    this.startX = sx
    state.started = false
    state.distance = 0
    state.points = 0
    state.flips = 0
    state.airTimeMs = 0
    state.timeMs = 0
    state.nitro = 0
    state.collected = new Uint8Array(state.terrain!.markers.length)
    for (const c of this.coinSprites) c?.setVisible(true)
    this.collectIdx = 0
    this.trendIdx = 0
    this.clearRunFlags()
  }

  // Same-track restart. A crash resumes from where you died — the maps are
  // full-history long now — keeping distance/coins/flips/collected markers.
  // Finishing (or a menu retry) starts a fresh run from the beginning.
  restartRun(): void {
    const state = this.ctx.state
    if (!state.terrain || !this.built) return
    this.ctx.hud.hideResults()
    if (this.ragdoll) { this.matter.world.remove(this.ragdoll); this.ragdoll = null }
    const t = state.terrain
    const resume = state.phase === 'crashed'
    const sx = resume
      ? clamp(this.chassis.position.x, t.startX + SPAWN_DX, t.endX - 200)
      : t.startX + SPAWN_DX
    // Resume drops the bike in from a little above the ground for a soft re-entry.
    const sy = t.groundY(sx) - (resume ? SPAWN_DY + 70 : SPAWN_DY)
    this.bikeReset(sx, sy)
    if (resume) this.clearRunFlags()
    else this.resetRunState(sx)
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
    this.backContacts = 0
    this.frontContacts = 0
    this.grounded = false
    this.crashed = false
    this.headHit = false
    this._speed = 0
    this._rpm = 0
    this.riderSprite.setVisible(true)
    this.ragdollSprite.setVisible(false)
    this.updateCollider(rx)
    this.snapPose() // teleport: don't interpolate across the jump
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
  private lean(dir: -1 | 0 | 1, k: number): void {
    if (dir === 0 || k === 0) return
    this.matter.body.setAngularVelocity(this.chassis, this.chassis.angularVelocity + dir * k)
  }

  // |chassis angle from upright| normalized to [0, π] — flips accumulate 2π's.
  private tilt(): number {
    let a = this.chassis.angle % TWO_PI
    if (a > Math.PI) a -= TWO_PI
    if (a < -Math.PI) a += TWO_PI
    return Math.abs(a)
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

  private snapPose(): void {
    const P = this.prevPose
    P.cx = this.chassis.position.x; P.cy = this.chassis.position.y; P.ca = this.chassis.angle
    P.bx = this.wheelBack.position.x; P.by = this.wheelBack.position.y; P.ba = this.wheelBack.angle
    P.fx = this.wheelFront.position.x; P.fy = this.wheelFront.position.y; P.fa = this.wheelFront.angle
    if (this.ragdoll) { P.rx = this.ragdoll.position.x; P.ry = this.ragdoll.position.y; P.ra = this.ragdoll.angle }
  }

  private physicsStep(): void {
    this.snapPose()
    const state = this.ctx.state
    const chassis = this.chassis
    const bx = chassis.position.x

    this.updateTrend(bx)

    const playing = state.phase === 'playing'
    const airborne = !this.grounded

    if (playing) {
      // Control scheme: W/↑/Space/right-half = gas · A/←/left-half = wheelie
      // (lean back) · D/→ = nose dive (lean forward) · S/↓ = nothing.
      const fwd = this.down('KeyW') || this.down('ArrowUp') || this.down('Space') || this.ctx.touch.throttle
      const leanBack = this.down('KeyA') || this.down('ArrowLeft') || this.ctx.touch.brake
      const leanFwd = this.down('KeyD') || this.down('ArrowRight') || this.ctx.touch.leanFwd
      if (fwd) state.started = true
      this.throttle(fwd ? 1 : 0)

      // Static friction: the suspension springs micro-jitter the bodies a few
      // px/s forever, so an untouched bike never reads 0 km/h. With no drive
      // input, grounded and nearly still, park it. Slopes still roll — gravity
      // pushes past the threshold within a step or two.
      this.parked = !fwd && this.grounded && this.chassis.speed < 0.6
      if (this.parked) {
        const B = this.matter.body
        for (const b of [this.chassis, this.wheelBack, this.wheelFront, this.riderHead]) {
          B.setVelocity(b, { x: 0, y: 0 })
        }
        B.setAngularVelocity(this.wheelBack, 0)
        B.setAngularVelocity(this.wheelFront, 0)
      }

      const tipped = this.tilt() > TIPPED_ANGLE
      if (leanBack || leanFwd) {
        // full flip strength in the air (and for tipped recovery); gentle
        // weight-shift/wheelie assist while grounded
        this.lean(leanFwd ? 1 : -1, airborne || tipped ? FLIP_LEAN : GROUND_LEAN)
      }

      // Trend tailwind: a strong bull market pushes you forward.
      if (state.started && Math.abs(state.trend) > 0.3) {
        const f = state.trend * 0.0009 * chassis.mass
        this.matter.body.applyForce(chassis, chassis.position, { x: f, y: 0 })
      }

      this.updateNitro(chassis)
    } else {
      this.throttle(0)
      this.lean(0, 0)
      state.nitroActive = false
      this.nitroLatch = false
      // Leaving 'playing' (crash/finish/menu) mid-boost: cut the whoosh.
      if (this.prevNitroActive) {
        this.prevNitroActive = false
        this.ctx.audio.boostStop()
      }
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
      this.updateGroundTricks()
      this.collectCredits(bx, chassis.position.y)
      const d = bx - this.startX
      if (d > state.distance) state.distance = d
      // Kill-plane safety net: any freefall past the terrain floor is a wipeout,
      // even if the bike somehow escaped the left wall or a physics glitch.
      if (!this.killed && chassis.position.y > this.killY) {
        this.killed = true
        this.crashed = true
      }
      if (this.crashed) this.onCrash()
      // Finish slightly BEFORE the flag: the right containment wall starts at
      // the last terrain point, so requiring bx >= endX exactly left the flag
      // physically unreachable (chassis blocked half a bike short of the line).
      else if (bx >= state.terrain!.endX - 120) this.onFinish()
    }
  }

  // Hard landings can blow a wheel out of its suspension socket: the soft
  // constraints stretch/flip under extreme impact and never recover, so the
  // sprite's swingarm/silencer no longer lines up with the wheel and the
  // wedged wheel blocks the bike. Terminal fall speed + hard bump stops keep
  // the bike assembled no matter how hard it smashes down.
  private enforceBikeIntegrity(): void {
    const MAX_FALL = 20 // px/step terminal velocity — capped low so a long drop
    // lands with a survivable impulse instead of blowing the wheels out of socket
    const MAX_HORIZ = 48 // px/step terminal horizontal speed
    const B = this.matter.body
    for (const b of [this.chassis, this.wheelBack, this.wheelFront]) {
      const vx = clamp(b.velocity.x, -MAX_HORIZ, MAX_HORIZ)
      const vy = Math.min(b.velocity.y, MAX_FALL)
      if (vx !== b.velocity.x || vy !== b.velocity.y) B.setVelocity(b, { x: vx, y: vy })
    }
    const a = this.chassis.angle
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    const p = this.chassis.position
    // Split the socket error into chassis-local axes and treat them differently.
    // VERTICAL (suspension) keeps a generous soft travel so jagged terrain never
    // trips a hard correction (that was the old jitter). FORE/AFT is held tight:
    // a hard slam scatters the wheel sideways out from under the swingarm and it
    // never eases back, which is what leaves the bike looking ruined — clamping
    // it keeps the wheel socketed no matter how hard the landing.
    const LAT_MAX = 8 // fore/aft: wheel stays under the swingarm
    const VERT_TRAVEL = 20 // stretch give before the bump stop
    const VERT_SNAP = 55 // beyond this the wheel has blown out — hard reseat
    // Compression is asymmetric: easing here lets the wheel tuck visibly INTO
    // the frame on rear-first slams ("squeezed" bike), so it hard-stops early.
    const COMPRESS_MAX = 8
    const fix = (wheel: Body, dx: number): void => {
      const sx = p.x + cos * dx - sin * WHEEL_DY
      const sy = p.y + sin * dx + cos * WHEEL_DY
      const ex = wheel.position.x - sx
      const ey = wheel.position.y - sy
      let lat = cos * ex + sin * ey // fore/aft along the chassis
      let vert = -sin * ex + cos * ey // suspension axis (down)
      let changed = false
      let hard = false
      if (lat > LAT_MAX) { lat = LAT_MAX; changed = true }
      else if (lat < -LAT_MAX) { lat = -LAT_MAX; changed = true }
      if (vert < -COMPRESS_MAX) {
        // wheel pushed up into the frame — hard bump stop, no ease
        changed = true
        if (vert < -VERT_SNAP) hard = true
        vert = -COMPRESS_MAX
      } else if (vert > VERT_TRAVEL) {
        // stretched below the swingarm — keep the generous soft travel
        changed = true
        if (vert > VERT_SNAP) { vert = VERT_TRAVEL; hard = true } // reseat
        else vert = VERT_TRAVEL + (vert - VERT_TRAVEL) * 0.65 // ease 35% of excess
      }
      if (!changed) return
      // recompose the clamped error back into world space
      const nex = cos * lat - sin * vert
      const ney = sin * lat + cos * vert
      B.setPosition(wheel, { x: sx + nex, y: sy + ney })
      // Only reseats damp velocity toward the chassis; a hard reset on every
      // small nudge would inject constraint-fighting energy and read as jitter.
      if (hard) {
        B.setVelocity(wheel, {
          x: (wheel.velocity.x + this.chassis.velocity.x) * 0.5,
          y: (wheel.velocity.y + this.chassis.velocity.y) * 0.5,
        })
      }
    }
    fix(this.wheelBack, BACK_DX)
    fix(this.wheelFront, FRONT_DX)
  }

  private syncBikeState(): void {
    this.enforceBikeIntegrity()
    this.grounded = this.contacts > 0
    // The constraint solver re-injects ~0.1 px/step of spring jitter after the
    // park snap, so a parked bike would still read 1 km/h without this.
    this._speed = this.parked ? 0 : this.chassis.speed * 60
    // Settled upside down = dead. The head-contact crash only fires on a NEW
    // collision while pitched past the gate; a wreck that slides into an
    // inverted rest keeps its old contact and never re-triggers, leaving the
    // rider planted head-first forever. A short timer catches that state.
    if (this.ctx.state.phase === 'playing' && this.grounded && this.tilt() > 2.4) {
      this.invertedMs += STEP
      if (this.invertedMs > 900) this.crashed = true
    } else {
      this.invertedMs = 0
    }
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
      // Boost just ended (shift released or tank empty): kill the whoosh too.
      if (this.prevNitroActive) this.ctx.audio.boostStop()
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
        const value = this.pickupValue[j] ?? 0
        if (value === 0) { collected[j] = 1; continue }
        collected[j] = 1
        if (value === -1) {
          // nitro canister: full tank, even mid-boost
          state.nitro = 1
          this.popup(m.x, m.y - 56, 'NITRO', 0x5ad1ff)
          if (!this.ctx.isMuted()) this.ctx.audio.canister()
        } else {
          state.points += value
          if (!state.nitroActive) state.nitro = clamp(state.nitro + NITRO_PER_COIN, 0, 1)
          this.popup(m.x, m.y - 56, `+${value}`, value >= 50 ? 0xffd766 : 0x34d97b)
          if (!this.ctx.isMuted()) this.ctx.audio.pickup(value)
        }
        this.coinSprites[j]?.setVisible(false)
        this.ePickup.emitParticleAt(m.x, m.y - 40, value === -1 || value >= 50 ? 16 : 10)
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
        this.lastFlipDir = Math.sign(this.flipAccum)
        this.flipAccum -= Math.sign(this.flipAccum) * TWO_PI
        // mid-air micro-feedback the instant the rotation completes
        if (!this.ctx.isMuted()) this.ctx.audio.flip()
        this.popup(
          this.chassis.position.x,
          this.chassis.position.y - 70,
          this.lastFlipDir < 0 ? 'BACKFLIP' : 'FRONTFLIP',
          0xf5a524,
        )
        this.addShake(2)
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
    if (state.phase === 'playing') {
      if (this.pendingFlips > 0) {
        const flips = this.pendingFlips
        state.flips += flips
        // Each flip is its own trick: it advances the streak, and every flip's
        // +25 is scaled by the multiplier at the moment it's counted, so a
        // multi-flip both builds and cashes in the same landing.
        let bonus = 0, mult = this.streak
        for (let i = 0; i < flips; i++) { mult = this.bumpStreak(TT_FLIP); bonus += FLIP_PTS * mult }
        state.points += bonus
        if (!state.nitroActive) state.nitro = clamp(state.nitro + flips * NITRO_PER_FLIP, 0, 1)
        if (!this.ctx.isMuted()) {
          this.ctx.audio.land(bonus)
          if (mult > 1) this.ctx.audio.streak(mult)
        }
        this.eBoost.emitParticleAt(this.chassis.position.x, this.chassis.position.y - 24, 8)
        // one popup for the banked flip points; one for the streak level reached
        this.popup(this.chassis.position.x, this.chassis.position.y - 64, `+${bonus}`, 0xf5a524, 1.25)
        this.streakPopup(mult)
        this.addShake(2.5)
        // named one-shot combos for stacking flips in a single air
        if (flips >= 3) this.awardCombo(MADMAN_PTS, 'MADMAN')
        else if (flips >= 2) this.awardCombo(ASTRONAUT_PTS, 'ASTRONAUT')
        this.checkShowoff()
      } else {
        // No flip this air — award the highest air-time tier reached.
        const air = this.curAirMs
        if (air >= AIR_SAILOR_MS) this.award(TT_AIR, AIR_SAILOR_PTS, 'DEAD SAILOR', 0x34d97b)
        else if (air >= AIR_SUPERMAN_MS) this.award(TT_AIR, AIR_SUPERMAN_PTS, 'SUPERMAN', 0xffffff)
        else if (air >= AIR_NOHANDER_MS) this.award(TT_AIR, AIR_NOHANDER_PTS, 'NO-HANDER', 0xffffff)
      }
    }
    this.pendingFlips = 0
    this.flipAccum = 0
  }

  // ---- tricks & streak ---------------------------------------------------
  // Advance the streak for one trick of `type`, returning the current
  // multiplier (1..STREAK_MAX). Chains if within the window, else starts a
  // fresh chain (also how a >window lapse silently decays the streak to ×1).
  private bumpStreak(type: number): number {
    const now = this.ctx.state.timeMs
    if (now - this.lastTrickMs <= STREAK_WINDOW_MS) {
      if (this.streak < STREAK_MAX) this.streak++
    } else {
      this.streak = 1
      this.streakTypes = 0
      this.showoffDone = false
    }
    this.lastTrickMs = now
    this.streakTypes |= type
    return this.streak
  }

  // "×N STREAK" in green at the bike, a touch bigger each level. Only shown
  // once the chain is actually multiplying (×2+), never for a fresh ×1.
  private streakPopup(mult: number): void {
    if (mult < 2) return
    this.popup(this.chassis.position.x, this.chassis.position.y - 92, `×${mult} STREAK`, 0x34d97b, 1 + mult * 0.07)
  }

  // A single non-flip trick award: bump streak, bank the multiplied points,
  // one popup for the trick + one for the streak level, then check SHOWOFF.
  private award(type: number, base: number, name: string, tint: number): void {
    const before = this.streak
    const mult = this.bumpStreak(type)
    const pts = base * mult
    this.ctx.state.points += pts
    this.popup(this.chassis.position.x, this.chassis.position.y - 64, `${name} +${pts}`, tint, 1.1)
    if (mult > before) this.streakPopup(mult)
    this.addShake(2)
    if (!this.ctx.isMuted()) {
      this.ctx.audio.land(pts)
      if (mult > before) this.ctx.audio.streak(mult)
    }
    this.checkShowoff()
  }

  // Named one-shot combo: a flat amber lump sum with a big pop and hard shake.
  private awardCombo(pts: number, name: string): void {
    this.ctx.state.points += pts
    this.popup(this.chassis.position.x, this.chassis.position.y - 108, `${name} +${pts}`, 0xf5a524, 1.4)
    this.addShake(7)
    if (!this.ctx.isMuted()) this.ctx.audio.combo()
  }

  // SHOWOFF: 3+ distinct trick types within the current streak, once per streak.
  private checkShowoff(): void {
    if (this.showoffDone) return
    let n = 0, m = this.streakTypes
    while (m) { n += m & 1; m >>= 1 }
    if (n >= 3) {
      this.showoffDone = true
      this.awardCombo(SHOWOFF_PTS, 'SHOWOFF')
    }
  }

  // Per-step ground-trick detection (playing + grounded). Wheelie/stoppie read
  // per-wheel contact asymmetry; speed demon reads sustained top-end speed.
  // Held tricks re-award every full interval so a long hold keeps paying out.
  private updateGroundTricks(): void {
    const spd = this._speed
    const vx = this.chassis.velocity.x
    const back = this.backContacts > 0
    const front = this.frontContacts > 0
    // WHEELIE: riding on the back wheel, nose up, rolling forward. The bike must
    // still be on its back wheel for the grace to hold — a full launch (back
    // wheel clears too) or a level-out (front plants) is a real break.
    if (back && !front && vx > 0 && spd > WHEELIE_MIN_SPEED) {
      this.wheelieMs += STEP
      this.wheelieGrace = 0
      if (this.wheelieMs >= WHEELIE_MS) { this.wheelieMs -= WHEELIE_MS; this.award(TT_WHEELIE, WHEELIE_PTS, 'WHEELIE', 0xffffff) }
    } else if (this.wheelieMs > 0 && !front && vx > 0 && (this.wheelieGrace += STEP) <= GROUND_TRICK_GRACE) {
      // back wheel bounced off a bump (brief airborne) but the nose is still up —
      // hold the wheelie. A planted front (level-out) or a sustained launch breaks it.
    } else { this.wheelieMs = 0; this.wheelieGrace = 0 }
    // STOPPIE: balanced on the front wheel, back clear, still moving.
    if (front && !back && spd > STOPPIE_MIN_SPEED) {
      this.stoppieMs += STEP
      this.stoppieGrace = 0
      if (this.stoppieMs >= STOPPIE_MS) { this.stoppieMs -= STOPPIE_MS; this.award(TT_STOPPIE, STOPPIE_PTS, 'STOPPIE', 0xffffff) }
    } else if (this.stoppieMs > 0 && !back && spd > STOPPIE_MIN_SPEED && (this.stoppieGrace += STEP) <= GROUND_TRICK_GRACE) {
      // front wheel skipped off a bump but the back is still up — hold the stoppie.
    } else { this.stoppieMs = 0; this.stoppieGrace = 0 }
    this.smoothSpeed += (Math.abs(spd) - this.smoothSpeed) * SPEED_SMOOTH
    if (this.smoothSpeed >= SPEED_DEMON_HI) {
      this.speedDemonMs += STEP
      if (this.speedDemonMs >= SPEED_DEMON_MS) { this.speedDemonMs -= SPEED_DEMON_MS; this.award(TT_SPEED, SPEED_DEMON_PTS, 'SPEED DEMON', 0x34d97b) }
    } else if (this.smoothSpeed < SPEED_DEMON_LO) this.speedDemonMs = 0
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
    const P = this.prevPose
    P.rx = body.position.x; P.ry = body.position.y; P.ra = body.angle

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
    this.updatePopups()
    this.drawStars()
    this.syncSprites()
    this.applyCamera()
    this.drawWorld()
    this.drawChrome()
    this.ctx.hud.update(state)
    this.ctx.audio.setEngine(this._rpm, this.throttleAudioOn())

    if ((state.phase === 'crashed' || state.phase === 'finished') && !this.resultsShown) {
      const wait = state.phase === 'crashed' ? 1100 : 700
      if (state.timeMs - this.outcomeAt >= wait) {
        this.resultsShown = true
        if (state.phase === 'crashed') {
          // No results card on a crash: watch the ragdoll for a beat, then the
          // bike drops back in right where you died and the run just continues.
          this.restartRun()
        } else {
          this.ctx.hud.showResults(state, () => this.restartRun())
        }
      }
    }
  }

  private throttleAudioOn(): boolean {
    const state = this.ctx.state
    if (state.phase !== 'playing' || this.ctx.isMuted()) return false
    return this.down('KeyW') || this.down('ArrowUp') || this.down('Space') || this.ctx.touch.throttle
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
      // No speed-based zoom: fractional zoom renders the pixel bike soft/blurry
      // at pace, so the camera holds scale 1 and only big air widens the view.
      targetZoom = 1.0
      // Only sustained air widens the view — the grounded flag flickers over
      // jagged vertices and reacting to it makes the zoom pump.
      if (!this.grounded && this.curAirMs > 250 && state.terrain) {
        const h = state.terrain.groundY(p.x) - p.y
        if (h > 80) targetZoom -= Math.min((h - 80) / 900, 1) * 0.2
      }
    }
    state.camera.x += (tx - state.camera.x) * 0.08
    state.camera.y += (ty - state.camera.y) * 0.08
    const zoomRate = targetZoom < state.camera.zoom ? 0.09 : 0.028
    state.camera.zoom += (targetZoom - state.camera.zoom) * zoomRate
  }

  private applyCamera(): void {
    const cam = this.cameras.main
    const c = this.ctx.state.camera
    const zoom = (c.zoom > 0 ? c.zoom : 1) * DPR // logical zoom on a physical-res canvas
    cam.setZoom(zoom)
    // Fold screen-space shake into the camera centre (world units).
    cam.centerOn(c.x + this.shx / zoom, c.y + this.shy / zoom)
  }

  // ---- floating score popups (pooled world-space texts) -------------------
  private popup(x: number, y: number, msg: string, tint: number, scale = 1): void {
    let txt = this.popTexts.find(t => !t.visible)
    if (!txt) {
      if (this.popTexts.length >= 14) return // pool cap; drop excess spam
      txt = this.add.text(0, 0, '', {
        fontFamily: SANS, fontSize: '17px', fontStyle: '700', color: '#ffffff',
        stroke: '#050505', strokeThickness: 4,
      }).setOrigin(0.5, 1).setDepth(9).setVisible(false)
      this.popTexts.push(txt)
    }
    txt.setText(msg)
    txt.setTint(tint)
    txt.setScale(scale)
    txt.setPosition(x, y)
    txt.setAlpha(1)
    txt.setVisible(true)
    txt.setData('born', this.ctx.state.timeMs)
    txt.setData('baseY', y)
  }

  private updatePopups(): void {
    const now = this.ctx.state.timeMs
    for (const txt of this.popTexts) {
      if (!txt.visible) continue
      const age = now - (txt.getData('born') as number)
      if (age > 900) { txt.setVisible(false); continue }
      const k = age / 900
      txt.y = (txt.getData('baseY') as number) - k * 46
      txt.setAlpha(k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45)
    }
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
    // Blend between the previous and current physics pose by how far the
    // accumulator sits into the next step, so sprites move every rendered
    // frame even when no physics step ran this frame (120Hz+ displays).
    const P = this.prevPose
    const t = Math.min(this.acc / STEP, 1)
    const lerp = (a: number, b: number) => a + (b - a) * t
    this.wheelBackSprite
      .setPosition(lerp(P.bx, this.wheelBack.position.x), lerp(P.by, this.wheelBack.position.y))
      .setRotation(lerp(P.ba, this.wheelBack.angle))
    this.wheelFrontSprite
      .setPosition(lerp(P.fx, this.wheelFront.position.x), lerp(P.fy, this.wheelFront.position.y))
      .setRotation(lerp(P.fa, this.wheelFront.angle))
    const a = lerp(P.ca, this.chassis.angle)
    const cx = lerp(P.cx, this.chassis.position.x)
    const cy = lerp(P.cy, this.chassis.position.y)
    this.bikeSprite.setPosition(cx, cy).setRotation(a)
    if (this.bikeView.ejected && this.ragdoll) {
      this.ragdollSprite
        .setPosition(lerp(P.rx, this.ragdoll.position.x), lerp(P.ry, this.ragdoll.position.y))
        .setRotation(lerp(P.ra, this.ragdoll.angle))
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
      const rx = cx + Math.cos(a) * ox - Math.sin(a) * oy
      const ry = cy + Math.sin(a) * ox + Math.cos(a) * oy
      this.riderSprite.setPosition(rx, ry).setRotation(a)
    }
    // coin bob (visible ones near the camera)
    const wv = this.cameras.main.worldView
    const bob = Math.sin(this.ctx.state.timeMs * 0.005) * 4
    const coins = this.coinSprites
    const markers = this.ctx.state.terrain!.markers
    const coinLeft = wv.x - 40
    const coinRight = wv.right + 40
    for (let i = pointIndex(markers, coinLeft); i < coins.length; i++) {
      const m = markers[i]
      if (m.x > coinRight) break
      const c = coins[i]
      if (!c || !c.visible) continue
      if (m.x < coinLeft) continue
      c.y = m.y - 40 + bob
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
    for (let i = pointIndex(mk, left); i < mk.length; i++) {
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
  // Starry night: a fixed set of hash-placed stars drawn in identity screen
  // space (same 1/zoom counter-transform as the chrome), wrapping with a slow
  // parallax against the camera and a gentle per-star twinkle.
  private drawStars(): void {
    const cam = this.cameras.main
    const invP = 1 / cam.zoom
    const w = this.scale.width / DPR // CSS px
    const h = this.scale.height / DPR
    const cInX = this.scale.width / 2, cInY = this.scale.height / 2
    const cOutX = Math.round(cInX), cOutY = Math.round(cInY)
    const g = this.starGfx
    g.setScale(DPR * invP).setPosition(cInX - cOutX * invP, cInY - cOutY * invP)
    g.clear()
    const t = this.ctx.state.timeMs
    const camX = this.ctx.state.camera.x
    const camY = this.ctx.state.camera.y
    for (let i = 0; i < 140; i++) {
      // cheap per-star hash → stable position, size, phase, tint
      const hx = ((i * 2654435761) >>> 0) % 10000 / 10000
      const hy = ((i * 1597334677) >>> 0) % 10000 / 10000
      const layer = i % 3 // three parallax depths
      const par = 0.05 + layer * 0.05
      let x = (hx * w * 1.4 - camX * par) % (w * 1.4)
      if (x < 0) x += w * 1.4
      x -= w * 0.2
      let y = (hy * h - camY * par * 0.5) % h
      if (y < 0) y += h
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(t * 0.0011 + i * 1.7))
      const size = layer === 2 ? 2 : 1
      g.fillStyle(i % 11 === 0 ? 0x34d97b : 0xf5f5f5, tw * (0.25 + layer * 0.12))
      g.fillRect(Math.round(x), Math.round(y), size, size)
    }
  }

  private drawChrome(): void {
    const state = this.ctx.state
    const t = state.terrain
    if (!t) return
    const cam = this.cameras.main
    const wv = cam.worldView
    const zoom = cam.zoom / DPR // world → CSS px
    const w = this.scale.width / DPR // CSS px
    const h = this.scale.height / DPR
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
    const invP = 1 / cam.zoom
    const cInX = this.scale.width / 2, cInY = this.scale.height / 2
    const cOutX = Math.round(cInX), cOutY = Math.round(cInY)
    const placeUI = (txt: Phaser.GameObjects.Text, X: number, Y: number): void => {
      // Snap to whole screen pixels: the chrome is scaled by 1/zoom, so at
      // fractional (zoomed-out / high-speed) zoom an unrounded target lands on a
      // sub-pixel position and the glyphs render soft/blurry. Rounding the target
      // keeps the anchor on an integer pixel so text stays crisp at every zoom.
      X = Math.round(X * DPR); Y = Math.round(Y * DPR)
      txt.setScale(DPR * invP).setPosition(cInX + (X - cOutX) * invP, cInY + (Y - cOutY) * invP)
    }

    const g = this.chromeGfx
    g.setScale(DPR * invP).setPosition(cInX - cOutX * invP, cInY - cOutY * invP)
    g.clear()

    // horizontal price-level grid lines + right-edge labels. Each line's screen
    // Y tracks its price level on the (zooming) chart via sy(); placeUI pins the
    // label to a fixed screen X and fixed font size in the identity chrome layer.
    let ai = 0
    if (this.axis) {
      for (let i = 0; i < this.axis.levelY.length; i++) {
        const py = Math.round(sy(this.axis.levelY[i])) // integer px: crisp gridline + label at any zoom
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
    for (let i = pointIndex(mk, left); i < mk.length; i++) {
      const m = mk[i]
      if (!m.dayBoundary) continue
      if (m.x < left) continue
      if (m.x > right) break
      const px = Math.round(sx(m.x))
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
    const chipY = Math.round(sy(wy)) // glued to the bike's price level, snapped to integer px
    if (chipY > 40 && chipY < h - 20) {
      const price = priceAtX(t.markers, bikeX)
      // dotted horizontal line
      g.lineStyle(1, 0xf5f5f5, 0.35)
      this.dottedLine(g, 0, chipY, w - 58, chipY, 2, 4)
      // white chip
      const label = fmtAxis(price)
      this.chipText.setText(label).setVisible(true)
      const cw = Math.round(this.chipText.width) + 12
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
}
