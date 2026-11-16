import { describe, expect, it } from 'vitest'
import type { ItemLine } from '../src/core/pricing/ninja'
import { magicBaseCandidates, parseItemText } from '../src/core/pricing/clipboard'
import { PriceIndex } from '../src/core/pricing/priceIndex'
import { DEFAULT_PRICING } from '../src/core/pricing/priceItem'
import { checkPrice } from '../src/core/pricecheck'

const line = (l: Partial<ItemLine> & { name: string; chaosValue: number }): ItemLine => ({ listingCount: 50, ...l })

const idx = PriceIndex.build({
  exchange: {
    Currency: {
      core: { primary: 'chaos', rates: { divine: 1 / 110 } },
      lines: [
        { id: 'divine', primaryValue: 110 },
        { id: 'chaos', primaryValue: 1 }
      ],
      items: [
        { id: 'divine', name: 'Divine Orb' },
        { id: 'chaos', name: 'Chaos Orb' }
      ]
    },
    DivinationCard: { lines: [{ id: 'nurse', primaryValue: 200 }], items: [{ id: 'nurse', name: 'The Nurse' }] }
  },
  currency: {},
  item: {
    UniqueArmour: {
      lines: [
        line({ name: 'The Covenant', baseType: 'Spidersilk Robe', chaosValue: 20 }),
        line({ name: 'The Covenant', baseType: 'Spidersilk Robe', links: 6, chaosValue: 990 }),
        line({ name: "Kaom's Heart", baseType: 'Glorious Plate', chaosValue: 19 }),
        line({ name: 'Doppelgänger Guise', baseType: 'Sadist Garb', chaosValue: 3 }),
        line({ name: 'Inpulsa\'s Broken Heart', baseType: 'Sadist Garb', chaosValue: 15 }),
        line({ name: 'Inpulsa\'s Broken Heart', baseType: 'Sadist Garb', links: 6, chaosValue: 400 })
      ]
    },
    SkillGem: {
      lines: [
        line({ name: 'Arc', gemLevel: 20, gemQuality: 20, chaosValue: 49 }),
        line({ name: 'Arc', gemLevel: 21, gemQuality: 20, corrupted: true, chaosValue: 33 })
      ]
    },
    Map: { lines: [line({ name: 'Map (Tier 16)', variant: 'Gen-24', chaosValue: 2 })] },
    BlightedMap: { lines: [line({ name: 'Blighted Map (Tier 16)', variant: 'Gen-24', chaosValue: 9 })] },
    ClusterJewel: {
      lines: [
        line({ name: '12% increased Chaos Damage', baseType: 'Large Cluster Jewel', variant: '8 passives', levelRequired: 84, itemClass: 2, chaosValue: 266 })
      ]
    },
    BaseType: { lines: [line({ name: 'Stygian Vise', levelRequired: 85, chaosValue: 333 })] }
  }
})

const meta = { league: 'Test', updatedAt: 1 }
const check = (text: string) => checkPrice(text, idx, DEFAULT_PRICING, meta)
const t = (...lines: string[]) => lines.join('\r\n')

describe('price check pelo texto copiado do jogo', () => {
  it('moeda em pilha: preço unitário e total', () => {
    const r = check(t('Item Class: Stackable Currency', 'Rarity: Currency', 'Divine Orb', '--------', 'Stack Size: 3/20', '--------', 'Randomises the numeric values'))
    expect(r).toMatchObject({ ok: true, name: 'Divine Orb', quantity: 3, unitChaos: 110, totalChaos: 330, divineChaos: 110 })
  })

  it('pilha com separador de milhar', () => {
    const r = check(t('Item Class: Stackable Currency', 'Rarity: Currency', 'Chaos Orb', '--------', 'Stack Size: 1,234/5,000'))
    expect(r.quantity).toBe(1234)
  })

  it('único com 6 links', () => {
    const r = check(
      t(
        'Item Class: Body Armours',
        'Rarity: Unique',
        'The Covenant',
        'Spidersilk Robe',
        '--------',
        'Energy Shield: 300',
        '--------',
        'Requirements:',
        'Level: 69',
        'Int: 163',
        '--------',
        'Sockets: B-B-B-B-B-B ',
        '--------',
        'Item Level: 84',
        '--------',
        'Socketed Gems are Supported by Level 29 Blood Magic',
        '--------',
        'Corrupted'
      )
    )
    expect(r).toMatchObject({ ok: true, name: 'The Covenant', base: 'Spidersilk Robe', unitChaos: 990, detail: '6L' })
  })

  it('gema: nível e qualidade da gema, não o nível exigido', () => {
    const gem = (extra: string[]) =>
      t('Item Class: Skill Gems', 'Rarity: Gem', 'Arc', '--------', 'Lightning, Spell, Chaining', 'Level: 20 (Max)', 'Quality: +20% (augmented)', '--------', 'Requirements:', 'Level: 70', 'Int: 155', ...extra)
    expect(check(gem([])).unitChaos).toBe(49)
    expect(check(t(gem([]).replace('Level: 20 (Max)', 'Level: 21'), '--------', 'Corrupted')).unitChaos).toBe(33)
  })

  it('mapas comuns e praguejados', () => {
    expect(check(t('Item Class: Maps', 'Rarity: Normal', 'Map (Tier 16)', '--------', 'Map Tier: 16', '--------', 'Item Level: 83')).unitChaos).toBe(2)
    expect(check(t('Item Class: Maps', 'Rarity: Normal', 'Blighted Map (Tier 16)', '--------', 'Map Tier: 16')).unitChaos).toBe(9)
  })

  it('cluster jewel pelo encantamento', () => {
    const r = check(
      t(
        'Item Class: Jewels',
        'Rarity: Magic',
        'Large Cluster Jewel',
        '--------',
        'Item Level: 84',
        '--------',
        'Adds 8 Passive Skills (enchant)',
        'Added Small Passive Skills grant: 12% increased Chaos Damage (enchant)'
      )
    )
    expect(r.unitChaos).toBe(266)
  })

  it('base ilvl 85 de um raro; raro sem preço explica o motivo', () => {
    const vise = check(t('Item Class: Belts', 'Rarity: Rare', 'Gale Clasp', 'Stygian Vise', '--------', 'Item Level: 85', '--------', '+40 to maximum Life'))
    expect(vise.unitChaos).toBe(333)
    const ring = check(t('Item Class: Rings', 'Rarity: Rare', 'Doom Loop', 'Two-Stone Ring', '--------', 'Item Level: 80'))
    expect(ring.ok).toBe(true)
    expect(ring.unitChaos).toBeUndefined()
    expect(ring.message).toMatch(/trade search/)
  })

  it('texto que não é item', () => {
    expect(check('hello world').ok).toBe(false)
    expect(check('').ok).toBe(false)
  })

  it('leitura dos campos', () => {
    const p = parseItemText(
      t(
        'Item Class: Helmets',
        'Rarity: Rare',
        'Gloom Crown',
        'Archdemon Crown',
        '--------',
        'Sockets: R-G B ',
        '--------',
        'Item Level: 85',
        '--------',
        '+1 to Level of Socketed Gems (implicit)',
        '--------',
        '+90 to maximum Life',
        '20% increased Rarity of Items found (crafted)',
        '--------',
        'Shaper Item',
        'Elder Item'
      )
    )!
    expect(p.item.sockets?.map((s) => s.group)).toEqual([0, 0, 1])
    expect(p.item.implicitMods).toEqual(['+1 to Level of Socketed Gems'])
    expect(p.item.explicitMods).toEqual(['+90 to maximum Life'])
    expect(p.item.craftedMods).toEqual(['20% increased Rarity of Items found'])
    expect(p.item.influences).toEqual({ shaper: true, elder: true })
    expect(p.item.ilvl).toBe(85)
    const unid = parseItemText(t('Item Class: Body Armours', 'Rarity: Unique', 'Glorious Plate', '--------', 'Unidentified'))!
    expect(unid.item.identified).toBe(false)
    expect(unid.item.baseType).toBe('Glorious Plate')
  })

  it('formato avançado (3.29+): cabeçalhos de mod, faixas de roll e texto explicativo', () => {
    const text = t(
      'Item Class: Helmets',
      'Rarity: Rare',
      'Gloom Crown',
      'Archdemon Crown',
      '--------',
      'Item Level: 85',
      '--------',
      '{ Implicit Modifier — Gem }',
      '+1(1-2) to Level of Socketed Gems (implicit)',
      '--------',
      '{ Prefix Modifier "Fecund" (Tier: 2) — Life }',
      '+90(90-99) to maximum Life',
      '{ Suffix Modifier "of the Ice" (Tier: 1) — Elemental, Cold, Resistance }',
      '+46(46-48)% to Cold Resistance',
      '{ Master Crafted Suffix Modifier "of Craft" (Rank: 2) }',
      '20(18-21)% increased Rarity of Items found',
      '{ Fractured Prefix Modifier "Resplendent" (Tier: 1) — Defences }',
      '-5(-10--5)% to Chaos Resistance',
      '(Reminder text that spans',
      'two lines)'
    )
    const p = parseItemText(text)!
    expect(p.item.implicitMods).toEqual(['+1 to Level of Socketed Gems'])
    expect(p.item.explicitMods).toEqual(['+90 to maximum Life', '+46% to Cold Resistance'])
    expect(p.item.craftedMods).toEqual(['20% increased Rarity of Items found'])
    expect(p.item.fracturedMods).toEqual(['-5% to Chaos Resistance'])
    const life = p.mods.find((m) => m.lines[0] === '+90 to maximum Life')!
    expect(life).toMatchObject({ kind: 'explicit', generation: 'prefix', name: 'Fecund', tier: 2, tags: ['Life'] })
    expect(life.raw).toEqual(['+90(90-99) to maximum Life'])
    expect(p.mods.find((m) => m.kind === 'crafted')?.generation).toBe('suffix')
    expect(p.mods.some((m) => m.lines.some((l) => l.includes('Reminder')))).toBe(false)
  })

  it('formato avançado: único com 6 links e mods com faixa ainda casa o preço', () => {
    const r = check(
      t(
        'Item Class: Body Armours',
        'Rarity: Unique',
        'The Covenant',
        'Spidersilk Robe',
        '--------',
        'Sockets: B-B-B-B-B-B',
        '--------',
        'Item Level: 84',
        '--------',
        '{ Unique Modifier — Gem }',
        'Socketed Gems are Supported by Level 29(29-29) Blood Magic',
        '{ Unique Modifier — Life }',
        '+80(60-80) to maximum Life'
      )
    )
    expect(r.unitChaos).toBe(990)
  })

  it('único não identificado lista os únicos possíveis da base', () => {
    const r = check(t('Item Class: Body Armours', 'Rarity: Unique', 'Sadist Garb', '--------', 'Item Level: 80', '--------', 'Unidentified'))
    expect(r.candidates?.map((c) => [c.name, c.chaos])).toEqual([
      ["Inpulsa's Broken Heart", 15],
      ['Doppelgänger Guise', 3]
    ])
    expect(r.unitChaos).toBe(3)
    expect(r.message).toMatch(/one of 2 uniques/)
  })

  it('base de item mágico', () => {
    expect(magicBaseCandidates("Antagonist's Strand Map of Smothering")).toContain('Strand Map')
    expect(magicBaseCandidates('Seething Divine Life Flask of Staunching')).toContain('Divine Life Flask')
  })
})
