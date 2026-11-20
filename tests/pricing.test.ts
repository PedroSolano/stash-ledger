import { describe, expect, it } from 'vitest'
import type { PoeItem } from '../src/shared/types'
import type { CompactPrices, ItemLine } from '../src/core/pricing/ninja'
import { PriceIndex } from '../src/core/pricing/priceIndex'
import { DEFAULT_PRICING, maxLinks, priceItem, valueItems } from '../src/core/pricing/priceItem'

const line = (l: Partial<ItemLine> & { name: string; chaosValue: number }): ItemLine => ({ listingCount: 50, ...l })

const idx = PriceIndex.build({
  exchange: {
    Currency: {
      core: { primary: 'chaos', rates: { divine: 1 / 110 } },
      lines: [
        { id: 'divine', primaryValue: 110 },
        { id: 'chaos', primaryValue: 1 },
        { id: 'mirror-shard', primaryValue: 1800 }
      ],
      items: [
        { id: 'divine', name: 'Divine Orb' },
        { id: 'chaos', name: 'Chaos Orb' },
        { id: 'mirror-shard', name: 'Mirror Shard' }
      ]
    },
    Fragment: { lines: [{ id: 'writ', primaryValue: 67 }], items: [{ id: 'writ', name: "The Maven's Writ" }] },
    DivinationCard: { lines: [{ id: 'nurse', primaryValue: 200 }], items: [{ id: 'nurse', name: 'The Nurse' }] }
  },
  currency: {
    Currency: { lines: [{ currencyTypeName: 'Scrying Orb', chaosEquivalent: 3 }] }
  },
  item: {
    UniqueAccessory: {
      lines: [
        line({ name: 'Mageblood', baseType: 'Heavy Belt', variant: '4 Flasks', chaosValue: 16000 }),
        line({ name: 'Mageblood', baseType: 'Heavy Belt', variant: '2 Flasks', chaosValue: 8600 }),
        line({ name: 'Headhunter', baseType: 'Leather Belt', chaosValue: 14000 }),
        line({
          name: 'Foulborn Headhunter',
          baseType: 'Leather Belt',
          variant: 'Culling Strike',
          chaosValue: 30000,
          mutated: ['Culling Strike']
        }),
        line({
          name: 'Foulborn Headhunter',
          baseType: 'Leather Belt',
          variant: 'Soul Eater',
          chaosValue: 25000,
          mutated: ['Gain 10 Soul Eater stacks']
        })
      ]
    },
    UniqueArmour: {
      lines: [
        line({ name: 'The Covenant', baseType: 'Spidersilk Robe', chaosValue: 20 }),
        line({ name: 'The Covenant', baseType: 'Spidersilk Robe', links: 6, chaosValue: 990 }),
        line({ name: "Kaom's Heart", baseType: 'Glorious Plate', chaosValue: 19 })
      ]
    },
    SkillGem: {
      lines: [
        line({ name: 'Arc', gemLevel: 1, chaosValue: 1 }),
        line({ name: 'Arc', gemLevel: 20, gemQuality: 20, chaosValue: 49 }),
        line({ name: 'Arc', gemLevel: 21, gemQuality: 20, corrupted: true, chaosValue: 33 }),
        line({ name: 'Empower Support', gemLevel: 4, corrupted: true, chaosValue: 765 })
      ]
    },
    Map: {
      lines: [
        line({ name: 'Map (Tier 16)', variant: 'Gen-23', chaosValue: 5 }),
        line({ name: 'Map (Tier 16)', variant: 'Gen-24', chaosValue: 2 })
      ]
    },
    BlightedMap: { lines: [line({ name: 'Blighted Map (Tier 16)', variant: 'Gen-24', chaosValue: 9 })] },
    ClusterJewel: {
      lines: [
        line({ name: '12% increased Chaos Damage', baseType: 'Large Cluster Jewel', variant: '8 passives', levelRequired: 84, itemClass: 2, chaosValue: 266 }),
        line({ name: '12% increased Chaos Damage', baseType: 'Large Cluster Jewel', variant: '8 passives', levelRequired: 50, itemClass: 2, chaosValue: 40 })
      ]
    },
    BaseType: {
      lines: [
        line({ name: 'Stygian Vise', levelRequired: 85, chaosValue: 333 }),
        line({ name: 'Archdemon Crown', levelRequired: 85, variant: 'Shaper', chaosValue: 208 }),
        line({ name: 'Archdemon Crown', levelRequired: 85, variant: 'Shaper/Elder', chaosValue: 311, listingCount: 2 })
      ]
    },
    Beast: { lines: [line({ name: 'Wild Bristle Matron', chaosValue: 111 })] },
    Wombgift: {
      lines: [
        line({ name: 'Ancient Wombgift', levelRequired: 40, chaosValue: 2 }),
        line({ name: 'Ancient Wombgift', levelRequired: 84, chaosValue: 1 })
      ]
    },
    IncursionTemple: {
      lines: [
        line({ name: "Doryani's Institute (Tier 3)", baseType: 'Chronicle of Atzoatl', chaosValue: 29 }),
        line({ name: 'Locus of Corruption (Tier 3)', baseType: 'Chronicle of Atzoatl', chaosValue: 60 })
      ]
    },
    Viscera: {
      lines: [
        line({ name: "Coven Queen's Crown", variant: '#% more Maximum Physical Attack Damage', chaosValue: 11000 }),
        line({ name: "Coven Queen's Crown", variant: '#% increased Damage with Hits against Rare monsters', chaosValue: 9000 })
      ]
    }
  }
})

const base = (p: Partial<PoeItem>): PoeItem => ({ name: '', typeLine: '', baseType: '', icon: '', ilvl: 0, identified: true, ...p })
const gem = (typeLine: string, level: number, quality: number, corrupted = false): PoeItem =>
  base({
    typeLine,
    baseType: typeLine,
    frameType: 4,
    corrupted,
    properties: [
      { name: 'Level', values: [[`${level}${level >= 20 ? ' (Max)' : ''}`, 0]] },
      ...(quality ? [{ name: 'Quality', values: [[`+${quality}%`, 1]] as [string, number][] }] : [])
    ]
  })

describe('câmbio e moedas', () => {
  it('lê o preço do divine pelo câmbio', () => {
    expect(idx.divineChaos).toBe(110)
  })
  it('precifica moedas, fragmentos e cartas por nome', () => {
    expect(priceItem(base({ typeLine: 'Mirror Shard', frameType: 5 }), idx)?.chaos).toBe(1800)
    expect(priceItem(base({ typeLine: "The Maven's Writ", frameType: 0 }), idx)?.chaos).toBe(67)
    expect(priceItem(base({ typeLine: 'The Nurse', frameType: 6 }), idx)?.chaos).toBe(200)
  })
  it('usa o endpoint legado de moedas como reserva', () => {
    expect(priceItem(base({ typeLine: 'Scrying Orb', frameType: 5 }), idx)?.chaos).toBe(3)
  })
})

describe('únicos', () => {
  it('casa a variante do Mageblood pelo número de frascos', () => {
    const m = priceItem(
      base({
        name: 'Mageblood',
        typeLine: 'Heavy Belt',
        baseType: 'Heavy Belt',
        frameType: 3,
        explicitMods: ['Leftmost 4 Magic Utility Flasks constantly apply their Flask Effects to you']
      }),
      idx
    )
    expect(m?.chaos).toBe(16000)
    expect(m?.approximate).toBe(false)
  })
  it('diferencia 6L do item sem links', () => {
    const covenant = (groups: number[]) =>
      base({
        name: 'The Covenant',
        typeLine: 'Spidersilk Robe',
        baseType: 'Spidersilk Robe',
        frameType: 3,
        sockets: groups.flatMap((n, g) => Array.from({ length: n }, () => ({ group: g })))
      })
    expect(priceItem(covenant([6]), idx)?.chaos).toBe(990)
    expect(priceItem(covenant([4, 2]), idx)?.chaos).toBe(20)
    expect(maxLinks(covenant([3, 2, 1]))).toBe(3)
  })
  it('casa Foulborn pelos modificadores mutados', () => {
    const hh = base({
      name: 'Headhunter',
      typeLine: 'Leather Belt',
      baseType: 'Leather Belt',
      frameType: 3,
      mutatedMods: ['Gain 12 Soul Eater stacks']
    })
    expect(priceItem(hh, idx)?.chaos).toBe(25000)
    const normal = { ...hh, mutatedMods: undefined }
    expect(priceItem(normal, idx)?.chaos).toBe(14000)
  })
  it('único não identificado usa o mais barato da base, marcado como aproximado', () => {
    const m = priceItem(base({ typeLine: 'Leather Belt', baseType: 'Leather Belt', frameType: 3, identified: false }), idx)
    expect(m?.chaos).toBe(14000)
    expect(m?.approximate).toBe(true)
  })
})

describe('gemas', () => {
  it('casa nível/qualidade/corrupção exatos', () => {
    expect(priceItem(gem('Arc', 20, 20), idx)?.chaos).toBe(49)
    expect(priceItem(gem('Arc', 21, 20, true), idx)?.chaos).toBe(33)
    expect(priceItem(gem('Empower Support', 4, 0, true), idx)?.chaos).toBe(765)
  })
  it('sem variante exata, usa a melhor variante abaixo do item', () => {
    const m = priceItem(gem('Arc', 18, 7), idx)
    expect(m?.chaos).toBe(1)
    expect(m?.approximate).toBe(true)
    expect(m?.detail).toBe('18/7')
  })
})

describe('mapas, clusters, bases e outros', () => {
  const tier16 = [{ name: 'Map Tier', values: [['16', 0]] as [string, number][] }]
  it('mapas usam a geração de atlas mais recente', () => {
    expect(priceItem(base({ typeLine: 'Map (Tier 16)', baseType: 'Map (Tier 16)', properties: tier16 }), idx)?.chaos).toBe(2)
  })
  it('mapas blighted', () => {
    const m = base({ typeLine: 'Blighted Map (Tier 16)', baseType: 'Map (Tier 16)', properties: tier16 })
    expect(priceItem(m, idx)?.chaos).toBe(9)
  })
  it('cluster jewel pelo encantamento e faixa de ilvl', () => {
    const cj = (ilvl: number) =>
      base({
        typeLine: 'Large Cluster Jewel',
        baseType: 'Large Cluster Jewel',
        frameType: 2,
        ilvl,
        enchantMods: ['Adds 8 Passive Skills', 'Added Small Passive Skills grant: 12% increased Chaos Damage']
      })
    expect(priceItem(cj(84), idx)?.chaos).toBe(266)
    expect(priceItem(cj(70), idx)?.chaos).toBe(40)
  })
  it('bases por ilvl e influência', () => {
    expect(priceItem(base({ typeLine: 'Stygian Vise', baseType: 'Stygian Vise', ilvl: 85 }), idx)?.chaos).toBe(333)
    const crown = (influences: Record<string, boolean>) =>
      base({ typeLine: 'Archdemon Crown', baseType: 'Archdemon Crown', ilvl: 85, frameType: 2, influences })
    expect(priceItem(crown({ shaper: true }), idx)?.chaos).toBe(208)
    const se = priceItem(crown({ elder: true, shaper: true }), idx)
    expect(se?.chaos).toBe(311)
    expect(se?.confidence).toBe('low')
    expect(priceItem(base({ typeLine: 'Stygian Vise', baseType: 'Stygian Vise', ilvl: 80 }), idx)).toBeNull()
    expect(
      priceItem(base({ typeLine: 'Stygian Vise', baseType: 'Stygian Vise', ilvl: 85 }), idx, { ...DEFAULT_PRICING, priceBaseTypes: false })
    ).toBeNull()
  })
  it('bestas, wombgifts, templos e vísceras', () => {
    expect(priceItem(base({ typeLine: 'Wild Bristle Matron', baseType: 'Wild Bristle Matron', frameType: 2 }), idx)?.chaos).toBe(111)
    expect(priceItem(base({ typeLine: 'Ancient Wombgift', baseType: 'Ancient Wombgift', ilvl: 84 }), idx)?.chaos).toBe(1)
    expect(priceItem(base({ typeLine: 'Ancient Wombgift', baseType: 'Ancient Wombgift', ilvl: 60, frameType: 5 }), idx)?.chaos).toBe(2)
    const temple = base({
      typeLine: 'Chronicle of Atzoatl',
      baseType: 'Chronicle of Atzoatl',
      explicitMods: ["Doryani's Institute (Tier 3)", 'Locus of Corruption (Tier 3)']
    })
    expect(priceItem(temple, idx)?.chaos).toBe(60)
    const crown = base({ name: '', typeLine: "Coven Queen's Crown", baseType: "Coven Queen's Crown", explicitMods: ['40% more Maximum Physical Attack Damage'] })
    expect(priceItem(crown, idx)?.chaos).toBe(11000)
  })
})

describe('valueItems', () => {
  it('agrupa pilhas iguais, soma por aba e respeita baixa confiança', () => {
    const tabs = [
      { tabId: 'a', tabName: 'A', items: [base({ typeLine: 'Chaos Orb', frameType: 5, stackSize: 20 }), base({ typeLine: 'Chaos Orb', frameType: 5, stackSize: 15 })] },
      {
        tabId: 'b',
        tabName: 'B',
        items: [
          base({ typeLine: 'Archdemon Crown', baseType: 'Archdemon Crown', ilvl: 85, frameType: 2, influences: { shaper: true, elder: true } }),
          base({ name: 'Random', typeLine: 'Vaal Regalia', baseType: 'Vaal Regalia', ilvl: 70, frameType: 2 })
        ]
      }
    ]
    const r = valueItems(tabs, idx, { ...DEFAULT_PRICING, includeLowConfidence: false })
    expect(r.totalChaos).toBe(35)
    expect(r.byTab.get('a')?.chaos).toBe(35)
    expect(r.byTab.get('b')?.chaos).toBe(0)
    expect(r.itemCount).toBe(4)
    expect(r.pricedCount).toBe(3)
    const chaos = r.items.find((i) => i.typeLine === 'Chaos Orb')!
    expect(chaos.quantity).toBe(35)
    const crown = r.items.find((i) => i.typeLine === 'Archdemon Crown')!
    expect(crown.counted).toBe(false)
    expect(crown.totalChaos).toBe(311)
    const all = valueItems(tabs, idx, { ...DEFAULT_PRICING, includeLowConfidence: true })
    expect(all.totalChaos).toBe(35 + 311)
  })
})

describe('cache compacto (formato gravado pelo backend Rust)', () => {
  it('monta o índice a partir das listas posicionais', () => {
    const compact = {
      exchange_Currency: { k: 'e', div: 113.8, l: [['Divine Orb', 113.8, '/d.png'], ['Chaos Orb', 1, '/c.png']] },
      exchange_DivinationCard: { k: 'e', l: [['The Nurse', 202.1, '']] },
      item_UniqueAccessory: {
        k: 'i',
        l: [
          ['Headhunter', 'Leather Belt', '', 0, 0, 0, 0, 0, 3, 14000, 16, 0],
          ['Foulborn Headhunter', 'Leather Belt', 'Soul Eater', 0, 0, 0, 0, 0, 3, 25000, 4, ['Gain 10 Soul Eater stacks']]
        ]
      },
      item_SkillGem: { k: 'i', l: [['Arc', '', '20/20', 0, 20, 20, 0, 70, 4, 49, 8, 0]] },
      currency_Currency: { k: 'c', l: [['Scrying Orb', 3]] }
    } satisfies CompactPrices
    const ci = PriceIndex.fromCompact(compact)
    const base = (p: Partial<PoeItem>): PoeItem => ({ name: '', typeLine: '', baseType: '', icon: '', ilvl: 0, identified: true, ...p })
    expect(ci.divineChaos).toBe(113.8)
    expect(priceItem(base({ typeLine: 'The Nurse', frameType: 6 }), ci)?.chaos).toBe(202.1)
    expect(priceItem(base({ typeLine: 'Scrying Orb', frameType: 5 }), ci)?.chaos).toBe(3)
    const hh = base({ name: 'Headhunter', typeLine: 'Leather Belt', baseType: 'Leather Belt', frameType: 3 })
    expect(priceItem(hh, ci)?.chaos).toBe(14000)
    const foulborn = priceItem({ ...hh, mutatedMods: ['Gain 12 Soul Eater stacks'] }, ci)
    expect(foulborn?.chaos).toBe(25000)
    expect(foulborn?.confidence).toBe('low')
    const arc = base({
      typeLine: 'Arc',
      frameType: 4,
      properties: [
        { name: 'Level', values: [['20 (Max)', 0]] },
        { name: 'Quality', values: [['+20%', 1]] }
      ]
    })
    expect(priceItem(arc, ci)?.chaos).toBe(49)
  })
})

describe('confiança estrita (liquidez)', () => {
  const card = (typeLine: string, stackSize = 1): PoeItem => base({ typeLine, frameType: 6, stackSize })
  // Caso real: The Survivalist, carta de ~1c, apareceu a 433c com só 2,33c negociados em 24 h.
  const liq = PriceIndex.fromCompact({
    exchange_Currency: { k: 'e', div: 216, l: [['Divine Orb', 216, '', 2256000], ['Chaos Orb', 1, '', 0]] },
    exchange_DivinationCard: {
      k: 'e',
      l: [
        ['The Survivalist', 433, '', 2.33],
        ['The Nurse', 200, '', 30000],
        ['The Wretched', 2, '', 9],
        ['Old Card', 50, '']
      ]
    },
    item_UniqueArmour: {
      k: 'i',
      l: [
        ['Thin Unique', 'Silk Robe', '', 0, 0, 0, 0, 0, -1, 80, 9, 0],
        ['Solid Unique', 'Silk Robe', '', 0, 0, 0, 0, 0, -1, 80, 10, 0]
      ]
    }
  } satisfies CompactPrices)

  it('câmbio com quase nenhum negócio em 24 h é baixa confiança', () => {
    expect(priceItem(card('The Survivalist'), liq)?.confidence).toBe('low')
    // 9c ÷ 2c = 4,5 negociadas por dia: abaixo de 5.
    expect(priceItem(card('The Wretched'), liq)?.confidence).toBe('low')
  })
  it('câmbio líquido continua alta confiança; sem volume informado também', () => {
    expect(priceItem(card('The Nurse'), liq)?.confidence).toBe('high')
    expect(priceItem(base({ typeLine: 'Divine Orb', frameType: 5 }), liq)?.confidence).toBe('high')
    expect(priceItem(base({ typeLine: 'Chaos Orb', frameType: 5 }), liq)?.confidence).toBe('high')
    expect(priceItem(card('Old Card'), liq)?.confidence).toBe('high')
  })
  it('itens de stash precisam de pelo menos 10 anúncios', () => {
    const robe = (name: string) => base({ name, typeLine: 'Silk Robe', baseType: 'Silk Robe', frameType: 3 })
    expect(priceItem(robe('Thin Unique'), liq)?.confidence).toBe('low')
    expect(priceItem(robe('Solid Unique'), liq)?.confidence).toBe('high')
  })
  it('a carta sem liquidez fica fora do total da stash', () => {
    const tabs = [{ tabId: 'd', tabName: 'Div Cards', items: [card('The Survivalist', 3), card('The Nurse')] }]
    const r = valueItems(tabs, liq, { ...DEFAULT_PRICING, includeLowConfidence: false })
    expect(r.totalChaos).toBe(200)
    expect(r.items.find((i) => i.typeLine === 'The Survivalist')?.counted).toBe(false)
  })
})
