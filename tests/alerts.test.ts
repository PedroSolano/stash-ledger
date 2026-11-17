import { describe, expect, it } from 'vitest'
import type { PricedItem, SnapshotDetail } from '../src/shared/types'
import { buildAlert, detectDrops, thresholdInChaos } from '../src/core/alerts'
import { defaultSettings, sanitizeSettings } from '../src/core/settings'

const DIV = 140

function item(key: string, unitChaos: number, quantity: number, tabs = ['Dump'], counted = true): PricedItem {
  return { key, name: key, typeLine: key, icon: '', frameType: 3, quantity, unitChaos, totalChaos: unitChaos * quantity, counted, tabs }
}

function snap(items: PricedItem[], tabNames = ['Dump', 'Currency'], league = 'Covens'): SnapshotDetail {
  return {
    id: 'x',
    takenAt: 0,
    league,
    totalChaos: 0,
    divineChaos: DIV,
    itemCount: items.length,
    pricedCount: items.length,
    tabs: tabNames.map((name) => ({ id: name, name, chaos: 0, itemCount: 0 })),
    items,
    pricesUpdatedAt: null
  }
}

describe('detecção de drops caros', () => {
  it('avisa item novo acima do limite e ignora os baratos', () => {
    const prev = snap([item('Chaos Orb', 1, 300, ['Currency'])])
    const next = snap([item('Chaos Orb', 1, 320, ['Currency']), item('Headhunter', 100 * DIV, 1), item('Kaom', 20, 1)])
    const drops = detectDrops(prev, next, DIV)
    expect(drops.map((d) => d.name)).toEqual(['Headhunter'])
  })

  it('conta só o que aumentou numa pilha (divines: 12 → 14 avisa 2)', () => {
    const prev = snap([item('Divine Orb', DIV, 12, ['Currency'])])
    const next = snap([item('Divine Orb', DIV, 14, ['Currency'])])
    const [d] = detectDrops(prev, next, DIV)
    expect(d.quantity).toBe(2)
    expect(d.totalChaos).toBe(2 * DIV)
    expect(detectDrops(next, prev, DIV)).toEqual([])
  })

  it('não avisa no primeiro snapshot, em liga diferente nem em aba recém-acompanhada', () => {
    const next = snap([item('Mageblood', 110 * DIV, 1, ['NewTab'])], ['Dump', 'NewTab'])
    expect(detectDrops(null, next, DIV)).toEqual([])
    expect(detectDrops(snap([], ['Dump'], 'Standard'), snap([item('X', 5 * DIV, 1)]), DIV)).toEqual([])
    expect(detectDrops(snap([], ['Dump']), next, DIV)).toEqual([])
  })

  it('valor mínimo em qualquer moeda vira chaos pela cotação atual', () => {
    const rates = { divine: 150, exalted: 12 }
    expect(thresholdInChaos(1, 'divine', rates)).toBe(150)
    expect(thresholdInChaos(50, 'chaos', rates)).toBe(50)
    expect(thresholdInChaos(5, 'exalted', rates)).toBe(60)
    // Sem cotação da moeda: não dispara (em vez de usar um valor errado).
    expect(thresholdInChaos(5, 'exalted', { divine: 150 })).toBeNull()
    expect(thresholdInChaos(0, 'chaos', rates)).toBeNull()
  })

  it('configuração antiga (alertThresholdDiv) vira valor em divine', () => {
    const d = defaultSettings()
    expect([d.alertThreshold, d.alertCurrency]).toEqual([1, 'divine'])
    const old = sanitizeSettings({ alertThresholdDiv: 2.5 } as never, d)
    expect([old.alertThreshold, old.alertCurrency]).toEqual([2.5, 'divine'])
    const chaos = sanitizeSettings({ alertThreshold: 80, alertCurrency: 'chaos' }, d)
    expect([chaos.alertThreshold, chaos.alertCurrency]).toEqual([80, 'chaos'])
    expect(sanitizeSettings({ alertCurrency: 'mirror' as never }, d).alertCurrency).toBe('divine')
    expect(sanitizeSettings({ alertThreshold: -3 }, d).alertThreshold).toBe(1)
  })

  it('ignora preço de baixa confiança e ordena pelo valor', () => {
    const prev = snap([])
    const next = snap([item('Weird base', 50 * DIV, 1, ['Dump'], false), item('A', 2 * DIV, 1), item('B', 9 * DIV, 1)])
    expect(detectDrops(prev, next, DIV).map((d) => d.name)).toEqual(['B', 'A'])
    const alert = buildAlert(detectDrops(prev, next, DIV), DIV, true)
    expect(alert.totalChaos).toBe(11 * DIV)
  })
})
