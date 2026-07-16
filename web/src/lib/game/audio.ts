// Fully synthesized WebAudio: no asset files. Every sound is built from
// oscillators and filtered noise on a shared AudioContext, created lazily on
// the first user gesture. The API is safe to call before that (calls are cheap
// no-ops until the context exists). Master gain ~0.4; every node ramps its gain
// to avoid clicks and self-disconnects on `ended` so nothing hangs.
export interface Audio {
  setEngine(rpm: number, on: boolean): void
  thud(mag: number): void
  ping(): void
  coin(): void
  crash(): void
  boost(): void
  boostStop(): void
  finish(): void
  // Micro-interactions (wired into the game in a later pass).
  pickup(value: number): void
  canister(): void
  flip(): void
  land(bonus: number): void
  streak(level: number): void
  combo(): void
}

let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  }
  // Autoplay policies suspend contexts created (or left) outside a gesture.
  if (audioCtx.state === 'suspended') void audioCtx.resume()
  return audioCtx
}

// One shared white-noise buffer, built once and reused by every noisy voice
// (thud/crash/canister/flip). Keeps note triggers allocation-light.
let noiseBuffer: AudioBuffer | null = null
function getNoise(ctx: AudioContext): AudioBuffer {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    const len = Math.floor(ctx.sampleRate * 1) // 1s of noise, looped as needed
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  }
  return noiseBuffer
}

// Create/resume the context from inside real user gestures so browsers
// (Safari/iOS especially) let it run. Kept permanently: cheap, and it also
// recovers from re-suspension after tab backgrounding.
function unlock(): void {
  getAudioContext()
}
window.addEventListener('pointerdown', unlock)
window.addEventListener('keydown', unlock)

export function createAudio(): Audio {
  let master: GainNode | null = null
  function getMaster(): GainNode {
    const ctx = getAudioContext()
    if (!master) {
      master = ctx.createGain()
      master.gain.value = 0.4
      master.connect(ctx.destination)
    }
    return master
  }

  // --- primitives -----------------------------------------------------------

  // A short tone with an attack/decay envelope. Auto-stops and disconnects.
  function tone(
    freq: number,
    when: number,
    dur: number,
    peak: number,
    type: OscillatorType = 'sine',
    endFreq?: number,
  ): void {
    const ctx = getAudioContext()
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, when)
    if (endFreq !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), when + dur)
    const atk = Math.min(0.008, dur * 0.3)
    g.gain.setValueAtTime(0, when)
    g.gain.linearRampToValueAtTime(peak, when + atk)
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur)
    osc.connect(g)
    g.connect(getMaster())
    osc.onended = () => {
      osc.disconnect()
      g.disconnect()
    }
    osc.start(when)
    osc.stop(when + dur + 0.02)
  }

  // A filtered noise burst (thud/crash/hiss). Auto-stops and disconnects.
  function noiseBurst(
    when: number,
    dur: number,
    peak: number,
    filterType: BiquadFilterType,
    freqStart: number,
    freqEnd: number,
    q = 1,
  ): void {
    const ctx = getAudioContext()
    const src = ctx.createBufferSource()
    src.buffer = getNoise(ctx)
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = filterType
    filter.Q.value = q
    filter.frequency.setValueAtTime(freqStart, when)
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), when + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, when)
    g.gain.linearRampToValueAtTime(peak, when + Math.min(0.006, dur * 0.2))
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur)
    src.connect(filter)
    filter.connect(g)
    g.connect(getMaster())
    src.onended = () => {
      src.disconnect()
      filter.disconnect()
      g.disconnect()
    }
    src.start(when)
    src.stop(when + dur + 0.02)
  }

  // --- engine: continuous saw + lowpass, pitch/gain follow rpm --------------
  let engineOsc: OscillatorNode | null = null
  let engineSub: OscillatorNode | null = null
  let engineFilter: BiquadFilterNode | null = null
  let engineGain: GainNode | null = null

  function stopEngine(): void {
    if (engineGain && audioCtx) {
      const t = audioCtx.currentTime
      engineGain.gain.setTargetAtTime(0, t, 0.03)
    }
    const osc = engineOsc
    const sub = engineSub
    const filter = engineFilter
    const g = engineGain
    if (osc && audioCtx) {
      const stopAt = audioCtx.currentTime + 0.12
      try {
        osc.stop(stopAt)
        sub?.stop(stopAt)
      } catch {
        /* already stopped */
      }
      osc.onended = () => {
        osc.disconnect()
        sub?.disconnect()
        filter?.disconnect()
        g?.disconnect()
      }
    }
    engineOsc = null
    engineSub = null
    engineFilter = null
    engineGain = null
  }

  // --- boost: single rising filtered saw sweep, fadeable on stop ------------
  let boostUntil = 0
  let boostOsc: OscillatorNode | null = null
  let boostFilter: BiquadFilterNode | null = null
  let boostGain: GainNode | null = null

  return {
    setEngine(rpm: number, on: boolean) {
      if (!on) {
        stopEngine()
        return
      }
      const ctx = getAudioContext()
      const now = ctx.currentTime
      if (!engineOsc) {
        engineOsc = ctx.createOscillator()
        engineOsc.type = 'sawtooth'
        engineSub = ctx.createOscillator()
        engineSub.type = 'square'
        engineFilter = ctx.createBiquadFilter()
        engineFilter.type = 'lowpass'
        engineFilter.Q.value = 6
        engineGain = ctx.createGain()
        engineGain.gain.value = 0
        engineOsc.connect(engineFilter)
        engineSub.connect(engineFilter)
        engineFilter.connect(engineGain)
        engineGain.connect(getMaster())
        engineOsc.start()
        engineSub.start()
      }
      // rpm 0..1 -> fundamental 40..140Hz, lowpass 300..2200Hz, gain 0.05..0.34
      const base = 40 + rpm * 100
      engineOsc.frequency.setTargetAtTime(base, now, 0.06)
      engineSub!.frequency.setTargetAtTime(base * 0.5, now, 0.06)
      engineFilter!.frequency.setTargetAtTime(300 + rpm * 1900, now, 0.06)
      engineGain!.gain.setTargetAtTime(0.05 + rpm * 0.29, now, 0.05)
    },

    thud(mag: number) {
      const ctx = getAudioContext()
      const now = ctx.currentTime
      const m = Math.min(mag, 1.2)
      // Low filtered noise burst + a short low body tone for the "weight".
      noiseBurst(now, 0.14 + m * 0.06, m * 0.5, 'lowpass', 500 + m * 400, 120, 1.2)
      tone(90 - m * 20, now, 0.11, m * 0.35, 'sine', 55)
    },

    ping() {
      const ctx = getAudioContext()
      tone(1400, ctx.currentTime, 0.09, 0.28, 'sine')
    },

    coin() {
      const ctx = getAudioContext()
      const now = ctx.currentTime
      // Classic two-note coin blip: quick up-step.
      tone(988, now, 0.06, 0.3, 'square')
      tone(1319, now + 0.05, 0.12, 0.3, 'square')
    },

    crash() {
      const ctx = getAudioContext()
      const now = ctx.currentTime
      // Big broadband noise burst sweeping down + a low boom underneath.
      noiseBurst(now, 0.5, 0.55, 'bandpass', 1800, 200, 0.7)
      noiseBurst(now, 0.35, 0.4, 'highpass', 3000, 1500, 0.5)
      tone(120, now, 0.4, 0.4, 'triangle', 40)
    },

    boost() {
      const ctx = getAudioContext()
      const now = ctx.currentTime
      if (now < boostUntil) return // still whooshing, don't stack
      // Rising filtered saw sweep over ~1.4s.
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(160, now)
      osc.frequency.exponentialRampToValueAtTime(900, now + 1.4)
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.Q.value = 4
      filter.frequency.setValueAtTime(400, now)
      filter.frequency.exponentialRampToValueAtTime(2600, now + 1.4)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, now)
      g.gain.linearRampToValueAtTime(0.32, now + 0.08)
      g.gain.setTargetAtTime(0.18, now + 0.4, 0.5)
      osc.connect(filter)
      filter.connect(g)
      g.connect(getMaster())
      osc.onended = () => {
        osc.disconnect()
        filter.disconnect()
        g.disconnect()
      }
      osc.start(now)
      osc.stop(now + 2)
      boostUntil = now + 2
      boostOsc = osc
      boostFilter = filter
      boostGain = g
    },

    // Cuts the whoosh the moment the boost ends (shift released / tank empty)
    // with a short fade so it doesn't click.
    boostStop() {
      if (!boostOsc || !audioCtx) return
      const t = audioCtx.currentTime
      if (boostGain) {
        boostGain.gain.cancelScheduledValues(t)
        boostGain.gain.setValueAtTime(boostGain.gain.value, t)
        boostGain.gain.linearRampToValueAtTime(0, t + 0.1)
      }
      try {
        boostOsc.stop(t + 0.12)
      } catch {
        /* already stopped */
      }
      boostOsc = null
      boostFilter = null
      boostGain = null
      boostUntil = 0
    },

    finish() {
      const ctx = getAudioContext()
      const now = ctx.currentTime
      // Ascending major arpeggio fanfare: C-E-G-C.
      const notes = [523, 659, 784, 1047]
      notes.forEach((f, i) => tone(f, now + i * 0.12, 0.3, 0.26, 'triangle'))
    },

    // --- micro-interactions ---------------------------------------------------

    pickup(value: number) {
      const ctx = getAudioContext()
      const now = ctx.currentTime
      // Pitch scales with point value; a 50 gets a tiny three-note arpeggio.
      const base = value >= 50 ? 1047 : value >= 20 ? 784 : 587
      tone(base, now, 0.09, 0.26, 'square')
      if (value >= 50) {
        tone(base * 1.26, now + 0.06, 0.08, 0.24, 'square')
        tone(base * 1.5, now + 0.12, 0.12, 0.24, 'square')
      }
    },

    canister() {
      const ctx = getAudioContext()
      const now = ctx.currentTime
      // Pressurized hiss (highpass noise decaying) + an upward chirp.
      noiseBurst(now, 0.28, 0.3, 'highpass', 2000, 6000, 0.5)
      tone(500, now + 0.04, 0.22, 0.26, 'sine', 1200)
    },

    flip() {
      const ctx = getAudioContext()
      const now = ctx.currentTime
      // Airy bandpass whoosh sweeping up + a bright tick to punctuate.
      noiseBurst(now, 0.18, 0.22, 'bandpass', 800, 3200, 3)
      tone(2000, now + 0.14, 0.05, 0.2, 'sine')
    },

    land(bonus: number) {
      const ctx = getAudioContext()
      const now = ctx.currentTime
      const w = Math.min(1, bonus / 500)
      // Satisfying cash-register "ka-ching": low thunk then a bright two-note.
      tone(180 - w * 40, now, 0.1, 0.28 + w * 0.1, 'triangle', 90)
      tone(880, now + 0.05, 0.12, 0.24, 'square')
      tone(1320, now + 0.11, 0.16, 0.24 + w * 0.06, 'square')
    },

    streak(level: number) {
      const ctx = getAudioContext()
      const now = ctx.currentTime
      // Rising blip sequence; higher level = higher pitch (level 2..5).
      const lv = Math.max(2, Math.min(5, level))
      const base = 500 + (lv - 2) * 180
      for (let i = 0; i < 3; i++) {
        tone(base * (1 + i * 0.26), now + i * 0.05, 0.08, 0.24, 'square')
      }
    },

    combo() {
      const ctx = getAudioContext()
      const now = ctx.currentTime
      // Triumphant two-note fifth stab (root + fifth), bright and short.
      tone(659, now, 0.18, 0.28, 'sawtooth')
      tone(988, now, 0.22, 0.24, 'sawtooth')
      tone(659, now + 0.12, 0.16, 0.22, 'triangle')
    },
  }
}
