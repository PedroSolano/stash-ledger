import type { Confidence, PoeItem, PricedItem } from '../../shared/types'
import { normalizeItem } from './normalize'
import { norm, normMod, type PriceEntry, type PriceIndex } from './priceIndex'

export interface PricingOptions {
  priceBaseTypes: boolean
  /** Abaixo desse número de amostras o preço de stash é marcado como baixa confiança. */
  lowConfidenceListings: number
}

export const DEFAULT_PRICING: PricingOptions = { priceBaseTypes: true, lowConfidenceListings: 5 }

export interface PriceMatch {
  chaos: number
  category: string
  confidence: Confidence
  approximate: boolean
  detail?: string
  detailsId?: string
  icon?: string
}

/* ---------- Leitura de dados do item ---------- */

const FRAME = { normal: 0, magic: 1, rare: 2, unique: 3, gem: 4, currency: 5, card: 6, relic: 9, supporterFoil: 10 }

function prop(item: PoeItem, name: string): string | undefined {
  const p = item.properties?.find((x) => x.name === name)
  return p?.values?.[0]?.[0]
}

function propInt(item: PoeItem, name: string): number {
  const raw = prop(item, name)
  if (!raw) return 0
  const m = /-?\d+/.exec(raw)
  return m ? parseInt(m[0], 10) : 0
}

/** Maior grupo de soquetes ligados. */
export function maxLinks(item: PoeItem): number {
  if (!item.sockets?.length) return 0
  const groups = new Map<number, number>()
  for (const s of item.sockets) groups.set(s.group, (groups.get(s.group) ?? 0) + 1)
  return Math.max(...groups.values())
}

function allTexts(item: PoeItem): string[] {
  const texts = [
    ...(item.enchantMods ?? []),
    ...(item.implicitMods ?? []),
    ...(item.explicitMods ?? []),
    ...(item.craftedMods ?? []),
    ...(item.fracturedMods ?? []),
    ...(item.mutatedMods ?? []),
    ...(item.utilityMods ?? [])
  ]
  for (const p of [...(item.properties ?? []), ...(item.additionalProperties ?? [])]) {
    texts.push(p.name)
    for (const v of p.values ?? []) texts.push(v[0])
  }
  if (item.descrText) texts.push(item.descrText)
  if (item.secDescrText) texts.push(item.secDescrText)
  return texts
    .filter((t): t is string => typeof t === 'string')
    .flatMap((t) => t.split('\n'))
    .map(norm)
}

const INFLUENCE_ORDER = ['shaper', 'elder', 'crusader', 'redeemer', 'warlord', 'hunter'] as const

function influenceVariant(item: PoeItem): string {
  const inf = item.influences ?? {}
  return INFLUENCE_ORDER.filter((k) => inf[k])
    .map((k) => k[0].toUpperCase() + k.slice(1))
    .join('/')
}

function stripQualityPrefix(s: string): string {
  return s.replace(/^(Superior|Anomalous|Divergent|Phantasmal|Synthesised)\s+/i, '')
}

function isMap(item: PoeItem): boolean {
  if (item.properties?.some((p) => p.name === 'Map Tier')) return true
  return /\bMap\b/.test(item.baseType) && !/Valdo Map/.test(item.baseType)
}

/* ---------- Seleção entre candidatos ---------- */

function confidenceOf(e: PriceEntry, opts: PricingOptions): Confidence {
  return e.listings < opts.lowConfidenceListings ? 'low' : 'high'
}

function toMatch(e: PriceEntry, opts: PricingOptions, approximate = false, detail?: string): PriceMatch {
  return {
    chaos: e.chaos,
    category: e.category,
    confidence: confidenceOf(e, opts),
    approximate,
    detail: detail ?? e.variant,
    detailsId: e.detailsId,
    icon: e.icon
  }
}

function cheapest(list: PriceEntry[]): PriceEntry {
  return list.reduce((a, b) => (b.chaos < a.chaos ? b : a))
}

function mostListed(list: PriceEntry[]): PriceEntry {
  return list.reduce((a, b) => (b.listings > a.listings ? b : a))
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Uma parte da variante (ex.: "#% more Damage") casa com algum texto do item? */
function variantPartMatches(part: string, texts: string[]): boolean {
  const p = norm(part)
  if (!p) return false
  if (p.includes('#')) {
    const re = new RegExp(escapeRegex(p).replace(/#/g, '[+-]?\\d+(?:\\.\\d+)?'))
    return texts.some((t) => re.test(t))
  }
  return texts.some((t) => t.includes(p))
}

/** Regras específicas para variantes que não aparecem literalmente nos modificadores. */
function specialVariant(entry: PriceEntry, texts: string[]): boolean | undefined {
  if (norm(entry.name) === 'mageblood' && entry.variant) {
    const m = /(\d+)\s+flasks?/i.exec(entry.variant)
    const t = texts.find((x) => /leftmost \d+ magic utility flasks/.test(x))
    if (m && t) return t.includes(`leftmost ${m[1]} `)
  }
  return undefined
}

/**
 * Escolhe a melhor entrada entre variantes do mesmo item.
 * Ordem: modificadores mutados idênticos (Foulborn) > variante que casa com os mods >
 * entrada sem variante > mais barata (marcada como aproximada, para não inflar o patrimônio).
 */
function pickVariant(
  cands: PriceEntry[],
  item: PoeItem,
  opts: PricingOptions,
  approxIn = false,
  detail?: (e: PriceEntry) => string | undefined
): PriceMatch {
  const d = detail ?? ((e: PriceEntry) => e.variant)
  if (cands.length === 1) return toMatch(cands[0], opts, approxIn, d(cands[0]))

  const itemMutated = (item.mutatedMods ?? []).map(normMod).sort()
  if (itemMutated.length) {
    const exact = cands.filter((c) => c.mutated && [...c.mutated].sort().join('|') === itemMutated.join('|'))
    if (exact.length) {
      const e = mostListed(exact)
      return toMatch(e, opts, approxIn, d(e))
    }
  }

  const texts = allTexts(item)
  const matched = cands.filter((c) => {
    if (!c.variant) return false
    const special = specialVariant(c, texts)
    if (special !== undefined) return special
    return c.variant.split(/,\s*/).every((part) => variantPartMatches(part, texts))
  })
  if (matched.length) {
    const best = matched.reduce((a, b) => {
      const pa = a.variant!.split(',').length
      const pb = b.variant!.split(',').length
      if (pb !== pa) return pb > pa ? b : a
      return b.listings > a.listings ? b : a
    })
    return toMatch(best, opts, approxIn, d(best))
  }

  const plain = cands.filter((c) => !c.variant)
  if (plain.length) {
    const e = mostListed(plain)
    return toMatch(e, opts, approxIn, d(e))
  }
  const e = cheapest(cands)
  return toMatch(e, opts, true, d(e))
}

/** Escolhe a maior faixa de nível (levelRequired) que não passa do ilvl do item. */
function pickByLevel(cands: PriceEntry[], ilvl: number): PriceEntry[] {
  const eligible = cands.filter((c) => (c.level ?? 0) <= ilvl)
  if (!eligible.length) return []
  const top = Math.max(...eligible.map((c) => c.level ?? 0))
  return eligible.filter((c) => (c.level ?? 0) === top)
}

/* ---------- Casadores por tipo de item ---------- */

function priceGem(item: PoeItem, idx: PriceIndex, opts: PricingOptions): PriceMatch | null {
  const name = stripQualityPrefix(item.typeLine)
  const level = propInt(item, 'Level') || 1
  const quality = propInt(item, 'Quality')
  const corrupted = !!item.corrupted
  const detail = `${level}${quality ? `/${quality}` : ''}${corrupted ? 'c' : ''}`

  const imbued = idx.imbued.get(norm(name))
  if (imbued?.length) {
    const texts = allTexts(item)
    const hit = imbued.filter((c) => c.variant && variantPartMatches(c.variant, texts))
    if (hit.length) {
      const e = mostListed(hit)
      return toMatch(e, opts, false, `${detail} · ${e.variant}`)
    }
  }

  const cands = idx.gems.get(norm(name))
  if (!cands?.length) return null
  const exact = cands.filter(
    (c) => (c.gemLevel ?? 1) === level && (c.gemQuality ?? 0) === quality && !!c.corrupted === corrupted
  )
  if (exact.length) return toMatch(mostListed(exact), opts, false, detail)

  // Sem variante exata: usa a melhor variante "dominada" (nível e qualidade <= aos do item).
  const dominated = cands.filter(
    (c) => !!c.corrupted === corrupted && (c.gemLevel ?? 1) <= level && (c.gemQuality ?? 0) <= quality
  )
  if (dominated.length) {
    const best = dominated.reduce((a, b) => {
      const sa = (a.gemLevel ?? 1) * 100 + (a.gemQuality ?? 0)
      const sb = (b.gemLevel ?? 1) * 100 + (b.gemQuality ?? 0)
      return sb > sa ? b : a
    })
    return toMatch(best, opts, true, detail)
  }
  return toMatch(cheapest(cands), opts, true, detail)
}

function priceUnique(item: PoeItem, idx: PriceIndex, opts: PricingOptions): PriceMatch | null {
  const links = maxLinks(item)
  const linkKey = links >= 6 ? 6 : links === 5 ? 5 : 0
  const linkDetail = linkKey ? `${linkKey}L` : undefined

  // Único não identificado: não sabemos qual é; usa o único mais barato dessa base.
  if (!item.identified || !item.name) {
    const byBase = idx.uniqueByBase.get(norm(item.baseType))?.filter((c) => !c.links)
    if (!byBase?.length) return null
    return toMatch(cheapest(byBase), opts, true, 'não identificado')
  }

  const foulborn = !!item.mutated || (item.mutatedMods?.length ?? 0) > 0
  const names = foulborn && !/^foulborn /i.test(item.name) ? [`Foulborn ${item.name}`, item.name] : [item.name]
  let cands: PriceEntry[] | undefined
  for (const n of names) {
    cands = idx.unique.get(norm(n))
    if (cands?.length) break
  }
  if (!cands?.length) return null

  const isRelic = item.frameType === FRAME.relic || !!item.isRelic
  const relicFiltered = cands.filter((c) => (c.category === 'UniqueRelic') === isRelic)
  if (relicFiltered.length) cands = relicFiltered

  const sameBase = cands.filter((c) => !c.baseType || norm(c.baseType) === norm(item.baseType))
  if (sameBase.length) cands = sameBase

  const anyLinks = cands.some((c) => c.links)
  let approx = false
  if (anyLinks) {
    const exact = cands.filter((c) => (c.links ?? 0) === linkKey)
    if (exact.length) cands = exact
    else {
      const lower = cands.filter((c) => (c.links ?? 0) < linkKey || !c.links)
      if (!lower.length) return null
      cands = lower
      approx = true
    }
  }
  return pickVariant(cands, item, opts, approx, (e) => [linkDetail, e.variant].filter(Boolean).join(' · ') || undefined)
}

function priceMap(item: PoeItem, idx: PriceIndex, opts: PricingOptions): PriceMatch | null {
  const base = stripQualityPrefix(item.baseType)
  const tl = item.typeLine
  const tier = propInt(item, 'Map Tier')
  const names: string[] = []
  if (/blight-ravaged/i.test(tl)) names.push(`Blight-ravaged ${base}`)
  else if (/blighted/i.test(tl)) names.push(`Blighted ${base}`)
  names.push(base)
  for (const n of names) {
    const cands = idx.maps.get(norm(n))
    if (!cands?.length) continue
    // Prefere a geração de atlas mais recente (variant "Gen-NN").
    const gen = (e: PriceEntry) => {
      const m = /gen-(\d+)/i.exec(e.variant ?? '')
      return m ? parseInt(m[1], 10) : -1
    }
    const best = cands.reduce((a, b) => (gen(b) > gen(a) || (gen(b) === gen(a) && b.listings > a.listings) ? b : a))
    return toMatch(best, opts, n === base && names.length > 1, tier ? `T${tier}` : undefined)
  }
  return null
}

function priceValdo(item: PoeItem, idx: PriceIndex, opts: PricingOptions): PriceMatch | null {
  const cands = idx.valdo.get(norm(item.name || item.typeLine))
  if (!cands?.length) return null
  return pickVariant(cands, item, opts)
}

function priceCluster(item: PoeItem, idx: PriceIndex, opts: PricingOptions): PriceMatch | null {
  const ench = (item.enchantMods ?? []).filter((m) => typeof m === 'string').flatMap((m) => m.split('\n'))
  let passives: string | undefined
  let grant: string | undefined
  for (const m of ench) {
    const p = /Adds (\d+) Passive Skills/i.exec(m)
    if (p) passives = p[1]
    const g = /Added Small Passive Skills grant: (.+)/i.exec(m)
    if (g && !grant) grant = g[1]
  }
  if (!passives || !grant) return null
  const cands = idx.cluster.get(`${norm(grant)}|${norm(`${passives} passives`)}`)
  if (!cands?.length) return null
  const sameBase = cands.filter((c) => norm(c.baseType) === norm(item.baseType))
  const byLevel = pickByLevel(sameBase.length ? sameBase : cands, item.ilvl)
  if (!byLevel.length) return null
  const sameClass = byLevel.filter((c) => c.itemClass === item.frameType)
  const e = sameClass.length ? mostListed(sameClass) : cheapest(byLevel)
  return toMatch(e, opts, !sameClass.length, `${passives} passivas · ilvl ${item.ilvl}`)
}

function priceLeveled(
  map: Map<string, PriceEntry[]>,
  key: string,
  item: PoeItem,
  opts: PricingOptions,
  detail: string
): PriceMatch | null {
  const cands = map.get(norm(key))
  if (!cands?.length) return null
  const byLevel = pickByLevel(cands, item.ilvl)
  if (!byLevel.length) return null
  const sameClass = byLevel.filter((c) => c.itemClass === item.frameType)
  const e = sameClass.length ? mostListed(sameClass) : cheapest(byLevel)
  return toMatch(e, opts, false, detail)
}

function priceBase(item: PoeItem, idx: PriceIndex, opts: PricingOptions): PriceMatch | null {
  if (item.ilvl < 82 || item.corrupted) return null
  const bucket = Math.min(item.ilvl, 86)
  const variant = influenceVariant(item)
  const base = stripQualityPrefix(item.baseType)
  const e = idx.baseTypes.get(`${norm(base)}|${bucket}|${norm(variant)}`)
  if (!e) return null
  return toMatch(e, opts, false, `ilvl ${item.ilvl}${variant ? ` · ${variant}` : ''}`)
}

/** Itens com várias "salas"/áreas listadas (templos, orbes de vidência): vale a melhor encontrada. */
function priceByContainedName(list: PriceEntry[], item: PoeItem, opts: PricingOptions): PriceMatch | null {
  if (!list.length) return null
  const texts = allTexts(item)
  const own = norm(item.name)
  const hits = list.filter((e) => {
    const n = norm(e.name)
    return own === n || texts.some((t) => t === n || t.includes(n))
  })
  if (!hits.length) return null
  const best = hits.reduce((a, b) => (b.chaos > a.chaos ? b : a))
  return toMatch(best, opts, hits.length > 1, best.name)
}

function exchangeLookup(idx: PriceIndex, name: string): PriceEntry | undefined {
  const key = norm(name)
  return idx.exchange.get(key) ?? idx.currencyFallback.get(key)
}

/* ---------- Entrada principal ---------- */

export function priceItem(item: PoeItem, idx: PriceIndex, opts: PricingOptions = DEFAULT_PRICING): PriceMatch | null {
  const ft = item.frameType ?? FRAME.normal

  if (ft === FRAME.gem) return priceGem(item, idx, opts)

  if (ft === FRAME.card || ft === FRAME.currency) {
    const e = exchangeLookup(idx, item.typeLine) ?? exchangeLookup(idx, item.baseType)
    if (e) return toMatch(e, opts)
    // Alguns itens "moeda" (wombgifts, cadáveres, vísceras...) só existem nas categorias de stash:
    // segue para os casadores genéricos abaixo.
  }

  if (item.baseType === 'Valdo Map') return priceValdo(item, idx, opts)

  if (ft === FRAME.unique || ft === FRAME.relic || ft === FRAME.supporterFoil) {
    const u = priceUnique(item, idx, opts)
    if (u) return u
    const misc = idx.misc.get(norm(item.name)) ?? idx.misc.get(norm(item.typeLine))
    return misc?.length ? pickVariant(misc, item, opts) : null
  }

  if (isMap(item)) {
    const m = priceMap(item, idx, opts)
    if (m) return m
  }

  // Fragmentos, escaravelhos, oils etc. podem vir com frameType normal.
  const ex = exchangeLookup(idx, item.typeLine) ?? exchangeLookup(idx, item.baseType)
  if (ex) return toMatch(ex, opts)

  if (/Cluster Jewel$/.test(item.baseType)) {
    const c = priceCluster(item, idx, opts)
    if (c) return c
  }

  if (/Wombgift$/.test(item.baseType)) {
    return priceLeveled(idx.wombgifts, item.baseType, item, opts, `ilvl ${item.ilvl}`)
  }

  if (item.baseType === 'Chronicle of Atzoatl') return priceByContainedName(idx.temples, item, opts)
  if (item.baseType === 'Scrying Orb') return priceByContainedName(idx.scrying, item, opts)

  const misc = idx.misc.get(norm(item.typeLine)) ?? idx.misc.get(norm(item.baseType)) ?? idx.misc.get(norm(item.name))
  if (misc?.length) return pickVariant(misc, item, opts)

  if (/Flask$/.test(item.baseType) && ft <= FRAME.magic && item.ilvl >= 82) {
    const f = priceLeveled(idx.flasks, stripQualityPrefix(item.baseType), item, opts, `ilvl ${item.ilvl}`)
    if (f) return f
  }

  if (opts.priceBaseTypes && ft <= FRAME.rare) return priceBase(item, idx, opts)
  return null
}

/* ---------- Avaliação de uma lista de itens (agrupada) ---------- */

export interface TabItems {
  tabId: string
  tabName: string
  items: PoeItem[]
}

export interface ValuationResult {
  items: PricedItem[]
  byTab: Map<string, { chaos: number; itemCount: number }>
  totalChaos: number
  itemCount: number
  pricedCount: number
  errorCount: number
}

function displayName(item: PoeItem): string {
  if (item.name && item.frameType !== FRAME.gem) return `${item.name} ${item.typeLine}`.trim()
  return item.typeLine
}

/** Inclui itens soquetados (gemas dentro de equipamentos). */
function flatten(items: PoeItem[]): PoeItem[] {
  const out: PoeItem[] = []
  for (const it of items) {
    out.push(it)
    const socketed = (it as PoeItem & { socketedItems?: PoeItem[] }).socketedItems
    if (socketed?.length) out.push(...socketed)
  }
  return out
}

export function valueItems(
  tabs: TabItems[],
  idx: PriceIndex,
  opts: PricingOptions & {
    includeLowConfidence: boolean
    /** Chamado quando um item não pôde ser precificado por erro (o snapshot continua). */
    onItemError?: (err: unknown, item: PoeItem) => void
  }
): ValuationResult {
  const groups = new Map<string, PricedItem>()
  const byTab = new Map<string, { chaos: number; itemCount: number }>()
  let totalChaos = 0
  let itemCount = 0
  let pricedCount = 0
  let errorCount = 0

  for (const tab of tabs) {
    const tabAgg = byTab.get(tab.tabId) ?? { chaos: 0, itemCount: 0 }
    const items = Array.isArray(tab.items) ? tab.items.map((raw) => normalizeItem(raw)) : []
    for (const item of flatten(items)) {
      const qty = Math.max(1, item.stackSize ?? 1)
      let match: PriceMatch | null = null
      try {
        match = priceItem(item, idx, opts)
      } catch (err) {
        errorCount++
        opts.onItemError?.(err, item)
      }
      const counts = !!match && (opts.includeLowConfidence || match.confidence === 'high')
      const unit = match?.chaos ?? 0
      const total = unit * qty
      itemCount++
      tabAgg.itemCount++
      if (match) pricedCount++
      if (counts) {
        totalChaos += total
        tabAgg.chaos += total
      }

      const key = [item.frameType ?? 0, item.name, item.typeLine, match?.detail ?? '', match?.category ?? ''].join('|')
      const g = groups.get(key)
      if (g) {
        g.quantity += qty
        g.totalChaos += total
        if (!g.tabs.includes(tab.tabName)) g.tabs.push(tab.tabName)
      } else {
        groups.set(key, {
          key,
          name: displayName(item),
          typeLine: item.typeLine,
          icon: item.icon || match?.icon || '',
          frameType: item.frameType ?? 0,
          quantity: qty,
          unitChaos: unit,
          totalChaos: total,
          counted: counts,
          category: match?.category,
          confidence: match?.confidence,
          approximate: match?.approximate,
          detail: match?.detail,
          tabs: [tab.tabName]
        })
      }
    }
    byTab.set(tab.tabId, tabAgg)
  }

  const sorted = [...groups.values()].sort((a, b) => b.totalChaos - a.totalChaos || b.unitChaos - a.unitChaos)
  return { items: sorted, byTab, totalChaos, itemCount, pricedCount, errorCount }
}
