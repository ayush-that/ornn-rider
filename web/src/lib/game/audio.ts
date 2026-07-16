// Sample-based audio: CC0 sound files from public/sfx (see LICENSE.md there).
// Buffers are fetched/decoded lazily after the first user gesture; the API is
// safe to call before that (calls are cheap no-ops until buffers arrive).
export interface Audio {
  setEngine(rpm: number, on: boolean): void
  thud(mag: number): void
  ping(): void
  coin(): void
  crash(): void
  boost(): void
  finish(): void
}

const FILES = {
  engine: '/sfx/engine.ogg',
  thud: '/sfx/thud.ogg',
  coin: '/sfx/coin.ogg',
  ping: '/sfx/ping.ogg',
  crash: '/sfx/crash.ogg',
  boost: '/sfx/nitro.ogg',
  finish: '/sfx/finish.ogg',
} as const
type Sfx = keyof typeof FILES

let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  }
  // Autoplay policies suspend contexts created (or left) outside a gesture.
  if (audioCtx.state === 'suspended') void audioCtx.resume()
  return audioCtx
}

const buffers: Partial<Record<Sfx, AudioBuffer>> = {}
let loadStarted = false
function loadBuffers(): void {
  if (loadStarted) return
  loadStarted = true
  const ctx = getAudioContext()
  for (const key of Object.keys(FILES) as Sfx[]) {
    void fetch(FILES[key])
      .then((r) => r.arrayBuffer())
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => {
        buffers[key] = buf
      })
      .catch(() => {
        /* missing file -> that sound stays silent */
      })
  }
}

// Create/resume the context and start decoding from inside real user gestures
// so browsers (Safari/iOS especially) let it run. Kept permanently: cheap, and
// it also recovers from re-suspension after tab backgrounding.
function unlock(): void {
  getAudioContext()
  loadBuffers()
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

  // One-shot player. Returns the source so callers can keep a handle.
  function play(key: Sfx, gain: number, rate = 1): AudioBufferSourceNode | null {
    const buf = buffers[key]
    if (!buf) {
      loadBuffers()
      return null
    }
    const ctx = getAudioContext()
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = rate
    const g = ctx.createGain()
    g.gain.value = gain
    src.connect(g)
    g.connect(getMaster())
    src.start()
    return src
  }

  // --- engine: looped sample, pitch/gain follow rpm -------------------------
  let engineSrc: AudioBufferSourceNode | null = null
  let engineGain: GainNode | null = null

  function stopEngine(): void {
    if (engineSrc) {
      try {
        engineSrc.stop()
      } catch {
        /* already stopped */
      }
      engineSrc = null
      engineGain = null
    }
  }

  // --- boost: at most one whoosh at a time, faded out on retrigger overlap --
  let boostUntil = 0

  return {
    setEngine(rpm: number, on: boolean) {
      if (!on) {
        stopEngine()
        return
      }
      const buf = buffers.engine
      if (!buf) {
        loadBuffers()
        return
      }
      const ctx = getAudioContext()
      if (!engineSrc) {
        engineSrc = ctx.createBufferSource()
        engineSrc.buffer = buf
        engineSrc.loop = true
        engineGain = ctx.createGain()
        engineGain.gain.value = 0
        engineSrc.connect(engineGain)
        engineGain.connect(getMaster())
        engineSrc.start()
      }
      // rpm 0..1 -> playbackRate 0.6..1.8, gain 0.05..0.4
      engineSrc.playbackRate.setTargetAtTime(0.6 + rpm * 1.2, ctx.currentTime, 0.08)
      engineGain!.gain.setTargetAtTime(0.05 + rpm * 0.35, ctx.currentTime, 0.05)
    },

    thud(mag: number) {
      play('thud', Math.min(mag, 1.2) * 0.8, 0.9 + Math.min(mag, 1) * 0.2)
    },

    ping() {
      play('ping', 0.5)
    },

    coin() {
      play('coin', 0.5)
    },

    crash() {
      play('crash', 0.9)
    },

    boost() {
      const ctx = audioCtx
      const now = ctx ? ctx.currentTime : 0
      if (now < boostUntil) return // still whooshing, don't stack
      const src = play('boost', 0.45, 1.15)
      if (src && ctx) {
        boostUntil = now + 2 // sample is 5s; cut it short to match the tank
        src.stop(now + 2)
      }
    },

    finish() {
      play('finish', 0.6)
    },
  }
}
