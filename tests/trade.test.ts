import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  identifyAs,
  isStatFilter,
  ItemRarity,
  loadTradeData,
  prepareCheck,
  searchKind,
  setTradeTransport,
  searchTrade,
  uniqueCandidates,
  type PreparedCheck
} from '../src/trade'

// Usa os dados reais do Awakened (src/renderer/public/trade-data), como a janela do price check.
beforeAll(() => {
  const dir = new URL('../src/renderer/public/trade-data/', import.meta.url)
  loadTradeData({
    stats: readFileSync(new URL('stats.ndjson', dir), 'utf8'),
    items: readFileSync(new URL('items.ndjson', dir), 'utf8')
  })
})

const t = (...lines: string[]) => lines.join('\n')

const RING = t(
  'Item Class: Rings',
  'Rarity: Rare',
  'Doom Loop',
  'Two-Stone Ring',
  '--------',
  'Requirements:',
  'Level: 41',
  '--------',
  'Item Level: 80',
  '--------',
  '{ Implicit Modifier — Elemental, Cold, Lightning, Resistance }',
  '+14(12-16)% to Cold and Lightning Resistances',
  '--------',
  '{ Prefix Modifier "Fecund" (Tier: 2) — Life }',
  '+65(60-69) to maximum Life',
  '{ Suffix Modifier "of the Ice" (Tier: 3) — Elemental, Cold, Resistance }',
  '+38(36-41)% to Cold Resistance',
  '{ Suffix Modifier "of the Lightning" (Tier: 4) — Elemental, Lightning, Resistance }',
  '+30(30-35)% to Lightning Resistance'
)

function prep(text: string): PreparedCheck {
  const r = prepareCheck(text, { league: 'Keepers' })
  if ('error' in r) throw new Error(r.error)
  return r
}

describe('busca na trade (código do Awakened)', () => {
  it('raro: mods viram filtros com ids da trade, faixa de 10% e pseudo de resistência', () => {
    const { item, presets, active } = prep(RING)
    expect(item.rarity).toBe(ItemRarity.Rare)
    expect(item.itemLevel).toBe(80)
    const preset = presets.find((p) => p.id === active)!
    const stats = preset.stats.filter(isStatFilter)
    // Como o Awakened em raros: vida e resistências viram os pseudo "total", ligados, com mínimo ~10% abaixo.
    const life = stats.find((s) => s.tradeId.includes('pseudo.pseudo_total_life'))
    expect(life).toMatchObject({ disabled: false, roll: { value: 65 } })
    expect(Number(life?.roll?.min)).toBeLessThan(65)
    const res = stats.find((s) => s.tradeId.includes('pseudo.pseudo_total_elemental_resistance'))
    expect(res?.roll?.value).toBe(14 * 2 + 38 + 30)
    expect(res?.disabled).toBe(false)
    expect(searchKind(item, preset)).toBe('trade')
    expect(preset.filters.trade.league).toBe('Keepers')
  })

  it('monta a consulta e lê os anúncios pela ponte com o backend', async () => {
    const { presets, active } = prep(RING)
    const preset = presets.find((p) => p.id === active)!
    let body: { query: { status: { option: string }; stats: unknown[] } } | undefined
    setTradeTransport({
      search: async (_league, b) => {
        body = b as typeof body
        return { id: 'Q1', result: ['a', 'b'], total: 2 }
      },
      fetch: async (ids, q) => ({
        result: ids.map((id) => ({
          id,
          item: { ilvl: 80 },
          listing: {
            indexed: new Date(Date.now() - 120_000).toISOString(),
            price: { amount: 3, currency: 'divine', type: '~price' },
            account: { name: `acc-${q}`, lastCharacterName: 'Char', online: {} }
          }
        }))
      }),
      exchange: async () => ({})
    })
    const res = await searchTrade(preset.filters, preset.stats)
    expect(body?.query.status.option).toBe('securable')
    expect(body?.query.stats.length).toBeGreaterThan(0)
    expect(res.total).toBe(2)
    expect(res.listings.map((l) => [l.priceAmount, l.priceCurrency, l.accountStatus])).toEqual([
      [3, 'divine', 'online'],
      [3, 'divine', 'online']
    ])
    expect(res.listings[0].relativeDate).toBe('2 min. ago')
    expect(res.url).toBe('https://www.pathofexile.com/trade/search/Keepers/Q1')
  })

  it('único não identificado: lista os únicos da base e identifica o escolhido', () => {
    const { item } = prep(t('Item Class: Belts', 'Rarity: Unique', 'Leather Belt', '--------', 'Item Level: 84', '--------', 'Unidentified'))
    const cands = uniqueCandidates(item)
    expect(cands.map((c) => c.refName)).toContain('Headhunter')
    const hh = identifyAs(cands.find((c) => c.refName === 'Headhunter')!, item)
    expect(hh.info.refName).toBe('Headhunter')
  })

  it('currency vai para a troca em massa (bulk)', () => {
    const { item, presets, active } = prep(t('Item Class: Stackable Currency', 'Rarity: Currency', 'Divine Orb', '--------', 'Stack Size: 3/20'))
    expect(searchKind(item, presets.find((p) => p.id === active)!)).toBe('bulk')
  })
})
