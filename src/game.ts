// game.ts — owns GameState, the matter Engine, the fixed-timestep loop,
// input, the phase state machine, and all cross-module wiring.
import Matter from 'matter-js'
import type { Engine } from 'matter-js'
import type { GameState, Track } from './types'
import { TRACKS, fetchSeries } from './data'
import { buildTerrain } from './terrain'
import { createBike, createTerrainBodies } from './bike'
import { createEffects } from './effects'
import { render } from './render'
import { createHud } from './hud'
import { createAudio } from './audio'

const STEP = 1000 / 60 // fixed physics timestep (ms)
const MAX_STEPS = 4 // spiral-of-death guard
const TWO_PI = Math.PI * 2
const BEST_KEY = 'ornn-rider-best'
const GRAVITY_Y = 1.1
const SPAWN_DX = 90 // spawn offset into the lead-in flat
const SPAWN_DY = 60 // spawn height above the ground

function loadBest(): Record<string, number> {
  try {
    const raw = localStorage.getItem(BEST_KEY)
    if (raw) return JSON.parse(raw) as Record<string, number>
  } catch {
    /* ignore corrupt storage */
  }
  return {}
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function startGame(canvas: HTMLCanvasElement, root: HTMLElement): void {
  const ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D
  const hud = createHud(root)
  const audio = createAudio()
  const effects = createEffects()

  const state: GameState = {
    phase: 'menu',
    track: null,
    terrain: null,
    bike: null,
    engine: null,
    effects,
    camera: { x: 0, y: 0, zoom: 1 },
    distance: 0,
    credits: 0,
    airTimeMs: 0,
    flips: 0,
    bestDistance: loadBest(),
    trend: 0,
    timeMs: 0,
  }

  // --- viewport (CSS pixels handed to render; render applies dpr itself) ---
  const view = { w: 1, h: 1 }
  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const cw = window.innerWidth
    const ch = window.innerHeight
    view.w = Math.max(1, cw)
    view.h = Math.max(1, ch)
    canvas.width = Math.max(1, Math.floor(cw * dpr))
    canvas.height = Math.max(1, Math.floor(ch * dpr))
    canvas.style.width = cw + 'px'
    canvas.style.height = ch + 'px'
  }
  resize()
  window.addEventListener('resize', resize)

  // --- input ---
  const keys = new Set<string>()
  const PREVENT = new Set([
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Space',
  ])
  const down = (code: string): boolean => keys.has(code)
  let touchThrottle = false
  let touchBrake = false
  let muted = false
  let throttleOn = false // last commanded forward throttle (for engine audio)

  window.addEventListener('keydown', (e) => {
    keys.add(e.code)
    // Held keys auto-repeat keydown; one-shot actions must fire once per press.
    if (!e.repeat) {
      if (e.code === 'KeyR') {
        if (state.track && (state.phase === 'playing' || state.phase === 'crashed' || state.phase === 'finished')) {
          restartRun()
        }
      } else if (e.code === 'KeyM') {
        if (state.phase === 'crashed' || state.phase === 'finished') goMenu()
        else muted = !muted
      }
    }
    if (PREVENT.has(e.code)) e.preventDefault()
  })
  window.addEventListener('keyup', (e) => keys.delete(e.code))
  window.addEventListener('blur', () => {
    keys.clear()
    clearTouch() // pointerup may never fire if focus is lost mid-press
  })

  canvas.addEventListener('pointerdown', (e) => {
    if (state.phase !== 'playing') return
    if (e.clientX < window.innerWidth / 2) touchBrake = true
    else touchThrottle = true
  })
  const clearTouch = (): void => {
    touchThrottle = false
    touchBrake = false
  }
  canvas.addEventListener('pointerup', clearTouch)
  canvas.addEventListener('pointercancel', clearTouch)
  canvas.addEventListener('pointerleave', clearTouch)

  // --- per-run mutable game logic state ---
  let startX = 0
  let collected = new Uint8Array(0)
  let collectIdx = 0
  let trendIdx = 0
  let prevGrounded = true
  let airMaxVy = 0 // largest downward wheel velocity seen while airborne
  let flipAccum = 0 // radians of chassis rotation accumulated in air
  let pendingFlips = 0 // completed flips not yet awarded (awarded on landing)
  let lastAngle = 0
  let resultsShown = false
  let outcomeAt = 0 // timeMs when crash/finish happened
  let fxTick = 0

  function resetRunState(sx: number): void {
    startX = sx
    state.distance = 0
    state.credits = 0
    state.flips = 0
    state.airTimeMs = 0
    state.trend = 0
    state.timeMs = 0
    collected = new Uint8Array(state.terrain!.markers.length)
    collectIdx = 0
    trendIdx = 0
    prevGrounded = true
    airMaxVy = 0
    flipAccum = 0
    pendingFlips = 0
    lastAngle = state.bike!.chassis.angle
    resultsShown = false
    outcomeAt = 0
    const p = state.bike!.chassis.position
    state.camera.x = p.x
    state.camera.y = p.y - 40
    state.camera.zoom = 1
  }

  // --- flow / phase machine ---
  function goMenu(): void {
    state.phase = 'menu'
    hud.hideResults()
    hud.setLoading(null)
    hud.showMenu(TRACKS, state.bestDistance, (t: Track) => void loadTrack(t))
  }

  // Same-track restart: reset the existing bike/world instead of rebuilding
  // the whole physics engine (avoids a restart hitch + GC burst).
  function restartRun(): void {
    if (!state.terrain || !state.bike || !state.engine || !state.track) return
    hud.hideResults()
    const sx = state.terrain.startX + SPAWN_DX
    const sy = state.terrain.groundY(sx) - SPAWN_DY
    state.bike.reset(sx, sy)
    resetRunState(sx)
    state.phase = 'playing'
  }

  let terrainCollider: { update(bikeX: number): void } | null = null

  async function loadTrack(track: Track): Promise<void> {
    state.phase = 'loading'
    hud.hideMenu()
    hud.hideResults()
    hud.setLoading('loading ' + track.label + ' …')
    try {
      const series = await fetchSeries(track)
      const terrain = buildTerrain(series)
      if (state.engine) Matter.Engine.clear(state.engine)
      const engine: Engine = Matter.Engine.create()
      engine.gravity.x = 0
      engine.gravity.y = GRAVITY_Y
      const sx = terrain.startX + SPAWN_DX
      const sy = terrain.groundY(sx) - SPAWN_DY
      terrainCollider = createTerrainBodies(engine, terrain, sx)
      const bike = createBike(engine, sx, sy)
      state.track = track
      state.terrain = terrain
      state.engine = engine
      state.bike = bike
      resetRunState(sx)
      hud.hideMenu()
      hud.setLoading(null)
      state.phase = 'playing'
    } catch {
      hud.setLoading('failed to load ' + track.label + ' — press M for menu')
      window.setTimeout(() => {
        if (state.phase === 'loading') goMenu()
      }, 1600)
    }
  }

  function saveBest(): void {
    const t = state.track
    if (!t) return
    const prev = state.bestDistance[t.id] ?? 0
    if (state.distance > prev) {
      state.bestDistance[t.id] = state.distance
      try {
        localStorage.setItem(BEST_KEY, JSON.stringify(state.bestDistance))
      } catch {
        /* ignore */
      }
    }
  }

  function onCrash(): void {
    state.phase = 'crashed'
    const b = state.bike!
    effects.emitCrash(b.chassis.position.x, b.chassis.position.y)
    effects.addShake(7)
    if (!muted) audio.crash()
    saveBest()
    outcomeAt = state.timeMs
  }

  function onFinish(): void {
    state.phase = 'finished'
    const b = state.bike!
    // green confetti burst via the boost emitter (respects the effects pool)
    for (let i = 0; i < 6; i++) effects.emitBoost(b.chassis.position.x, b.chassis.position.y - 30)
    effects.emitPickup(b.chassis.position.x, b.chassis.position.y - 20)
    if (!muted) audio.boost()
    saveBest()
    outcomeAt = state.timeMs
  }

  // --- trend: smoothed changePct of day-markers around the bike ---
  function updateTrend(bx: number): void {
    const markers = state.terrain!.markers
    if (markers.length === 0) return
    while (trendIdx < markers.length - 1 && markers[trendIdx + 1].x <= bx) trendIdx++
    let sum = 0
    let n = 0
    const lo = Math.max(0, trendIdx - 2)
    const hi = Math.min(markers.length - 1, trendIdx + 2)
    for (let j = lo; j <= hi; j++) {
      sum += markers[j].changePct
      n++
    }
    const avg = n > 0 ? sum / n : 0
    const target = clamp(avg / 3, -1, 1)
    state.trend += (target - state.trend) * 0.06
  }

  // --- credit pickup: coins live on uncollected day-markers ---
  function collectCredits(bx: number, by: number): void {
    const markers = state.terrain!.markers
    while (collectIdx < markers.length && markers[collectIdx].x < bx - 60) collectIdx++
    for (let j = collectIdx; j < markers.length && markers[j].x < bx + 60; j++) {
      if (collected[j]) continue
      const m = markers[j]
      const dx = m.x - bx
      const dy = m.y - by
      if (dx * dx + dy * dy < 40 * 40) {
        collected[j] = 1
        state.credits += 1
        if (!muted) audio.ping()
        effects.emitPickup(m.x, m.y)
      }
    }
  }

  // --- flip tracking: integrate chassis rotation while airborne ---
  function integrateFlips(airborne: boolean, angle: number): void {
    if (airborne) {
      let da = angle - lastAngle
      // shortest-arc normalize so a wrap across ±π isn't counted as a flip
      while (da > Math.PI) da -= TWO_PI
      while (da < -Math.PI) da += TWO_PI
      flipAccum += da
      while (Math.abs(flipAccum) >= TWO_PI) {
        pendingFlips++
        flipAccum -= Math.sign(flipAccum) * TWO_PI
      }
    }
    lastAngle = angle
  }

  function onLanding(): void {
    const b = state.bike!
    const impact = airMaxVy // downward px/step at the last airborne moment
    if (impact > 3) {
      const mag = clamp(impact / 18, 0, 1)
      if (!muted) audio.thud(mag)
      effects.emitDust(b.wheelBack.position.x, b.wheelBack.position.y + 18, mag)
      effects.addShake(impact * 0.35)
    }
    if (pendingFlips > 0 && state.phase === 'playing') {
      state.flips += pendingFlips
      state.credits += pendingFlips * 5 // flip bonus
      if (!muted) {
        audio.ping()
        audio.boost()
      }
      effects.emitBoost(b.chassis.position.x, b.chassis.position.y - 24)
    }
    pendingFlips = 0
    flipAccum = 0
  }

  // --- one fixed physics step ---
  function physicsStep(): void {
    const bike = state.bike!
    const engine = state.engine!
    const terrain = state.terrain!
    const chassis = bike.chassis
    const bx = chassis.position.x

    updateTrend(bx)

    const playing = state.phase === 'playing'
    const airborne = !bike.grounded

    if (playing) {
      const fwd = down('ArrowRight') || down('KeyD') || down('KeyW') || down('Space') || touchThrottle
      const brk = down('ArrowLeft') || down('KeyS') || touchBrake
      throttleOn = fwd
      bike.throttle(fwd ? 1 : brk ? -1 : 0)

      // A/D and Left/Right double as in-air lean; Up/Down always lean.
      const leanBack = down('ArrowUp') || (airborne && (down('KeyA') || down('ArrowLeft')))
      const leanFwd = down('ArrowDown') || (airborne && (down('KeyD') || down('ArrowRight')))
      bike.lean(leanFwd ? 1 : leanBack ? -1 : 0)

      // Trend-based tailwind: a strong bull market literally pushes you forward.
      if (Math.abs(state.trend) > 0.3) {
        const f = state.trend * 0.0009 * chassis.mass
        Matter.Body.applyForce(chassis, chassis.position, { x: f, y: 0 })
      }
    } else {
      throttleOn = false
      bike.throttle(0)
      bike.lean(0)
    }

    // wheel vertical velocity BEFORE contact is resolved this step
    const preVy = Math.max(bike.wheelBack.velocity.y, bike.wheelFront.velocity.y)

    if (terrainCollider) terrainCollider.update(bx)
    Matter.Engine.update(engine, STEP)
    bike.update(STEP)

    const grounded = bike.grounded
    integrateFlips(!grounded, chassis.angle)

    if (!grounded) {
      if (prevGrounded) {
        // just took off
        airMaxVy = 0
        flipAccum = 0
        pendingFlips = 0
      }
      state.airTimeMs += STEP
      if (preVy > airMaxVy) airMaxVy = preVy
    } else if (!prevGrounded) {
      onLanding() // just landed
    }
    prevGrounded = grounded

    if (playing) {
      const by = chassis.position.y
      collectCredits(bx, by)
      const d = bx - startX
      if (d > state.distance) state.distance = d
      if (bike.crashed) onCrash()
      else if (bx >= terrain.endX) onFinish()
    }
  }

  // --- per-frame presentation (camera, particles, ambient fx, audio) ---
  function updateCamera(): void {
    const bike = state.bike!
    const p = bike.chassis.position
    const spd = Math.abs(bike.speed)
    const dir = Math.sign(bike.chassis.velocity.x) || 1
    const look = dir * Math.min(spd * 0.22, 220)
    const targetX = p.x + look
    const targetY = p.y - 40
    const targetZoom = 1.0 - Math.min(spd, 1400) / 1400 * 0.18 // 1.0 → ~0.82
    state.camera.x += (targetX - state.camera.x) * 0.08
    state.camera.y += (targetY - state.camera.y) * 0.08
    state.camera.zoom += (targetZoom - state.camera.zoom) * 0.05
  }

  function ambientFx(): void {
    const bike = state.bike!
    fxTick++
    const spd = Math.abs(bike.speed)
    if (bike.grounded && spd > 200 && (fxTick & 1) === 0) {
      effects.emitDust(bike.wheelBack.position.x, bike.wheelBack.position.y + 18, clamp(spd / 700, 0.2, 1))
    }
    if (state.trend > 0.3 && spd > 300 && (fxTick & 3) === 0) {
      effects.emitBoost(bike.chassis.position.x, bike.chassis.position.y - 10)
    } else if (state.trend < -0.3 && (fxTick & 3) === 0) {
      effects.emitEmbers(bike.chassis.position.x, bike.chassis.position.y - 10)
    }
  }

  function presentation(dt: number): void {
    effects.update(dt)
    updateCamera()
    ambientFx()
    hud.update(state)
    audio.setEngine(state.bike!.rpm, throttleOn && !muted && state.phase === 'playing')

    if ((state.phase === 'crashed' || state.phase === 'finished') && !resultsShown) {
      const wait = state.phase === 'crashed' ? 900 : 700
      if (state.timeMs - outcomeAt >= wait) {
        resultsShown = true
        hud.showResults(state, restartRun, goMenu)
      }
    }
  }

  // --- main loop: fixed-timestep accumulator + rAF ---
  let last = performance.now()
  let acc = 0
  function frame(now: number): void {
    const dt = Math.min(now - last, 100)
    last = now

    const simulating = state.phase === 'playing' || state.phase === 'crashed' || state.phase === 'finished'
    if (simulating && state.bike && state.engine && state.terrain) {
      state.timeMs += dt
      acc += dt
      let steps = 0
      while (acc >= STEP && steps < MAX_STEPS) {
        physicsStep()
        acc -= STEP
        steps++
      }
      if (steps === MAX_STEPS && acc > STEP) acc = 0 // shed backlog
      presentation(dt)
    }

    // Only render while simulating: at the menu/loading the canvas sits behind
    // a near-opaque overlay, so drawing the whole scene there is wasted work.
    if (simulating && state.terrain) render(ctx, state, view.w, view.h)
    requestAnimationFrame(frame)
  }

  goMenu()
  requestAnimationFrame(frame)
}
