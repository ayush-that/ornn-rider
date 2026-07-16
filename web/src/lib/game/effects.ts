// Pooled particle system + camera shake. Zero allocation in the update loop.
import type { Effects, Particle } from './types'
import { C } from './types'

const CAP = 600
const TAU = Math.PI * 2

// Per-type colour palettes. Constant strings => no per-frame allocation.
const DUST = ['#8f9c8a', '#75846f', '#a2ad9c', '#69766360'] as const
const BOOST = [C.green, C.greenDim, '#7ff0ad'] as const
const EMBERS = [C.red, C.amber, '#ff8a5c'] as const
const CRASH = [C.red, C.amber, C.green, '#e6ece6', '#ff8a5c'] as const

export function createEffects(): Effects {
  // Pre-allocate the whole pool once. Dead particles have life <= 0.
  const particles: Particle[] = new Array(CAP)
  for (let i = 0; i < CAP; i++) {
    particles[i] = {
      x: 0, y: 0, vx: 0, vy: 0,
      life: 0, maxLife: 1, size: 1, color: '#fff', glow: false,
    }
  }
  let head = 0
  const shake = { x: 0, y: 0 }
  let shakeMag = 0

  // Ring-buffer spawn: overwrites the oldest slot when the pool is full.
  function spawn(
    x: number, y: number, vx: number, vy: number,
    life: number, size: number, color: string, glow: boolean,
  ): void {
    const p = particles[head]
    head = head + 1 >= CAP ? 0 : head + 1
    p.x = x; p.y = y; p.vx = vx; p.vy = vy
    p.life = life; p.maxLife = life
    p.size = size; p.color = color; p.glow = glow
  }

  return {
    particles,
    shake,

    emitDust(x, y, intensity) {
      const n = 1 + (intensity * 3) | 0
      const cnt = n > 4 ? 4 : n
      for (let i = 0; i < cnt; i++) {
        const s = 0.04 + intensity * 0.06
        spawn(
          x + (Math.random() - 0.5) * 8,
          y + (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 0.09 - 0.02,
          -0.02 - Math.random() * s,
          360 + Math.random() * 320,
          2 + Math.random() * (2 + intensity * 2),
          DUST[(Math.random() * DUST.length) | 0],
          false,
        )
      }
    },

    emitBoost(x, y) {
      for (let i = 0; i < 3; i++) {
        spawn(
          x - Math.random() * 10,
          y + (Math.random() - 0.5) * 14,
          -0.16 - Math.random() * 0.12,
          -0.01 + (Math.random() - 0.5) * 0.03,
          280 + Math.random() * 220,
          1.6 + Math.random() * 2,
          BOOST[(Math.random() * BOOST.length) | 0],
          true,
        )
      }
    },

    emitEmbers(x, y) {
      for (let i = 0; i < 2; i++) {
        spawn(
          x + (Math.random() - 0.5) * 24,
          y + (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 0.05,
          -0.03 - Math.random() * 0.04, // buoyant drift up
          520 + Math.random() * 460,
          1.4 + Math.random() * 1.8,
          EMBERS[(Math.random() * EMBERS.length) | 0],
          true,
        )
      }
    },

    emitCrash(x, y) {
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * TAU
        const sp = 0.08 + Math.random() * 0.34
        spawn(
          x, y,
          Math.cos(a) * sp,
          Math.sin(a) * sp - 0.06,
          360 + Math.random() * 520,
          1.5 + Math.random() * 3,
          CRASH[(Math.random() * CRASH.length) | 0],
          true,
        )
      }
      shakeMag = shakeMag > 20 ? shakeMag : 20
    },

    emitPickup(x, y) {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU
        const sp = 0.12 + Math.random() * 0.04
        spawn(
          x, y,
          Math.cos(a) * sp,
          Math.sin(a) * sp,
          260 + Math.random() * 120,
          1.6 + Math.random() * 1.4,
          BOOST[(Math.random() * BOOST.length) | 0],
          true,
        )
      }
    },

    addShake(mag) {
      shakeMag = shakeMag > mag ? shakeMag : mag
    },

    update(dt) {
      const G = 0.00035 // downward gravity, px/ms^2
      for (let i = 0; i < CAP; i++) {
        const p = particles[i]
        if (p.life <= 0) continue
        p.life -= dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vy += G * dt
        // horizontal air drag (linear approximation, one mul)
        p.vx -= p.vx * 0.0016 * dt
      }
      // Exponential-ish shake decay, then jitter offsets.
      shakeMag -= shakeMag * 0.009 * dt
      if (shakeMag < 0.05) shakeMag = 0
      shake.x = (Math.random() * 2 - 1) * shakeMag
      shake.y = (Math.random() * 2 - 1) * shakeMag
    },
  }
}
