// Gera o ícone do Exile's Companion (arte própria): losango duplo dourado com um "E" serifado.
// Uso: npm i --no-save @resvg/resvg-js && node scripts/make-icon.mjs && npx tauri icon src-tauri/icons/source.png
import { writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'

const S = 1024
const C = S / 2

// "E" serifado montado com retângulos (sem depender de fonte instalada).
const E = [
  // haste
  [418, 330, 66, 364],
  // serifas da haste (esquerda, em cima e embaixo)
  [392, 330, 40, 44],
  [392, 650, 40, 44],
  // braço de cima + serifa
  [418, 330, 220, 50],
  [604, 330, 34, 98],
  // braço do meio + serifas
  [484, 488, 128, 46],
  [588, 462, 24, 98],
  // braço de baixo + serifa
  [418, 644, 232, 50],
  [616, 596, 34, 98]
]
  .map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`)
  .join('')

const diamond = (r) => `${C},${C - r} ${C + r},${C} ${C},${C + r} ${C - r},${C}`

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#211a12"/><stop offset="1" stop-color="#090705"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f6e2a8"/><stop offset=".45" stop-color="#c9a24f"/><stop offset="1" stop-color="#7a5524"/>
    </linearGradient>
    <linearGradient id="goldE" gradientUnits="userSpaceOnUse" x1="0" y1="330" x2="0" y2="694">
      <stop offset="0" stop-color="#fff0c4"/><stop offset=".55" stop-color="#d9b462"/><stop offset="1" stop-color="#8f6630"/>
    </linearGradient>
    <radialGradient id="glow" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#d9a441" stop-opacity=".28"/><stop offset="1" stop-color="#d9a441" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>
  </defs>
  <rect x="24" y="24" width="${S - 48}" height="${S - 48}" rx="190" fill="url(#bg)"/>
  <rect x="40" y="40" width="${S - 80}" height="${S - 80}" rx="176" fill="none" stroke="#5a4528" stroke-width="6"/>
  <circle cx="${C}" cy="${C}" r="360" fill="url(#glow)"/>
  <polygon points="${diamond(392)}" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="44" filter="url(#soft)"/>
  <polygon points="${diamond(392)}" fill="#120d08" stroke="url(#gold)" stroke-width="34" stroke-linejoin="miter"/>
  <polygon points="${diamond(330)}" fill="none" stroke="url(#gold)" stroke-width="10" stroke-opacity=".85"/>
  <g fill="#000" fill-opacity=".6" transform="translate(6,8)" filter="url(#soft)">${E}</g>
  <g fill="url(#goldE)">${E}</g>
</svg>`

writeFileSync(new URL('../src-tauri/icons/source.svg', import.meta.url), svg)
const png = new Resvg(svg, { fitTo: { mode: 'width', value: S } }).render().asPng()
writeFileSync(new URL('../src-tauri/icons/source.png', import.meta.url), png)
console.log(`source.png: ${png.length} bytes`)
