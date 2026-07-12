export interface Audio {
  setEngine(rpm: number, on: boolean): void
  thud(mag: number): void
  ping(): void
  crash(): void
  boost(): void
}

let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
  }
  // Autoplay policies suspend contexts created (or left) outside a gesture.
  if (audioCtx.state === 'suspended') void audioCtx.resume()
  return audioCtx
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
  let engineOsc: OscillatorNode | null = null
  let engineGain: GainNode | null = null
  let engineFilter: BiquadFilterNode | null = null

  // Lazy master gain: nothing touches the AudioContext until first playback,
  // which only happens after gameplay input (i.e. after a user gesture).
  let master: GainNode | null = null
  function getMaster(): GainNode {
    const ctx = getAudioContext()
    if (!master) {
      master = ctx.createGain()
      master.gain.value = 0.25
      master.connect(ctx.destination)
    }
    return master
  }

  function initEngine() {
    if (engineOsc) return
    const ctx = getAudioContext()

    engineOsc = ctx.createOscillator()
    engineOsc.type = 'sawtooth'
    engineOsc.frequency.value = 100

    engineGain = ctx.createGain()
    engineGain.gain.value = 0.1

    engineFilter = ctx.createBiquadFilter()
    engineFilter.type = 'lowpass'
    engineFilter.frequency.value = 800

    engineOsc.connect(engineFilter)
    engineFilter.connect(engineGain)
    engineGain.connect(getMaster())

    engineOsc.start()
  }

  function stopEngine() {
    if (engineOsc) {
      try {
        engineOsc.stop()
      } catch {
        // Already stopped
      }
      engineOsc = null
      engineGain = null
      engineFilter = null
    }
  }

  return {
    setEngine(rpm: number, on: boolean) {
      if (on) {
        initEngine()
        if (!engineOsc || !engineGain || !engineFilter) return

        // rpm 0..1 maps to pitch 100..400 Hz and gain 0..0.15
        const pitchHz = 100 + rpm * 300
        const gainVal = rpm * 0.15

        engineOsc.frequency.setTargetAtTime(pitchHz, audioCtx?.currentTime ?? 0, 0.1)
        engineGain.gain.setTargetAtTime(gainVal, audioCtx?.currentTime ?? 0, 0.05)
        engineFilter.frequency.setTargetAtTime(800 + rpm * 400, audioCtx?.currentTime ?? 0, 0.15)
      } else {
        stopEngine()
      }
    },

    thud(mag: number) {
      const ctx = getAudioContext()
      const now = ctx.currentTime

      const noise = ctx.createBufferSource()
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1
      }
      noise.buffer = buffer
      noise.loop = false

      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 200

      const gain = ctx.createGain()
      gain.gain.setValueAtTime(mag * 0.3, now)
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15)

      noise.connect(filter)
      filter.connect(gain)
      gain.connect(getMaster())

      noise.start(now)
      noise.stop(now + 0.15)
    },

    ping() {
      const ctx = getAudioContext()
      const now = ctx.currentTime

      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(800, now)
      osc.frequency.exponentialRampToValueAtTime(400, now + 0.1)

      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.2, now)
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1)

      osc.connect(gain)
      gain.connect(getMaster())

      osc.start(now)
      osc.stop(now + 0.1)
    },

    crash() {
      const ctx = getAudioContext()
      const now = ctx.currentTime

      // Noise burst
      const noise = ctx.createBufferSource()
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1
      }
      noise.buffer = buffer
      noise.loop = false

      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.4, now)
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3)

      noise.connect(gain)
      gain.connect(getMaster())

      noise.start(now)
      noise.stop(now + 0.3)
    },

    boost() {
      const ctx = getAudioContext()
      const now = ctx.currentTime

      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(200, now)
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.3)

      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(400, now)
      filter.frequency.exponentialRampToValueAtTime(1200, now + 0.3)

      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.2, now)
      gain.gain.exponentialRampToValueAtTime(0.05, now + 0.3)

      osc.connect(filter)
      filter.connect(gain)
      gain.connect(getMaster())

      osc.start(now)
      osc.stop(now + 0.3)
    },
  }
}
