import { describe, expect, it } from 'vitest'
import type { PricedItem, SnapshotDetail } from '../src/shared/types'
import { buildAlert, detectDrops } from '../src/core/alerts'

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

  it('ignora preço de baixa confiança e ordena pelo valor', () => {
    const prev = snap([])
    const next = snap([item('Weird base', 50 * DIV, 1, ['Dump'], false), item('A', 2 * DIV, 1), item('B', 9 * DIV, 1)])
    expect(detectDrops(prev, next, DIV).map((d) => d.name)).toEqual(['B', 'A'])
    const alert = buildAlert(detectDrops(prev, next, DIV), DIV, true)
    expect(alert.totalChaos).toBe(11 * DIV)
  })
})
