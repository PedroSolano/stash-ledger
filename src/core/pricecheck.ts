import type { PoeItem, PriceCheckResult } from '../shared/types'
import { magicBaseCandidates, parseItemText } from './pricing/clipboard'
import { norm, type PriceEntry, type PriceIndex } from './pricing/priceIndex'
import { priceItem, type PriceMatch, type PricingOptions } from './pricing/priceItem'

/** Nome para mostrar: "Kaom's Heart" / "Divine Orb" / base do raro. */
function displayName(item: PoeItem): string {
  return item.name || item.typeLine
}

/** Itens mágicos: tenta a base escondida no meio do nome (mapas, frascos, bases 82+). */
function priceMagic(item: PoeItem, idx: PriceIndex, opts: PricingOptions): PriceMatch | null {
  for (const base of magicBaseCandidates(item.typeLine)) {
    const cleanBase = base.replace(/^(Blighted|Blight-ravaged)\s+/i, '')
    const m = priceItem({ ...item, baseType: cleanBase }, idx, opts)
    if (m) return m
  }
  return null
}

/** Únicos possíveis para um único não identificado dessa base (um por nome, a variante mais listada). */
function uniqueCandidates(item: PoeItem, idx: PriceIndex, opts: PricingOptions): PriceCheckResult['candidates'] {
  const list = idx.uniqueByBase.get(norm(item.baseType))?.filter((e) => !e.links && !e.mutated?.length) ?? []
  const byName = new Map<string, PriceEntry>()
  for (const e of list) {
    const cur = byName.get(e.name)
    if (!cur || e.listings > cur.listings) byName.set(e.name, e)
  }
  return [...byName.values()]
    .sort((a, b) => b.chaos - a.chaos)
    .slice(0, 8)
    .map((e) => ({
      name: e.name,
      chaos: e.chaos,
      confidence: e.listings < opts.lowConfidenceListings ? ('low' as const) : ('high' as const),
      detail: e.variant,
      icon: e.icon
    }))
}

/** Precifica o texto copiado do jogo (Ctrl+C) com o índice do poe.ninja. */
export function checkPrice(
  text: string,
  idx: PriceIndex,
  opts: PricingOptions,
  meta: { league: string; updatedAt: number | null }
): PriceCheckResult {
  const parsed = parseItemText(text)
  const base = { divineChaos: idx.divineChaos, league: meta.league, pricesUpdatedAt: meta.updatedAt }
  if (!parsed) {
    return { ...base, ok: false, name: 'Not an item', frameType: 0, quantity: 1, message: 'Hover an item in the game and try again.' }
  }
  const { item } = parsed
  const quantity = Math.max(1, item.stackSize ?? 1)
  const result: PriceCheckResult = {
    ...base,
    ok: true,
    name: displayName(item),
    base: item.name ? item.typeLine : undefined,
    frameType: item.frameType ?? 0,
    quantity
  }
  if (item.frameType === 3 && !item.identified) {
    const candidates = uniqueCandidates(item, idx, opts)
    if (candidates?.length) {
      result.candidates = candidates
      result.message =
        candidates.length > 1
          ? `Unidentified: one of ${candidates.length} uniques on this base.`
          : 'Unidentified: the only unique on this base.'
    }
  }
  const match = priceItem(item, idx, opts) ?? (item.frameType === 1 ? priceMagic(item, idx, opts) : null)
  if (!match) {
    result.message =
      item.frameType === 2 || item.frameType === 1
        ? 'poe.ninja has no price for this item. Rares and magic items need a trade search (coming in a later update).'
        : item.frameType === 3 && !item.identified
          ? 'poe.ninja has no price for this unidentified unique.'
          : 'poe.ninja has no price for this item.'
    return result
  }
  return {
    ...result,
    unitChaos: match.chaos,
    totalChaos: match.chaos * quantity,
    category: match.category,
    confidence: match.confidence,
    approximate: match.approximate,
    detail: match.detail,
    icon: match.icon
  }
}
