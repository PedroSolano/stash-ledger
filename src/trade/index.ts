/**
 * Busca na trade no estilo do Awakened PoE Trade. O parser, os filtros e a montagem da consulta são
 * do Awakened (MIT, código em ./apt com a licença); aqui fica só a cola com o Exile's Companion.
 */
import { init, ITEMS_ITERATOR, type BaseType } from '@/assets/data'
import { ItemCategory, ItemRarity, makeIdentifiedUnique, parseClipboard, type ParsedItem } from '@/parser'
import { createPresets } from '@/web/price-check/filters/create-presets'
import type { FilterOrGroup, FilterPreset, ItemFilters, StatFilter } from '@/web/price-check/filters/interfaces'
import { execBulkSearch, type BulkSearch } from '@/web/price-check/trade/pathofexile-bulk'
import { apiToSatisfySearch, setTradeTransport, tradeTag, type TradeTransport } from '@/web/price-check/trade/common'
import {
  createTradeRequest,
  requestResults,
  requestTradeResultList,
  type PricingResult
} from '@/web/price-check/trade/pathofexile-trade'

export type { BaseType, BulkSearch, FilterOrGroup, FilterPreset, ItemFilters, ParsedItem, PricingResult, StatFilter, TradeTransport }
export { ItemCategory, ItemRarity, setTradeTransport }

const TRADE_SITE = 'https://www.pathofexile.com'
/** A API de fetch aceita no máximo 10 ids por chamada. */
const FETCH_BATCH = 10

let loaded = false

/** Carrega os dados de mods e bases (uma vez por janela). */
export function loadTradeData(data: { stats: string; items: string }): void {
  init(data)
  loaded = true
}

export function tradeDataLoaded(): boolean {
  return loaded
}

export interface PreparedCheck {
  item: ParsedItem
  presets: FilterPreset[]
  active: string
}

export interface PrepareOptions {
  league: string
  /** Faixa (%) em volta do roll para os filtros mínimos (Awakened: 10). */
  searchStatRange?: number
  /** Só anúncios com compra imediata (merchant). */
  merchantOnly?: boolean
}

/** Palavras-chave com dica no jogo podem vir marcadas: "[Faster|faster]" → "faster", "[Faster]" → "Faster". */
export function cleanKeywordMarkup(text: string): string {
  return text.replace(/\[([^\]|\n]+)\|([^\]\n]+)\]/g, '$2').replace(/\[([^\]|\n]+)\]/g, '$1')
}

/**
 * Mods que o parser não reconheceu (mostrados na janela como "não pesquisáveis").
 * Como o Awakened (FiltersBlock.vue): nada para mapas e sentinels. Mapas são pesquisados por base,
 * tier e estado de blight, não pelos mods; os de mapas blighted nem existem como filtro.
 */
export function unknownMods(item: ParsedItem): Array<{ text: string; type: string }> {
  if (item.category === ItemCategory.Map || item.category === ItemCategory.Sentinel) return []
  return item.unknownModifiers.map((m) => ({ text: m.text, type: String(m.type) }))
}

/** Lê o texto copiado do jogo e monta os filtros como o Awakened monta. */
export function prepareCheck(text: string, opts: PrepareOptions): PreparedCheck | { error: string } {
  const parsed = parseClipboard(cleanKeywordMarkup(text))
  if (parsed.isErr()) return { error: parsed.error }
  return prepareItem(parsed.value, opts)
}

/** Filtros (presets) de um item já lido — por exemplo, um único não identificado depois de escolhido. */
export function prepareItem(item: ParsedItem, opts: PrepareOptions): PreparedCheck {
  const { presets, active } = createPresets(item, {
    league: opts.league,
    merchantOnly: opts.merchantOnly ?? true,
    currency: null,
    collapseListings: 'api',
    activateStockFilter: false,
    useEn: true,
    searchStatRange: opts.searchStatRange ?? 10
  })
  return { item, presets, active }
}

/** Únicos possíveis para um único não identificado (escolher um e pesquisar só ele). */
export function uniqueCandidates(item: ParsedItem): BaseType[] {
  if (item.rarity !== ItemRarity.Unique || !item.isUnidentified || item.info.unique) return []
  // Como o UnidentifiedResolver do Awakened: únicos cuja base é a base do item (sem variantes).
  const baseType = item.info.refName
  const possible: BaseType[] = []
  for (const match of ITEMS_ITERATOR(JSON.stringify(baseType))) {
    if (match.namespace === 'UNIQUE' && match.unique?.base === baseType && !possible.some((u) => u.refName === match.refName)) {
      possible.push(match)
    }
  }
  return possible
}

export function identifyAs(unique: BaseType, item: ParsedItem): ParsedItem {
  return makeIdentifiedUnique(unique, item)
}

/** Troca em massa (currency, fragmentos…) quando nenhum filtro de mod está ligado. */
export function searchKind(item: ParsedItem, preset: Pick<FilterPreset, 'filters' | 'stats'>): 'trade' | 'bulk' {
  return apiToSatisfySearch(item, preset.stats, preset.filters)
}

export interface TradeSearch {
  kind: 'trade'
  queryId: string
  total: number
  inexact?: boolean
  ids: string[]
  listings: PricingResult[]
  url: string
}

export async function searchTrade(filters: ItemFilters, stats: FilterOrGroup[]): Promise<TradeSearch> {
  const res = await requestTradeResultList(createTradeRequest(filters, stats), filters.trade.league)
  const listings = res.result.length ? await requestResults(res.id, res.result.slice(0, FETCH_BATCH), { accountName: '' }) : []
  return {
    kind: 'trade',
    queryId: res.id,
    total: res.total,
    inexact: res.inexact,
    ids: res.result,
    listings,
    url: `${TRADE_SITE}/trade/search/${encodeURIComponent(filters.trade.league)}/${res.id}`
  }
}

/** Próxima página de anúncios de uma busca já feita. */
export async function moreListings(search: TradeSearch): Promise<PricingResult[]> {
  const next = search.ids.slice(search.listings.length, search.listings.length + FETCH_BATCH)
  if (!next.length) return []
  return requestResults(search.queryId, next, { accountName: '' })
}

export interface BulkResult {
  kind: 'bulk'
  results: BulkSearch[]
  url: string
}

export async function searchBulk(item: ParsedItem, filters: ItemFilters): Promise<BulkResult> {
  // Como o TradeBulk do Awakened: Chaos se paga em divine, Divine em chaos, o resto nos dois.
  const have = item.info.refName === 'Chaos Orb' ? ['divine'] : item.info.refName === 'Divine Orb' ? ['chaos'] : ['divine', 'chaos']
  const first = await execBulkSearch(item, filters, have, { accountName: '' })
  const res: BulkSearch[] = []
  for (let i = 0; i < have.length; i++) {
    const r = first[i]
    if (r) res.push(r)
    else {
      // "Carregado sob demanda": uma busca só com essa moeda.
      const alone = (await execBulkSearch(item, filters, [have[i]], { accountName: '' }))[0]
      if (alone) res.push(alone)
    }
  }
  void tradeTag
  const queryId = res[0]?.queryId
  return {
    kind: 'bulk',
    results: res,
    url: queryId ? `${TRADE_SITE}/trade/exchange/${encodeURIComponent(filters.trade.league)}/${queryId}` : ''
  }
}

export function isStatFilter(f: FilterOrGroup): f is StatFilter {
  return !('group' in f && f.group)
}
