import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadTradeData, prepareCheck, unknownMods, isStatFilter } from '../src/trade'
import { hintless, STAT_BY_MATCH_STR_V2, type StatOrGroup } from '../src/trade/apt/assets/data'

// Varredura de todos os mods dos dados reais do Awakened: cada texto que o jogo pode copiar tem
// que achar o seu registro, para nenhum mod aparecer como "not searchable" por diferença de texto.
const dir = new URL('../src/renderer/public/trade-data/', import.meta.url)
const statsNdjson = readFileSync(new URL('stats.ndjson', dir), 'utf8')
const records = statsNdjson
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as StatOrGroup)
const statsOf = (sg: StatOrGroup) => ('stats' in sg ? sg.stats : [sg])
const refsOf = (sg: StatOrGroup | undefined) => (sg ? statsOf(sg).map((s) => s.ref) : [])

beforeAll(() => {
  loadTradeData({ stats: statsNdjson, items: readFileSync(new URL('items.ndjson', dir), 'utf8') })
})

/** Como o Ctrl+C do jogo abrevia as dicas longas: "Raised Spectres (Animated Weapons-…)" → "Raised Spectres(...)". */
const abbreviate = (s: string) => s.replace(/\s*\(([^()]*[A-Za-z][^()]*)\)/g, '(...)')

describe('dados de mods: todo texto acha o seu registro', () => {
  it('texto exato (simples e avançado)', () => {
    const missing: string[] = []
    for (const sg of records) {
      for (const s of statsOf(sg)) {
        for (const m of s.matchers) {
          for (const str of m.advanced ? [m.string, m.advanced] : [m.string]) {
            if (!refsOf(STAT_BY_MATCH_STR_V2(str)).length) missing.push(str)
          }
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('dicas abreviadas com "(...)" e palavras-chave com maiúscula', () => {
    // Textos que, sem as dicas, ficam iguais em registros diferentes: ambíguos por natureza
    // (o jogo copia o texto completo com Ctrl+Alt+C, então não dependem disso).
    const owners = new Map<string, Set<StatOrGroup>>()
    for (const sg of records) {
      for (const s of statsOf(sg)) {
        for (const m of s.matchers) {
          for (const str of m.advanced ? [m.string, m.advanced] : [m.string]) {
            const k = hintless(str)
            owners.set(k, (owners.get(k) ?? new Set()).add(sg))
          }
        }
      }
    }
    const missing: string[] = []
    let checked = 0
    let ambiguous = 0
    for (const sg of records) {
      for (const s of statsOf(sg)) {
        for (const m of s.matchers) {
          if (!m.advanced) continue
          const short = abbreviate(m.advanced)
          if (short === m.advanced) continue
          if ((owners.get(hintless(short))?.size ?? 0) > 1) {
            ambiguous++
            continue
          }
          checked++
          if (!refsOf(STAT_BY_MATCH_STR_V2(short)).includes(s.ref)) missing.push(short)
          const shouted = short.replace(/\b[a-z]/g, (c) => c.toUpperCase())
          if (!refsOf(STAT_BY_MATCH_STR_V2(shouted)).includes(s.ref)) missing.push(shouted)
        }
      }
    }
    expect(missing).toEqual([])
    expect(checked).toBeGreaterThan(100)
    // Se esse número crescer muito, a abreviação passou a esconder muitos mods: revisar.
    expect(ambiguous).toBeLessThan(checked / 10)
  })
})

describe('mapas blighted (como o Awakened)', () => {
  const map = [
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
    'Towers deal 25% more Damage',
    '--------',
    'Travel to this Map by using it in a personal Map Device. Maps can only be used once.'
  ].join('\n')

  it('pesquisa por base, área e tier; os mods não aparecem como "not searchable"', () => {
    const r = prepareCheck(map, { league: 'Standard' })
    if ('error' in r) throw new Error(r.error)
    expect(unknownMods(r.item)).toEqual([])
    const f = r.presets[0].filters
    expect(f.mapBlighted?.value).toBe('Blight-ravaged')
    expect(f.mapTier?.value).toBe(16)
    expect(f.searchExact.sub?.baseType).toBe('Jungle Valley')
    expect(f.searchExact.sub?.disabled).toBe(false)
  })
})

describe('item real com dica abreviada', () => {
  const unique = (spectreLines: string[]) =>
    [
      'Item Class: Helmets',
      'Rarity: Rare',
      'Grim Visage',
      'Hubris Circlet',
      '--------',
      'Item Level: 84',
      '--------',
      '{ Prefix Modifier "Hale" (Tier: 6) — Life }',
      '+45(40-49) to maximum Life',
      '{ Unique Modifier — Minion }',
      ...spectreLines
    ].join('\n')

  for (const [label, lines] of [
    ['completo (Ctrl+Alt+C)', [
      'Maximum number of Raised Spectres (Animated Weapons-Holy Armaments) is Doubled',
      'Cannot have Minions other than Raised Spectres (Animated Weapons-Holy Armaments) — Unscalable Value'
    ]],
    ['abreviado (Ctrl+C)', [
      'Maximum number of Raised Spectres(...) is Doubled',
      'Cannot have Minions other than Raised Spectres(...) — Unscalable Value'
    ]]
  ] as const) {
    it(`mods de Raised Spectres pesquisáveis: ${label}`, () => {
      const r = prepareCheck(unique([...lines]), { league: 'Standard' })
      if ('error' in r) throw new Error(r.error)
      expect(unknownMods(r.item)).toEqual([])
      const ids = (r.presets.flatMap((p) => p.stats) ?? []).filter(isStatFilter).flatMap((f) => f.tradeId)
      expect(ids.some((id) => id.startsWith('explicit.stat_56473917'))).toBe(true)
    })
  }
})
