import type { PoeItem, PoeItemProperty, PoeSocket } from '../../shared/types'

/**
 * Texto que o jogo copia com Ctrl+C sobre um item → formato de item da API, para o mesmo motor de
 * preços da stash. Exemplo:
 *
 *   Item Class: Body Armours
 *   Rarity: Unique
 *   Kaom's Heart
 *   Glorious Plate
 *   --------
 *   Armour: 553
 *   --------
 *   Sockets: R-R-R-G-B-B
 *   --------
 *   Item Level: 84
 *   --------
 *   +500 to maximum Life
 *   --------
 *   Corrupted
 */

const SEPARATOR = /^-{8,}$/
const RARITY_FRAME: Record<string, number> = {
  normal: 0,
  magic: 1,
  rare: 2,
  unique: 3,
  gem: 4,
  currency: 5,
  'divination card': 6
}
const INFLUENCES: Record<string, string> = {
  'shaper item': 'shaper',
  'elder item': 'elder',
  'crusader item': 'crusader',
  'redeemer item': 'redeemer',
  'hunter item': 'hunter',
  'warlord item': 'warlord',
  'searing exarch item': 'searing',
  'eater of worlds item': 'tangled'
}
/** Linhas "Nome: valor" que viram propriedades (o motor lê Level, Quality, Map Tier…). */
const PROPERTIES = new Set(['Level', 'Quality', 'Map Tier', 'Experience', 'Area Level', 'Stack Size'])
/** Linhas soltas que são marcadores, não modificadores. */
const FLAGS = new Set(['Corrupted', 'Unidentified', 'Mirrored', 'Split', 'Synthesised Item', 'Fractured Item', 'Foulborn'])
const MOD_SUFFIX = /\s+\((implicit|enchant|crafted|fractured|mutated|scourge|crucible)\)$/i

export interface ParsedItem {
  item: PoeItem
  itemClass?: string
  rarity: string
}

function toInt(s: string): number {
  const m = /-?[\d,.  ]+/.exec(s)
  return m ? parseInt(m[0].replace(/[^\d-]/g, ''), 10) || 0 : 0
}

function parseSockets(s: string): PoeSocket[] {
  const out: PoeSocket[] = []
  s.trim()
    .split(/\s+/)
    .forEach((group, g) => {
      for (const colour of group.split('-').filter(Boolean)) out.push({ group: g, sColour: colour })
    })
  return out
}

/** null quando o texto não é de um item do jogo. */
export function parseItemText(text: string): ParsedItem | null {
  if (typeof text !== 'string' || text.length > 20_000) return null
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim())
  const sections: string[][] = [[]]
  for (const l of lines) {
    if (SEPARATOR.test(l)) sections.push([])
    else if (l) sections[sections.length - 1].push(l)
  }

  const head = sections[0]
  let i = 0
  let itemClass: string | undefined
  if (head[i]?.startsWith('Item Class:')) itemClass = head[i++].slice('Item Class:'.length).trim()
  if (!head[i]?.startsWith('Rarity:')) return null
  const rarity = head[i++].slice('Rarity:'.length).trim()
  const frameType = RARITY_FRAME[rarity.toLowerCase()]
  if (frameType === undefined) return null
  const names = head.slice(i)
  if (!names.length) return null

  const twoLines = (frameType === 2 || frameType === 3) && names.length >= 2
  const item: PoeItem = {
    name: twoLines ? names[0] : '',
    typeLine: twoLines ? names[1] : names[0],
    baseType: twoLines ? names[1] : names[0],
    icon: '',
    frameType,
    ilvl: 0,
    identified: true
  }
  const properties: PoeItemProperty[] = []
  const add = (key: keyof PoeItem, mod: string): void => {
    const list = ((item as unknown as Record<string, string[] | undefined>)[key] ??= [])
    list.push(mod)
  }

  for (const section of sections.slice(1)) {
    // Requisitos ("Level: 68" aqui é nível exigido, não nível de gema).
    if (section[0] === 'Requirements:' || section[0]?.startsWith('Requires ')) continue
    for (const line of section) {
      if (FLAGS.has(line)) {
        if (line === 'Corrupted') item.corrupted = true
        if (line === 'Unidentified') item.identified = false
        if (line === 'Foulborn') item.mutated = true
        continue
      }
      const inf = INFLUENCES[line.toLowerCase()]
      if (inf) {
        item.influences = { ...item.influences, [inf]: true }
        continue
      }
      const kv = /^([A-Za-z][A-Za-z ]+?):\s*(.+)$/.exec(line)
      if (kv) {
        const [, key, value] = kv
        if (key === 'Item Level') {
          item.ilvl = toInt(value)
          continue
        }
        if (key === 'Stack Size') {
          item.stackSize = Math.max(1, toInt(value.split('/')[0]))
          continue
        }
        if (key === 'Sockets') {
          item.sockets = parseSockets(value)
          continue
        }
        if (key === 'Note') continue
        if (PROPERTIES.has(key)) {
          properties.push({ name: key, values: [[value, 0]] })
          continue
        }
      }
      const suffix = MOD_SUFFIX.exec(line)
      const mod = line.replace(MOD_SUFFIX, '')
      switch (suffix?.[1].toLowerCase()) {
        case 'implicit':
          add('implicitMods', mod)
          break
        case 'enchant':
          add('enchantMods', mod)
          break
        case 'crafted':
          add('craftedMods', mod)
          break
        case 'fractured':
          add('fracturedMods', mod)
          break
        case 'mutated':
          add('mutatedMods', mod)
          break
        default:
          add('explicitMods', mod)
      }
    }
  }

  // Único não identificado: só a base aparece.
  if (frameType === 3 && names.length < 2) item.identified = false
  if (properties.length) item.properties = properties
  // Na API a base de um mapa praguejado é o mapa comum; o "Blighted" fica só no typeLine.
  if (itemClass === 'Maps' || properties.some((p) => p.name === 'Map Tier')) {
    item.baseType = item.baseType.replace(/^(Blighted|Blight-ravaged)\s+/i, '')
  }
  return { item, itemClass, rarity }
}

/**
 * Itens mágicos trazem prefixo/sufixo no nome ("Antagonist's Strand Map of Smothering"); a base
 * está no meio. Devolve candidatos do mais longo ao mais curto para o casador testar.
 */
export function magicBaseCandidates(typeLine: string): string[] {
  const core = typeLine.replace(/\s+of\s+.+$/i, '')
  const words = core.split(/\s+/)
  const out: string[] = []
  for (let s = 0; s < words.length; s++) out.push(words.slice(s).join(' '))
  if (core !== typeLine) out.unshift(typeLine)
  return out
}
