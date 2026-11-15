import { describe, expect, it } from 'vitest'
import type { PoeItem } from '../src/shared/types'
import { cleanText, normalizeItem } from '../src/main/pricing/normalize'
import { PriceIndex } from '../src/main/pricing/priceIndex'
import { DEFAULT_PRICING, valueItems } from '../src/main/pricing/priceItem'

const idx = PriceIndex.build({
  exchange: {
    Currency: { lines: [{ id: 'chaos', primaryValue: 1 }], items: [{ id: 'chaos', name: 'Chaos Orb' }] }
  },
  currency: {},
  item: {
    UniqueArmour: { lines: [{ name: "Kaom's Heart", baseType: 'Glorious Plate', chaosValue: 19, listingCount: 50 }] },
    Viscera: {
      lines: [{ name: "Coven Queen's Crown", variant: '#% more Maximum Physical Attack Damage', chaosValue: 11000, listingCount: 50 }]
    }
  }
})

const opts = { ...DEFAULT_PRICING, includeLowConfidence: true }
const asItems = (raw: unknown[]): PoeItem[] => raw as PoeItem[]

describe('cleanText', () => {
  it('remove a marcação do jogo', () => {
    expect(cleanText("<<set:MS>><<set:M>><<set:S>>Kaom's Heart")).toBe("Kaom's Heart")
    expect(cleanText('+40% to [Fire|Fire Resistance]')).toBe('+40% to Fire Resistance')
    expect(cleanText('Adds 1 to 2 [Physical] Damage')).toBe('Adds 1 to 2 Physical Damage')
  })
})

describe('normalizeItem', () => {
  it('aguenta campos com tipos errados ou ausentes sem lançar', () => {
    const item = normalizeItem({
      typeLine: 'Vaal Regalia',
      frameType: '2',
      ilvl: 'oitenta',
      properties: [{ name: 'Energy Shield', values: [[300, 1]] }, { name: 7, values: 'x' }, null],
      explicitMods: ['+80 to maximum Energy Shield', { text: 'objeto' }, 42, null],
      sockets: [{ group: '0' }, 'lixo'],
      influences: { shaper: 'yes', elder: true }
    })
    expect(item.baseType).toBe('Vaal Regalia')
    expect(item.frameType).toBe(2)
    expect(item.ilvl).toBe(0)
    expect(item.properties?.[0]).toEqual({ name: 'Energy Shield', values: [['300', 1]] })
    expect(item.explicitMods).toEqual(['+80 to maximum Energy Shield', '42'])
    expect(item.sockets).toEqual([{ group: 0, attr: undefined }])
    expect(item.influences).toEqual({ shaper: false, elder: true })
  })

  it('descarta ícones que não sejam https', () => {
    expect(normalizeItem({ typeLine: 'X', icon: 'javascript:alert(1)' }).icon).toBe('')
    expect(normalizeItem({ typeLine: 'X', icon: 'https://web.poecdn.com/a.png' }).icon).toBe('https://web.poecdn.com/a.png')
  })
})

describe('valueItems com dados reais "sujos"', () => {
  it('precifica único com prefixo <<set:...>> do endpoint antigo', () => {
    const r = valueItems(
      [
        {
          tabId: 't',
          tabName: 'T',
          items: asItems([
            {
              name: "<<set:MS>><<set:M>><<set:S>>Kaom's Heart",
              typeLine: '<<set:MS>><<set:M>><<set:S>>Glorious Plate',
              baseType: 'Glorious Plate',
              frameType: 3,
              ilvl: 70,
              identified: true,
              icon: ''
            }
          ])
        }
      ],
      idx,
      opts
    )
    expect(r.totalChaos).toBe(19)
    expect(r.items[0].name).toBe("Kaom's Heart Glorious Plate")
  })

  it('não quebra com valores numéricos em propriedades (o erro t.split da 0.1.1)', () => {
    const r = valueItems(
      [
        {
          tabId: 't',
          tabName: 'T',
          items: asItems([
            {
              name: '',
              typeLine: "Coven Queen's Crown",
              frameType: 15,
              ilvl: 84,
              identified: true,
              icon: '',
              properties: [{ name: 'Quality', values: [[20, 1]] }],
              explicitMods: ['40% more Maximum Physical Attack Damage']
            },
            { typeLine: 'Chaos Orb', frameType: 5, stackSize: 10 }
          ])
        }
      ],
      idx,
      opts
    )
    expect(r.errorCount).toBe(0)
    expect(r.totalChaos).toBe(11000 + 10)
  })

  it('um item que estoura erro fica sem preço e o snapshot continua', () => {
    const broken = Object.create(idx) as PriceIndex
    Object.defineProperty(broken, 'unique', {
      get() {
        throw new Error('boom')
      }
    })
    const errors: string[] = []
    const r = valueItems(
      [
        {
          tabId: 't',
          tabName: 'T',
          items: asItems([
            { name: "Kaom's Heart", typeLine: 'Glorious Plate', baseType: 'Glorious Plate', frameType: 3, identified: true },
            { typeLine: 'Chaos Orb', frameType: 5, stackSize: 5 }
          ])
        }
      ],
      broken,
      { ...opts, onItemError: (e) => errors.push((e as Error).message) }
    )
    expect(r.errorCount).toBe(1)
    expect(errors).toEqual(['boom'])
    expect(r.totalChaos).toBe(5)
    expect(r.itemCount).toBe(2)
  })
})
