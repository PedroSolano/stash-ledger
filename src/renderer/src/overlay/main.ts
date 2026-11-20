import '@fontsource/cinzel/latin-700.css'
import '@fontsource/alegreya-sc/latin-500.css'
import '@fontsource/alegreya-sans/latin-500.css'
import '../game.css'
import './overlay.css'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { DropAlert } from '../../../shared/types'
import { valueIsObvious } from '../../../core/alerts'
import { num, price, rarityClass } from '../lib/format'
import { playSiren } from './siren'

// Overlay da sirene: mostra o alerta por alguns segundos e pede ao Rust para fechar a janela.
const SHOW_MS = 8000
const FADE_MS = 450

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const root = $<HTMLDivElement>('alert')
let hideTimer: ReturnType<typeof setTimeout> | null = null
let stopSound: (() => void) | null = null

function render(a: DropAlert): void {
  const [top, ...rest] = a.items
  if (!top) return
  $('tag').textContent = a.test ? 'Test alert' : a.items.length > 1 ? 'Valuable drops' : 'Valuable drop'

  const name = $('name')
  name.textContent = top.quantity > 1 ? `${num(top.quantity)} × ${top.name}` : top.name
  name.className = `name ${rarityClass(top.frameType)}`

  const icon = $<HTMLImageElement>('icon')
  icon.hidden = !top.icon
  if (top.icon) icon.src = top.icon

  const detail = $('detail')
  detail.textContent = top.detail ?? ''
  detail.hidden = !top.detail

  const each = top.quantity > 1 ? ` (${price(top.unitChaos, a.divineChaos)} each)` : ''
  const value = $('value')
  value.textContent = `${price(top.totalChaos, a.divineChaos)}${each}`
  // Divine Orb: "1 div" não acrescenta nada ao nome.
  value.hidden = valueIsObvious(top)

  const more = $('more')
  more.hidden = rest.length === 0
  more.textContent = rest.length
    ? `+ ${rest.map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.name}` : i.name)).join(', ')} — ${price(a.totalChaos, a.divineChaos)} total`
    : ''
}

function show(a: DropAlert): void {
  render(a)
  root.hidden = false
  root.classList.remove('out')
  // Reinicia a animação de entrada a cada alerta novo.
  void root.offsetWidth
  root.classList.add('in')

  stopSound?.()
  stopSound = a.sound ? playSiren() : null

  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    root.classList.remove('in')
    root.classList.add('out')
    hideTimer = setTimeout(() => void invoke('overlay_done'), FADE_MS)
  }, SHOW_MS)
}

void listen<DropAlert>('alert', (e) => show(e.payload))
void invoke<DropAlert | null>('overlay_ready').then((a) => {
  if (a) show(a)
  else void invoke('overlay_done')
})
