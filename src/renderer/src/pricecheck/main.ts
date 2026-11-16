import '@fontsource/cinzel/latin-700.css'
import '@fontsource/alegreya-sc/latin-500.css'
import '@fontsource/alegreya-sans/latin-400.css'
import '@fontsource/alegreya-sans/latin-500.css'
import './pricecheck.css'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { PriceCheckResult } from '../../../shared/types'
import { ago, categoryLabel, chaosText, num, price, rarityClass } from '../lib/format'

// Janelinha do price check: desenha o resultado e pede ao Rust para mostrá-la (sem foco).
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

function text(id: string, value: string | undefined): void {
  const el = $(id)
  el.textContent = value ?? ''
  el.hidden = !value
}

function render(r: PriceCheckResult): void {
  const name = $('name')
  name.textContent = r.quantity > 1 ? `${num(r.quantity)} × ${r.name}` : r.name
  name.className = `pc-name ${r.ok ? rarityClass(r.frameType) : 'r-normal'}`
  text('base', r.base)

  const icon = $<HTMLImageElement>('icon')
  icon.hidden = !r.icon
  if (r.icon) icon.src = r.icon

  const priced = r.ok && r.unitChaos !== undefined
  const div = r.divineChaos
  if (priced) {
    const total = r.totalChaos ?? r.unitChaos!
    text('price', `${r.approximate ? '≈ ' : ''}${price(total, div)}`)
    const parts: string[] = []
    if (r.quantity > 1) parts.push(`${price(r.unitChaos!, div)} each`)
    if (div && total >= div) parts.push(chaosText(total))
    else if (div) parts.push(`${num(total / div, 3)} div`)
    text('sub', parts.join(' · '))
  } else {
    text('price', undefined)
    text('sub', undefined)
  }

  const tags = $('tags')
  tags.replaceChildren()
  const tag = (label: string, cls = ''): void => {
    const s = document.createElement('span')
    s.className = `pc-tag ${cls}`
    s.textContent = label
    tags.appendChild(s)
  }
  if (priced) {
    if (r.detail) tag(r.detail)
    if (r.category) tag(categoryLabel(r.category))
    if (r.confidence === 'low') tag('low confidence', 'warn')
    if (r.approximate) tag('closest match', 'warn')
  }
  tags.hidden = !tags.childElementCount

  text('msg', priced ? undefined : r.message)
  text(
    'foot',
    r.league ? `poe.ninja · ${r.league}${r.pricesUpdatedAt ? ` · updated ${ago(r.pricesUpdatedAt)}` : ''}` : undefined
  )

  $('card').hidden = false
  // Reinicia a animação de entrada.
  const card = $('card')
  card.classList.remove('in')
  void card.offsetWidth
  card.classList.add('in')
  void invoke('pricecheck_visible')
}

void listen<PriceCheckResult>('price', (e) => render(e.payload))
void invoke<PriceCheckResult | null>('pricecheck_ready').then((r) => {
  if (r) render(r)
})
