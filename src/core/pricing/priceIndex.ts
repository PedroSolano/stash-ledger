import { fromCompact, type CompactPrices, type ItemLine, type PriceIndexInput } from './ninja'

export type { PriceIndexInput }

/** Uma entrada de preço normalizada, independente da categoria de origem. */
export interface PriceEntry {
  name: string
  chaos: number
  category: string
  /** Número de amostras/anúncios que sustentam o preço (stash). Infinity para câmbio. */
  listings: number
  baseType?: string
  variant?: string
  links?: number
  gemLevel?: number
  gemQuality?: number
  corrupted?: boolean
  level?: number
  itemClass?: number
  detailsId?: string
  icon?: string
  /** Modificadores mutados normalizados (números trocados por #). */
  mutated?: string[]
}

const UNIQUE_TYPES = new Set([
  'UniqueWeapon',
  'UniqueArmour',
  'UniqueAccessory',
  'UniqueFlask',
  'UniqueJewel',
  'UniqueTincture',
  'UniqueRelic',
  'UniqueMap',
  'ForbiddenJewel',
  'ShrineBelt'
])

const MAP_TYPES = new Set(['Map', 'BlightedMap', 'BlightRavagedMap'])

/** Categorias de itens "diversos" casados por nome (e às vezes por variante). */
const MISC_TYPES = new Set([
  'Beast',
  'Corpse',
  'Viscera',
  'Incubator',
  'Invitation',
  'Memory',
  'Vial'
])

export function norm(s: string | undefined | null): string {
  return (s ?? '').normalize('NFC').trim().toLowerCase()
}

/** Normaliza texto de modificador para comparação: minúsculas e números viram '#'. */
export function normMod(s: string): string {
  return norm(s)
    .replace(/[+-]?\d+(?:\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
}

function push<K>(map: Map<K, PriceEntry[]>, key: K, entry: PriceEntry): void {
  const list = map.get(key)
  if (list) list.push(entry)
  else map.set(key, [entry])
}

function fromLine(line: ItemLine, category: string): PriceEntry {
  return {
    name: line.name,
    chaos: line.chaosValue,
    category,
    listings: Math.max(line.count ?? 0, line.listingCount ?? 0),
    baseType: line.baseType,
    variant: line.variant,
    links: line.links,
    gemLevel: line.gemLevel,
    gemQuality: line.gemQuality,
    corrupted: line.corrupted,
    level: line.levelRequired,
    itemClass: line.itemClass,
    detailsId: line.detailsId,
    icon: line.icon,
    mutated: line.mutated?.map(normMod)
  }
}

const CDN = 'https://web.poecdn.com'

/**
 * Índice de preços montado a partir de todas as categorias do poe.ninja.
 * As chaves são sempre normalizadas com norm().
 */
export class PriceIndex {
  divineChaos = 0
  readonly exchange = new Map<string, PriceEntry>()
  readonly currencyFallback = new Map<string, PriceEntry>()
  readonly unique = new Map<string, PriceEntry[]>()
  readonly uniqueByBase = new Map<string, PriceEntry[]>()
  readonly gems = new Map<string, PriceEntry[]>()
  readonly imbued = new Map<string, PriceEntry[]>()
  readonly maps = new Map<string, PriceEntry[]>()
  readonly valdo = new Map<string, PriceEntry[]>()
  readonly cluster = new Map<string, PriceEntry[]>()
  readonly baseTypes = new Map<string, PriceEntry>()
  readonly flasks = new Map<string, PriceEntry[]>()
  readonly wombgifts = new Map<string, PriceEntry[]>()
  readonly misc = new Map<string, PriceEntry[]>()
  readonly temples: PriceEntry[] = []
  readonly scrying: PriceEntry[] = []
  size = 0

  static build(input: PriceIndexInput): PriceIndex {
    const idx = new PriceIndex()

    for (const [type, data] of Object.entries(input.exchange)) {
      if (!data?.lines) continue
      const meta = new Map(data.items?.map((i) => [i.id, i]) ?? [])
      for (const line of data.lines) {
        const m = meta.get(line.id)
        if (!m?.name || !(line.primaryValue > 0)) continue
        const entry: PriceEntry = {
          name: m.name,
          chaos: line.primaryValue,
          category: type,
          listings: Number.POSITIVE_INFINITY,
          detailsId: m.detailsId,
          icon: m.image ? (m.image.startsWith('http') ? m.image : CDN + m.image) : undefined
        }
        const key = norm(m.name)
        const prev = idx.exchange.get(key)
        // Em caso de nome repetido entre categorias, mantém o primeiro (Currency vem antes).
        if (!prev) idx.exchange.set(key, entry)
        idx.size++
      }
      if (type === 'Currency') {
        const divLine = data.lines.find((l) => l.id === 'divine')
        const rate = data.core?.rates?.divine
        if (divLine && divLine.primaryValue > 0) idx.divineChaos = divLine.primaryValue
        else if (rate && rate > 0) idx.divineChaos = 1 / rate
      }
    }

    for (const [type, data] of Object.entries(input.currency)) {
      if (!data?.lines) continue
      for (const line of data.lines) {
        if (!(line.chaosEquivalent > 0)) continue
        const key = norm(line.currencyTypeName)
        if (!idx.currencyFallback.has(key)) {
          idx.currencyFallback.set(key, {
            name: line.currencyTypeName,
            chaos: line.chaosEquivalent,
            category: type,
            listings: Number.POSITIVE_INFINITY,
            detailsId: line.detailsId
          })
          idx.size++
        }
        if (!idx.divineChaos && key === 'divine orb') idx.divineChaos = line.chaosEquivalent
      }
    }

    for (const [type, data] of Object.entries(input.item)) {
      if (!data?.lines) continue
      for (const line of data.lines) {
        if (!(line.chaosValue > 0) || !line.name) continue
        const e = fromLine(line, type)
        idx.size++
        if (UNIQUE_TYPES.has(type)) {
          push(idx.unique, norm(line.name), e)
          if (line.baseType) push(idx.uniqueByBase, norm(line.baseType), e)
        } else if (type === 'SkillGem') push(idx.gems, norm(line.name), e)
        else if (type === 'ImbuedGem') push(idx.imbued, norm(line.name), e)
        else if (MAP_TYPES.has(type)) push(idx.maps, norm(line.name), e)
        else if (type === 'ValdoMap') push(idx.valdo, norm(line.name), e)
        else if (type === 'ClusterJewel') push(idx.cluster, `${norm(line.name)}|${norm(line.variant)}`, e)
        else if (type === 'BaseType') {
          const key = `${norm(line.name)}|${line.levelRequired ?? 0}|${norm(line.variant)}`
          const prev = idx.baseTypes.get(key)
          if (!prev || e.listings > prev.listings) idx.baseTypes.set(key, e)
        } else if (type === 'Flask') push(idx.flasks, norm(line.name), e)
        else if (type === 'Wombgift') push(idx.wombgifts, norm(line.name), e)
        else if (type === 'IncursionTemple') idx.temples.push(e)
        else if (type === 'ScryingOrb') idx.scrying.push(e)
        else if (MISC_TYPES.has(type)) push(idx.misc, norm(line.name), e)
        else push(idx.misc, norm(line.name), e)
      }
    }

    return idx
  }

  /** Monta o índice a partir do cache compacto gravado pelo backend. */
  static fromCompact(cats: CompactPrices): PriceIndex {
    return PriceIndex.build(fromCompact(cats))
  }
}
