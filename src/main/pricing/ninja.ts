// Tipos e categorias da API pública de economia do poe.ninja (PoE 1).
// Referência oficial: https://poe.ninja/docs/api

/** Categorias servidas pelo endpoint de câmbio (/exchange/current/overview). */
export const EXCHANGE_TYPES = [
  'Currency',
  'Fragment',
  'Runegraft',
  'AllflameEmber',
  'Tattoo',
  'Omen',
  'DjinnCoin',
  'Ducat',
  'EnshroudingCrystal',
  'DivinationCard',
  'Artifact',
  'Oil',
  'DeliriumOrb',
  'Scarab',
  'Astrolabe',
  'Thread',
  'Fossil',
  'Resonator',
  'Essence'
] as const

/** Categorias servidas pelo endpoint de itens de stash (/stash/current/item/overview). */
export const STASH_ITEM_TYPES = [
  'Wombgift',
  'Corpse',
  'Viscera',
  'Incubator',
  'UniqueWeapon',
  'UniqueArmour',
  'UniqueAccessory',
  'UniqueFlask',
  'UniqueJewel',
  'ForbiddenJewel',
  'ShrineBelt',
  'UniqueTincture',
  'UniqueRelic',
  'SkillGem',
  'ImbuedGem',
  'ClusterJewel',
  'Map',
  'BlightedMap',
  'BlightRavagedMap',
  'UniqueMap',
  'ValdoMap',
  'Invitation',
  'Memory',
  'IncursionTemple',
  'ScryingOrb',
  'BaseType',
  'Flask',
  'Beast',
  'Vial'
] as const

/** Categorias do endpoint legado de moedas por stash (usado como reserva do câmbio). */
export const STASH_CURRENCY_TYPES = ['Currency', 'Fragment'] as const

export type ExchangeType = (typeof EXCHANGE_TYPES)[number]
export type StashItemType = (typeof STASH_ITEM_TYPES)[number]
export type StashCurrencyType = (typeof STASH_CURRENCY_TYPES)[number]

export type NinjaKind = 'exchange' | 'item' | 'currency'

export interface NinjaCategory {
  kind: NinjaKind
  type: string
}

export const ALL_CATEGORIES: NinjaCategory[] = [
  ...EXCHANGE_TYPES.map((type) => ({ kind: 'exchange' as const, type })),
  ...STASH_ITEM_TYPES.map((type) => ({ kind: 'item' as const, type })),
  ...STASH_CURRENCY_TYPES.map((type) => ({ kind: 'currency' as const, type }))
]

export function categoryPath(cat: NinjaCategory, league: string): string {
  const q = `league=${encodeURIComponent(league)}&type=${encodeURIComponent(cat.type)}`
  switch (cat.kind) {
    case 'exchange':
      return `/poe1/api/economy/exchange/current/overview?${q}`
    case 'item':
      return `/poe1/api/economy/stash/current/item/overview?${q}`
    case 'currency':
      return `/poe1/api/economy/stash/current/currency/overview?${q}`
  }
}

export function categoryId(cat: NinjaCategory): string {
  return `${cat.kind}_${cat.type}`
}

/* ---------- Formatos das respostas (somente os campos que usamos) ---------- */

export interface ExchangeResponse {
  core?: { primary?: string; secondary?: string; rates?: Record<string, number> }
  lines: { id: string; primaryValue: number; volumePrimaryValue?: number }[]
  items: { id: string; name: string; image?: string; category?: string; detailsId?: string }[]
}

export interface ItemLine {
  name: string
  baseType?: string
  variant?: string
  links?: number
  gemLevel?: number
  gemQuality?: number
  corrupted?: boolean
  levelRequired?: number
  mapTier?: number
  itemClass?: number
  itemType?: string
  chaosValue: number
  divineValue?: number
  count?: number
  listingCount?: number
  detailsId?: string
  icon?: string
  /** Textos dos modificadores mutados (itens "Foulborn"). */
  mutated?: string[]
}

export interface ItemResponse {
  lines: ItemLine[]
}

export interface CurrencyResponse {
  lines: { currencyTypeName: string; chaosEquivalent: number; detailsId?: string }[]
  currencyDetails?: { name: string; icon?: string }[]
}

export type NinjaPayload = ExchangeResponse | ItemResponse | CurrencyResponse

/**
 * Reduz a resposta crua para os campos necessários antes de gravar em cache.
 * As respostas de bases e gemas passam de vários MB por causa de modificadores e sparklines.
 */
export function stripPayload(kind: NinjaKind, raw: unknown): NinjaPayload {
  const r = (raw ?? {}) as Record<string, unknown>
  if (kind === 'exchange') {
    const core = (r.core ?? {}) as ExchangeResponse['core']
    const lines = Array.isArray(r.lines) ? (r.lines as Record<string, unknown>[]) : []
    const items = Array.isArray(r.items) ? (r.items as Record<string, unknown>[]) : []
    return {
      core: { primary: core?.primary, secondary: core?.secondary, rates: core?.rates },
      lines: lines.map((l) => ({
        id: String(l.id),
        primaryValue: Number(l.primaryValue) || 0,
        volumePrimaryValue: Number(l.volumePrimaryValue) || 0
      })),
      items: items.map((i) => ({
        id: String(i.id),
        name: String(i.name ?? ''),
        image: typeof i.image === 'string' ? i.image : undefined,
        category: typeof i.category === 'string' ? i.category : undefined,
        detailsId: typeof i.detailsId === 'string' ? i.detailsId : undefined
      }))
    }
  }
  if (kind === 'currency') {
    const lines = Array.isArray(r.lines) ? (r.lines as Record<string, unknown>[]) : []
    const details = Array.isArray(r.currencyDetails) ? (r.currencyDetails as Record<string, unknown>[]) : []
    return {
      lines: lines.map((l) => ({
        currencyTypeName: String(l.currencyTypeName ?? ''),
        chaosEquivalent: Number(l.chaosEquivalent) || 0,
        detailsId: typeof l.detailsId === 'string' ? l.detailsId : undefined
      })),
      currencyDetails: details.map((d) => ({
        name: String(d.name ?? ''),
        icon: typeof d.icon === 'string' ? d.icon : undefined
      }))
    }
  }
  const lines = Array.isArray(r.lines) ? (r.lines as Record<string, unknown>[]) : []
  return {
    lines: lines.map((l) => {
      const out: ItemLine = { name: String(l.name ?? ''), chaosValue: Number(l.chaosValue) || 0 }
      if (typeof l.baseType === 'string') out.baseType = l.baseType
      if (typeof l.variant === 'string' && l.variant) out.variant = l.variant
      if (typeof l.links === 'number' && l.links > 0) out.links = l.links
      if (typeof l.gemLevel === 'number') out.gemLevel = l.gemLevel
      if (typeof l.gemQuality === 'number') out.gemQuality = l.gemQuality
      if (l.corrupted === true) out.corrupted = true
      if (typeof l.levelRequired === 'number') out.levelRequired = l.levelRequired
      if (typeof l.mapTier === 'number' && l.mapTier > 0) out.mapTier = l.mapTier
      if (typeof l.itemClass === 'number') out.itemClass = l.itemClass
      if (typeof l.itemType === 'string') out.itemType = l.itemType
      if (typeof l.divineValue === 'number') out.divineValue = l.divineValue
      if (typeof l.count === 'number') out.count = l.count
      if (typeof l.listingCount === 'number') out.listingCount = l.listingCount
      if (typeof l.detailsId === 'string') out.detailsId = l.detailsId
      if (typeof l.icon === 'string') out.icon = l.icon
      if (Array.isArray(l.mutatedModifiers) && l.mutatedModifiers.length) {
        out.mutated = (l.mutatedModifiers as { text?: string }[])
          .map((m) => String(m?.text ?? ''))
          .filter(Boolean)
      }
      return out
    })
  }
}
