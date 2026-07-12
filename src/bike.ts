// Bike physics + terrain collision bodies. All matter-js code lives here.
// Game feel target: Hill Climb Racing — torquey drive, bouncy suspension,
// wheelie under throttle, free flips in the air.
import { Bodies, Body, Composite, Constraint, Events } from 'matter-js'
import type { Engine } from 'matter-js'
import type { Bike, Terrain } from './types'

// --- Body layout (offsets from chassis spawn centre) -----------------------
const BACK_DX = -32
const FRONT_DX = 32
const WHEEL_DY = 18
const HEAD_DX = -6
const HEAD_DY = -30
const WHEEL_R = 20
const CHASSIS_W = 90
const CHASSIS_H = 22
const HEAD_R = 11

// --- Drive tuning (per 60fps physics step) ---------------------------------
const MAX_WHEEL_AV = 1.0 // cap back-wheel angular speed (rad/step)
const WHEEL_ACCEL = 0.08 // spin-up per throttle step
const BRAKE_DECEL = 0.09 // brake/reverse approach rate
const REVERSE_TARGET_AV = -0.28 // slow reverse spin under brake
const WHEELIE_TORQUE = 0.012 // engine-reaction nose-lift per step
const MAX_WHEELIE_AV = 0.18 // clamp on wheelie rotation build-up
const AIR_LEAN = 0.022 // in-air flip control
const GROUND_LEAN = 0.006 // grounded weight-shift nudge

// --- Terrain body tuning ---------------------------------------------------
const SEG_THICKNESS = 50 // thick enough to resist tunnelling at speed
const SEG_OVERLAP = 8 // extra length so adjacent segments never seam-snag

const ZERO = { x: 0, y: 0 }

function approach(cur: number, target: number, step: number): number {
  if (cur < target) return Math.min(cur + step, target)
  if (cur > target) return Math.max(cur - step, target)
  return target
}

export function createBike(engine: Engine, x: number, y: number): Bike {
  const group = Body.nextGroup(true) // negative group: bike parts never self-collide
  const filter = { group, category: 0x0001, mask: 0xffffffff }

  const chassis = Bodies.rectangle(x, y, CHASSIS_W, CHASSIS_H, {
    label: 'chassis',
    density: 0.0022,
    friction: 0.2,
    frictionAir: 0.012,
    restitution: 0.1,
    collisionFilter: filter,
  })

  const wheelOpts = {
    label: 'wheel',
    density: 0.0016,
    friction: 1.4,
    frictionStatic: 2.0,
    restitution: 0.15,
    frictionAir: 0,
    collisionFilter: filter,
  }
  const wheelBack = Bodies.circle(x + BACK_DX, y + WHEEL_DY, WHEEL_R, wheelOpts)
  const wheelFront = Bodies.circle(x + FRONT_DX, y + WHEEL_DY, WHEEL_R, wheelOpts)

  const riderHead = Bodies.circle(x + HEAD_DX, y + HEAD_DY, HEAD_R, {
    label: 'head',
    density: 0.0008,
    friction: 0.4,
    restitution: 0.1,
    collisionFilter: filter,
  })

  // Two constraints per wheel: soft vertical travel (suspension), stiff fore/aft.
  const susp = (wheel: Body, ax: number) =>
    Constraint.create({
      bodyA: chassis,
      pointA: { x: ax, y: 0 },
      bodyB: wheel,
      pointB: { x: 0, y: 0 },
      stiffness: 0.4,
      damping: 0.16,
    })
  const cBack1 = susp(wheelBack, BACK_DX - 14)
  const cBack2 = susp(wheelBack, BACK_DX + 14)
  const cFront1 = susp(wheelFront, FRONT_DX - 14)
  const cFront2 = susp(wheelFront, FRONT_DX + 14)

  // Head pinned rigidly above chassis (two near-rigid links) so it rides along
  // and can trip the crash sensor when it dips into terrain.
  const head = (px: number) =>
    Constraint.create({
      bodyA: chassis,
      pointA: { x: px, y: -8 },
      bodyB: riderHead,
      pointB: { x: 0, y: 0 },
      stiffness: 0.9,
      damping: 0.1,
    })
  const cHead1 = head(HEAD_DX - 10)
  const cHead2 = head(HEAD_DX + 10)

  const composite = Composite.create()
  Composite.add(composite, [
    chassis,
    wheelBack,
    wheelFront,
    riderHead,
    cBack1,
    cBack2,
    cFront1,
    cFront2,
    cHead1,
    cHead2,
  ])
  Composite.add(engine.world, composite)

  const allBodies = [chassis, wheelBack, wheelFront, riderHead]

  // --- Mutable readonly-facing state ---------------------------------------
  let contacts = 0 // wheel↔terrain contact count
  let _grounded = false
  let _crashed = false
  let _speed = 0
  let _rpm = 0

  // --- Collision bookkeeping (grounded + crash), zero per-frame alloc ------
  Events.on(engine, 'collisionStart', (e) => {
    const pairs = e.pairs
    for (let i = 0; i < pairs.length; i++) {
      const a = pairs[i].bodyA.label
      const b = pairs[i].bodyB.label
      const terrainHit = a === 'terrain' || b === 'terrain'
      if (!terrainHit) continue
      if (a === 'wheel' || b === 'wheel') contacts++
      if (a === 'head' || b === 'head') _crashed = true
    }
  })
  Events.on(engine, 'collisionEnd', (e) => {
    const pairs = e.pairs
    for (let i = 0; i < pairs.length; i++) {
      const a = pairs[i].bodyA.label
      const b = pairs[i].bodyB.label
      const terrainHit = a === 'terrain' || b === 'terrain'
      if (!terrainHit) continue
      if (a === 'wheel' || b === 'wheel') contacts = Math.max(0, contacts - 1)
    }
  })

  return {
    chassis,
    wheelBack,
    wheelFront,
    riderHead,
    allBodies,

    throttle(dir: -1 | 0 | 1): void {
      if (dir === 1) {
        Body.setAngularVelocity(
          wheelBack,
          Math.min(wheelBack.angularVelocity + WHEEL_ACCEL, MAX_WHEEL_AV),
        )
        // engine reaction lifts the nose (wheelie) while gripping the ground
        if (_grounded && chassis.angularVelocity > -MAX_WHEELIE_AV) {
          Body.setAngularVelocity(chassis, chassis.angularVelocity - WHEELIE_TORQUE)
        }
      } else if (dir === -1) {
        Body.setAngularVelocity(
          wheelBack,
          approach(wheelBack.angularVelocity, REVERSE_TARGET_AV, BRAKE_DECEL),
        )
        Body.setAngularVelocity(
          wheelFront,
          approach(wheelFront.angularVelocity, 0, BRAKE_DECEL),
        )
      }
    },

    lean(dir: -1 | 0 | 1): void {
      if (dir === 0) return
      const k = _grounded ? GROUND_LEAN : AIR_LEAN
      Body.setAngularVelocity(chassis, chassis.angularVelocity + dir * k)
    },

    get speed(): number {
      return _speed
    },
    get rpm(): number {
      return _rpm
    },
    get grounded(): boolean {
      return _grounded
    },
    get crashed(): boolean {
      return _crashed
    },

    update(_dtMs: number): void {
      _grounded = contacts > 0
      _speed = chassis.speed * 60 // px/step -> px/s
      _rpm = Math.min(Math.abs(wheelBack.angularVelocity) / MAX_WHEEL_AV, 1)
    },

    reset(rx: number, ry: number): void {
      const place = (b: Body, ox: number, oy: number) => {
        Body.setPosition(b, { x: rx + ox, y: ry + oy })
        Body.setVelocity(b, ZERO)
        Body.setAngularVelocity(b, 0)
        Body.setAngle(b, 0)
      }
      place(chassis, 0, 0)
      place(wheelBack, BACK_DX, WHEEL_DY)
      place(wheelFront, FRONT_DX, WHEEL_DY)
      place(riderHead, HEAD_DX, HEAD_DY)
      contacts = 0
      _grounded = false
      _crashed = false
      _speed = 0
      _rpm = 0
    },
  }
}

// Sliding window of terrain segments kept in the physics world around the
// bike, so broadphase cost stays constant instead of scaling with track length
// (H100's 2-year history is ~7300 segments; only ~300 are ever near the bike).
export interface TerrainCollider {
  update(bikeX: number): void
}

// How far (world px) either side of the bike terrain bodies stay solid. Far
// beyond anything the bike can reach within a frame or the camera can show
// colliding objects for.
const COLLIDER_WINDOW = 2000

// Static collision surface from the smoothed terrain: one thin rotated
// rectangle per segment, each overlapping its neighbours so wheels never
// catch on a seam. Terrain is pre-smoothed (10 sub-points/day) so joint
// angles are tiny and the overlaps stay clean. All bodies are built up front;
// update() adds/removes them from the world as the bike moves.
export function createTerrainBodies(engine: Engine, terrain: Terrain, startX: number): TerrainCollider {
  const pts = terrain.points
  const bodies: Body[] = []
  const xs: number[] = [] // segment centre x, ascending (pts are x-ascending)
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const len = Math.hypot(dx, dy)
    if (len < 0.001) continue
    const angle = Math.atan2(dy, dx)
    // downward unit normal (-dy, dx)/len: push body below the surface line so
    // its top edge sits exactly on the terrain profile.
    const nx = -dy / len
    const ny = dx / len
    const cx = (p1.x + p2.x) * 0.5 + nx * (SEG_THICKNESS * 0.5)
    const cy = (p1.y + p2.y) * 0.5 + ny * (SEG_THICKNESS * 0.5)
    const seg = Bodies.rectangle(cx, cy, len + SEG_OVERLAP, SEG_THICKNESS, {
      isStatic: true,
      label: 'terrain',
      friction: 1,
      frictionStatic: 1,
      restitution: 0,
    })
    Body.setAngle(seg, angle)
    bodies.push(seg)
    xs.push((p1.x + p2.x) * 0.5)
  }

  const n = bodies.length
  // [loIdx, hiIdx) = contiguous range currently added to the world.
  let loIdx = 0
  let hiIdx = 0

  function update(bikeX: number): void {
    const lo = bikeX - COLLIDER_WINDOW
    const hi = bikeX + COLLIDER_WINDOW
    // grow right
    while (hiIdx < n && xs[hiIdx] <= hi) Composite.add(engine.world, bodies[hiIdx++])
    // shrink right (bike moved backward / was reset)
    while (hiIdx > loIdx && xs[hiIdx - 1] > hi) Composite.remove(engine.world, bodies[--hiIdx])
    // shrink left
    while (loIdx < hiIdx && xs[loIdx] < lo) Composite.remove(engine.world, bodies[loIdx++])
    // grow left
    while (loIdx > 0 && xs[loIdx - 1] >= lo) Composite.add(engine.world, bodies[--loIdx])
  }

  update(startX)
  return { update }
}
