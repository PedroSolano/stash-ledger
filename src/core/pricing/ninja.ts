// Formato compacto do cache de preços do poe.ninja, gravado pelo backend Rust (src-tauri/src/ninja.rs).
// O Rust baixa as 50 categorias, guarda só os campos usados na precificação em listas posicionais
// (sem nomes de campo repetidos) e grava um único arquivo gzip por liga.
// Referência da API: https://poe.ninja/docs/api

/** Linha de câmbio: [nome, valor em chaos, caminho do ícone] */
export type CompactExchangeLine = [string, number, string]

/**
 * Linha de item de stash:
 * [nome, base, variante, links, nível da gema, qualidade, corrompido (0/1), nível/ilvl,
 *  itemClass (-1 = ausente), chaos, anúncios, modificadores mutados (lista) ou 0]
 */
export type CompactItemLine = [string, string, string, number, number, number, number, number, number, number, number, string[] | 0]

/** Linha de moeda (endpoint legado de reserva): [nome, chaos] */
export type CompactCurrencyLine = [string, number]

export type CompactCategory =
  | { k: 'e'; div?: number; l: CompactExchangeLine[] }
  | { k: 'i'; l: CompactItemLine[] }
  | { k: 'c'; l: CompactCurrencyLine[] }

/** Chave = "<tipo>_<categoria>", ex.: "exchange_Currency", "item_UniqueArmour". */
export type CompactPrices = Record<string, CompactCategory>

/* ---------- Formas usadas pelo índice de preços ---------- */

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

export interface PriceIndexInput {
  exchange: Record<string, ExchangeResponse | undefined>
  item: Record<string, ItemResponse | undefined>
  currency: Record<string, CurrencyResponse | undefined>
}

function itemLine(l: CompactItemLine): ItemLine {
  const [name, baseType, variant, links, gemLevel, gemQuality, corrupted, level, itemClass, chaos, listings, mutated] = l
  const out: ItemLine = { name, chaosValue: chaos, listingCount: listings }
  if (baseType) out.baseType = baseType
  if (variant) out.variant = variant
  if (links) out.links = links
  if (gemLevel) out.gemLevel = gemLevel
  if (gemQuality) out.gemQuality = gemQuality
  if (corrupted) out.corrupted = true
  if (level) out.levelRequired = level
  if (itemClass >= 0) out.itemClass = itemClass
  if (Array.isArray(mutated) && mutated.length) out.mutated = mutated
  return out
}

/** Converte o cache compacto nas formas que o PriceIndex consome. Currency vem primeiro (prioridade). */
export function fromCompact(cats: CompactPrices): PriceIndexInput {
  const input: PriceIndexInput = { exchange: {}, item: {}, currency: {} }
  const keys = Object.keys(cats).sort((a, b) => (a === 'exchange_Currency' ? -1 : b === 'exchange_Currency' ? 1 : 0))
  for (const key of keys) {
    const cat = cats[key]
    const type = key.slice(key.indexOf('_') + 1)
    if (!cat || !Array.isArray(cat.l)) continue
    if (cat.k === 'e') {
      // O índice reconhece o divine pelo id 'divine'; usar o valor direto evita erro de arredondamento.
      const id = (l: CompactExchangeLine, i: number): string => (l[0] === 'Divine Orb' && type === 'Currency' ? 'divine' : String(i))
      const lines = cat.l.map((l, i) => ({ id: id(l, i), primaryValue: l[1] }))
      if (type === 'Currency' && cat.div && cat.div > 0 && !lines.some((l) => l.id === 'divine')) {
        lines.push({ id: 'divine', primaryValue: cat.div })
      }
      input.exchange[type] = {
        lines,
        items: cat.l.map((l, i) => ({ id: id(l, i), name: l[0], image: l[2] || undefined }))
      }
    } else if (cat.k === 'i') {
      input.item[type] = { lines: cat.l.map(itemLine) }
    } else if (cat.k === 'c') {
      input.currency[type] = { lines: cat.l.map(([currencyTypeName, chaosEquivalent]) => ({ currencyTypeName, chaosEquivalent })) }
    }
  }
  return input
}
