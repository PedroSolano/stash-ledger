// Só desenvolvimento: simula a ponte do Tauri para a janela do price check rodar no navegador.
import type { PriceCheckPayload } from '../../shared/types'

const lines = (...l: string[]) => l.join('\n')

const ITEMS: Record<string, PriceCheckPayload> = {
  ring: {
    league: 'Keepers',
    text: lines(
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
      '{ Prefix Modifier "Flaring" (Tier: 3) — Damage, Physical, Attack }',
      'Adds 6(5-7) to 11(10-12) Physical Damage to Attacks',
      '{ Suffix Modifier "of the Ice" (Tier: 3) — Elemental, Cold, Resistance }',
      '+38(36-41)% to Cold Resistance',
      '{ Suffix Modifier "of the Lightning" (Tier: 4) — Elemental, Lightning, Resistance }',
      '+30(30-35)% to Lightning Resistance',
      '{ Master Crafted Suffix Modifier "of Craft" (Rank: 2) }',
      '+28(26-30) to Dexterity'
    ),
    ninja: {
      ok: true,
      name: 'Doom Loop',
      base: 'Two-Stone Ring',
      frameType: 2,
      quantity: 1,
      divineChaos: 150,
      message: 'poe.ninja has no price for this item.'
    }
  },
  unid: {
    league: 'Keepers',
    text: lines('Item Class: Belts', 'Rarity: Unique', 'Leather Belt', '--------', 'Item Level: 84', '--------', 'Unidentified'),
    ninja: {
      ok: true,
      name: 'Leather Belt',
      frameType: 3,
      quantity: 1,
      divineChaos: 150,
      unitChaos: 1,
      totalChaos: 1,
      approximate: true,
      candidates: [
        { name: 'Headhunter', chaos: 18000, confidence: 'high' },
        { name: 'Immortal Flesh', chaos: 2, confidence: 'high' },
        { name: 'Wurm\'s Molt', chaos: 1, confidence: 'high' }
      ],
      message: 'Unidentified: one of 3 uniques on this base.'
    }
  },
  map: {
    league: 'Keepers',
    text: lines(
      'Item Class: Maps',
      'Rarity: Rare',
      'Rotting Haven',
      'Blight-ravaged Map (Tier 16)',
      '--------',
      'Map Area: Jungle Valley',
      'Item Quantity: +70% (augmented)',
      '--------',
      'Item Level: 84',
      '--------',
      '{ Implicit Modifier }',
      'Area is infested with Fungal Growths',
      'Natural inhabitants of this area have been removed — Unscalable Value',
      'Can be Anointed up to 3 times — Unscalable Value',
      'Can have 3 additional Enchantment Modifiers',
      '--------',
      '{ Prefix Modifier "Lucky" }',
      'Varieties of Items contained in 12 Blight Chests are Lucky',
      '{ Suffix Modifier "Fortified" }',
      'Towers deal 25% more Damage'
    ),
    ninja: { ok: true, name: 'Rotting Haven', base: 'Blight-ravaged Map (Tier 16)', frameType: 2, quantity: 1, divineChaos: 150, message: 'poe.ninja has no price for this item.' }
  },
  divine: {
    league: 'Keepers',
    text: lines('Item Class: Stackable Currency', 'Rarity: Currency', 'Divine Orb', '--------', 'Stack Size: 7/20'),
    ninja: { ok: true, name: 'Divine Orb', frameType: 5, quantity: 7, divineChaos: 150, unitChaos: 150, totalChaos: 1050, category: 'Currency', confidence: 'high' }
  }
}

const which = new URLSearchParams(location.search).get('item') ?? 'ring'
const hex = (n: number) => n.toString(16).padStart(64, '0')

const listing = (i: number) => ({
  id: hex(i),
  item: { ilvl: 80 + (i % 4) },
  listing: {
    indexed: new Date(Date.now() - i * 7 * 60_000).toISOString(),
    price: { amount: [40, 45, 50, 1, 1.5, 2, 2, 3][i % 8], currency: i % 8 < 3 ? 'chaos' : 'divine', type: '~price' },
    account: { name: `seller${i}`, lastCharacterName: `Char${i}`, online: i % 3 ? {} : undefined }
  }
})

const handlers = new Map<number, (e: unknown) => void>()
let nextId = 1
;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
  transformCallback: (cb: (e: unknown) => void) => {
    const id = nextId++
    handlers.set(id, cb)
    return id
  },
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    console.debug('[mock invoke]', cmd, args)
    await new Promise((r) => setTimeout(r, 150))
    switch (cmd) {
      case 'pricecheck_ready':
        return ITEMS[which]
      case 'plugin:event|listen':
        return 1
      case 'trade_search':
        return { id: 'MockQ', result: Array.from({ length: 23 }, (_, i) => hex(i)), total: 57 }
      case 'trade_fetch':
        return { result: (args.ids as string[]).map((id) => listing(parseInt(id, 16))) }
      case 'trade_exchange':
        return {
          id: 'MockX',
          total: 30,
          result: Object.fromEntries(
            Array.from({ length: 30 }, (_, i) => [
              hex(i),
              {
                id: hex(i),
                listing: {
                  indexed: new Date(Date.now() - i * 60_000).toISOString(),
                  offers: [{ exchange: { currency: 'chaos', amount: 148 + i }, item: { amount: 1, stock: 10 + i } }],
                  account: { name: `bulk${i}`, lastCharacterName: `B${i}`, online: {} }
                }
              }
            ])
          )
        }
      default:
        return null
    }
  }
}
