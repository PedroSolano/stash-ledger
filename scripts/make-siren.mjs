// Gera src/renderer/public/siren.gif: sirene giratória original, desenhada quadro a quadro.
// Uso: npm i --no-save gifenc && node scripts/make-siren.mjs
import { writeFileSync } from 'node:fs'
import gifenc from 'gifenc'

const { GIFEncoder, quantize, applyPalette } = gifenc
const W = 160
const H = 160
const FRAMES = 16
const SS = 3 // supersampling por eixo (suavização)
// Fundo do cartão do overlay (#120d08). O GIF é opaco nessa cor: GIF só tem transparência de
// 1 bit, então feixes e brilho ficariam com borda escura por cima do jogo.
const BG = [18, 13, 8]

const clamp = (x) => Math.max(0, Math.min(1, x))
const mix = (a, b, t) => a + (b - a) * t

/** Cor (RGBA 0..1) de um ponto da cena no quadro f. */
function shade(x, y, f) {
  const t = f / FRAMES
  const cx = 80
  const cy = 90 // centro da cúpula
  let r = 0
  let g = 0
  let b = 0
  let a = 0
  const over = (cr, cg, cb, ca) => {
    r = mix(r, cr, ca)
    g = mix(g, cg, ca)
    b = mix(b, cb, ca)
    a = a + ca * (1 - a)
  }

  // Feixes giratórios (dois cones opostos), mais fortes perto da cúpula.
  const ang = Math.atan2(y - cy, x - cx)
  const rot = t * Math.PI * 2
  const dist = Math.hypot(x - cx, y - cy)
  for (const off of [0, Math.PI]) {
    let d = Math.abs(((ang - rot - off + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
    const beam = Math.pow(clamp(1 - d / 0.55), 1.4) * clamp(1.15 - dist / 95) * (y < cy + 22 ? 1 : 0)
    if (beam > 0) over(1, 0.45 * beam, 0.18 * beam, clamp(beam * 1.1))
  }

  // Halo pulsante.
  const pulse = 0.55 + 0.45 * Math.sin(t * Math.PI * 4)
  const halo = clamp(1 - Math.abs(dist - 40) / 22) * 0.35 * pulse
  if (halo > 0 && y < cy + 22) over(1, 0.35, 0.15, halo)

  // Cúpula (semicírculo vermelho) com reflexo e brilho girando.
  if (y <= cy + 22 && dist <= 36 && y >= cy - 36) {
    const lit = 0.55 + 0.45 * Math.max(0, Math.cos(ang - rot)) + 0.2 * pulse
    over(clamp(0.75 * lit + 0.15), clamp(0.08 * lit), clamp(0.06 * lit), 1)
    // reflexo branco fixo
    if (Math.hypot(x - (cx - 13), y - (cy - 14)) < 7) over(1, 0.92, 0.85, 0.75)
    // núcleo (lâmpada)
    const core = clamp(1 - Math.hypot(x - cx, y - (cy + 6)) / 13)
    if (core > 0) over(1, 0.85, 0.55, core * (0.6 + 0.4 * pulse))
  }

  // Base metálica com friso dourado.
  if (y > cy + 20 && y <= cy + 40 && Math.abs(x - cx) <= 46 - (y - cy - 20) * 0.35) {
    const edge = y <= cy + 23 ? 1 : 0
    if (edge) over(0.85, 0.66, 0.36, 1)
    else {
      const v = 0.18 + 0.12 * (1 - (y - cy - 20) / 20)
      over(v, v * 0.9, v * 0.8, 1)
    }
  }
  return [r, g, b, a]
}

const gif = GIFEncoder()
for (let f = 0; f < FRAMES; f++) {
  const rgba = new Uint8Array(W * H * 4)
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = shade(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS, f)
          r += c[0] * c[3]
          g += c[1] * c[3]
          b += c[2] * c[3]
          a += c[3]
        }
      }
      const n = SS * SS
      const alpha = a / n
      const i = (py * W + px) * 4
      // Mistura com o fundo do cartão.
      const cr = a ? r / a : 0
      const cg = a ? g / a : 0
      const cb = a ? b / a : 0
      rgba[i] = Math.round(mix(BG[0], cr * 255, alpha))
      rgba[i + 1] = Math.round(mix(BG[1], cg * 255, alpha))
      rgba[i + 2] = Math.round(mix(BG[2], cb * 255, alpha))
      rgba[i + 3] = 255
    }
  }
  const palette = quantize(rgba, 128)
  const index = applyPalette(rgba, palette)
  gif.writeFrame(index, W, H, { palette, delay: 55 })
}
gif.finish()
const out = new URL('../src/renderer/public/siren.gif', import.meta.url)
writeFileSync(out, gif.bytes())
console.log(`siren.gif: ${gif.bytes().length} bytes, ${FRAMES} frames`)
