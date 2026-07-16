// Tiny synthesized sound effects — no audio assets needed.

let ctx: AudioContext | null = null

function audio(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function yip(when: number, startFreq: number): void {
  const ac = audio()
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(startFreq, when)
  osc.frequency.exponentialRampToValueAtTime(startFreq * 0.35, when + 0.09)
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(0.25, when + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.11)
  osc.connect(gain).connect(ac.destination)
  osc.start(when)
  osc.stop(when + 0.12)
}

/**
 * One "woof": a sawtooth with a fast up-down pitch arc, shaped by a sweeping
 * bandpass formant (the opening-closing mouth), plus a breathy noise layer.
 */
function woof(when: number, base: number): void {
  const ac = audio()

  const osc = ac.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(base * 0.55, when)
  osc.frequency.exponentialRampToValueAtTime(base, when + 0.03)
  osc.frequency.exponentialRampToValueAtTime(base * 0.5, when + 0.15)

  const formant = ac.createBiquadFilter()
  formant.type = 'bandpass'
  formant.Q.value = 2.2
  formant.frequency.setValueAtTime(450, when)
  formant.frequency.exponentialRampToValueAtTime(1350, when + 0.045)
  formant.frequency.exponentialRampToValueAtTime(420, when + 0.15)

  const gain = ac.createGain()
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(0.55, when + 0.012)
  gain.gain.setValueAtTime(0.55, when + 0.055)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.17)

  osc.connect(formant).connect(gain).connect(ac.destination)
  osc.start(when)
  osc.stop(when + 0.2)

  // Breath layer
  const dur = 0.12
  const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  }
  const noise = ac.createBufferSource()
  noise.buffer = buffer
  const noiseBp = ac.createBiquadFilter()
  noiseBp.type = 'bandpass'
  noiseBp.Q.value = 1
  noiseBp.frequency.setValueAtTime(900, when)
  noiseBp.frequency.exponentialRampToValueAtTime(1600, when + 0.04)
  const noiseGain = ac.createGain()
  noiseGain.gain.setValueAtTime(0.0001, when)
  noiseGain.gain.exponentialRampToValueAtTime(0.12, when + 0.01)
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + dur)
  noise.connect(noiseBp).connect(noiseGain).connect(ac.destination)
  noise.start(when)
}

export function bark(): void {
  const t = audio().currentTime
  const pitch = 440 + Math.random() * 70 // vary so repeated barks don't loop
  woof(t, pitch)
  woof(t + 0.18, pitch * 0.92)
}

export function jumpYip(): void {
  yip(audio().currentTime, 700)
}

/** Crunchy kibble bite: two quick filtered noise snaps. */
export function crunch(): void {
  const ac = audio()
  for (const offset of [0, 0.07]) {
    const t = ac.currentTime + offset
    const dur = 0.05
    const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 0.5
    }
    const src = ac.createBufferSource()
    src.buffer = buffer
    const bp = ac.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 2400 + offset * 4000
    bp.Q.value = 0.8
    const gain = ac.createGain()
    gain.gain.setValueAtTime(0.16, t)
    gain.gain.exponentialRampToValueAtTime(0.01, t + dur)
    src.connect(bp).connect(gain).connect(ac.destination)
    src.start(t)
  }
}

/** Watery splash: lowpassed noise burst plus a little bloop. */
export function splashSound(intensity: number): void {
  const ac = audio()
  const t = ac.currentTime
  const dur = 0.35
  const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 1.5
  }
  const src = ac.createBufferSource()
  src.buffer = buffer
  const lp = ac.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 900
  const gain = ac.createGain()
  gain.gain.setValueAtTime(0.1 + 0.2 * Math.min(1, intensity), t)
  gain.gain.exponentialRampToValueAtTime(0.01, t + dur)
  src.connect(lp).connect(gain).connect(ac.destination)
  src.start(t)

  const bloop = ac.createOscillator()
  const bg = ac.createGain()
  bloop.type = 'sine'
  bloop.frequency.setValueAtTime(300, t)
  bloop.frequency.exponentialRampToValueAtTime(90, t + 0.18)
  bg.gain.setValueAtTime(0.0001, t)
  bg.gain.exponentialRampToValueAtTime(0.12, t + 0.02)
  bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.2)
  bloop.connect(bg).connect(ac.destination)
  bloop.start(t)
  bloop.stop(t + 0.22)
}

/** Soft contented sigh when the puppy snuggles down. */
export function sigh(): void {
  const ac = audio()
  const t = ac.currentTime
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(340, t)
  osc.frequency.exponentialRampToValueAtTime(180, t + 0.5)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(0.07, t + 0.08)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55)
  osc.connect(gain).connect(ac.destination)
  osc.start(t)
  osc.stop(t + 0.6)
}

/** Bright noise burst for shattering glass. */
export function glassBreak(): void {
  const ac = audio()
  const t = ac.currentTime
  const dur = 0.25
  const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2
  }
  const src = ac.createBufferSource()
  src.buffer = buffer
  const hp = ac.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 2800
  const gain = ac.createGain()
  gain.gain.setValueAtTime(0.3, t)
  gain.gain.exponentialRampToValueAtTime(0.01, t + dur)
  src.connect(hp).connect(gain).connect(ac.destination)
  src.start(t)
}

/** Low thump when something gets knocked over. Intensity 0..1. */
export function thud(intensity: number): void {
  const ac = audio()
  const t = ac.currentTime
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(110, t)
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.15)
  const vol = 0.08 + 0.25 * Math.min(1, intensity)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
  osc.connect(gain).connect(ac.destination)
  osc.start(t)
  osc.stop(t + 0.25)
}
