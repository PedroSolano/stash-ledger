// Som de sirene sintetizado na hora com WebAudio (sem arquivo de áudio no pacote):
// dois osciladores em quinta, varrendo a frequência para cima e para baixo ("wail").
const DURATION = 2.8 // segundos
const CYCLE = 0.7 // uma subida + descida
const LOW = 620
const HIGH = 1250
const VOLUME = 0.16

/** Toca a sirene; devolve uma função que a interrompe. */
export function playSiren(): () => void {
  let ctx: AudioContext
  try {
    ctx = new AudioContext()
  } catch {
    return () => undefined
  }
  const t0 = ctx.currentTime + 0.02
  const end = t0 + DURATION

  const master = ctx.createGain()
  master.gain.setValueAtTime(0, t0)
  master.gain.linearRampToValueAtTime(VOLUME, t0 + 0.08)
  master.gain.setValueAtTime(VOLUME, end - 0.35)
  master.gain.linearRampToValueAtTime(0, end)

  // Tira a aspereza da onda quadrada.
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = 2600
  tone.connect(master)
  master.connect(ctx.destination)

  const oscs = [
    { type: 'square' as OscillatorType, mul: 1, gain: 0.55 },
    { type: 'sawtooth' as OscillatorType, mul: 1.5, gain: 0.3 }
  ].map(({ type, mul, gain }) => {
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(LOW * mul, t0)
    for (let t = t0; t < end; t += CYCLE) {
      o.frequency.linearRampToValueAtTime(HIGH * mul, Math.min(end, t + CYCLE * 0.55))
      o.frequency.linearRampToValueAtTime(LOW * mul, Math.min(end, t + CYCLE))
    }
    const g = ctx.createGain()
    g.gain.value = gain
    o.connect(g).connect(tone)
    o.start(t0)
    o.stop(end + 0.05)
    return o
  })

  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    oscs.forEach((o) => {
      try {
        o.stop()
      } catch {
        /* já parou */
      }
    })
    void ctx.close()
  }
  oscs[0].onended = close
  return close
}
