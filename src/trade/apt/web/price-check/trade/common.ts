// Adapted from Awakened PoE Trade (MIT, see ../../../../LICENSE): renderer/src/web/price-check/trade/common.ts.
// The network and the rate limiting live in Stash Ledger's Rust backend; requests go through the
// transport set with `setTradeTransport` (see src/trade/transport.ts).
import type { ItemFilters, FilterOrGroup } from '../filters/interfaces'
import type { ParsedItem } from '@/parser'

export interface Account {
  name: string
  lastCharacterName: string
  online?: {
    status?: 'afk'
  }
}

export type TradeResponse<T> =
  | (T & { error?: null })
  | {
      error: {
        code: number
        message: string
      }
    }

export function getTradeEndpoint(): string {
  return 'https://www.pathofexile.com'
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function apiToSatisfySearch(item: ParsedItem, stats: FilterOrGroup[], filters: ItemFilters): 'trade' | 'bulk' {
  if (stats.some((s) => (s.group ? !s.meta.disabled : !s.disabled))) {
    return 'trade'
  }
  return tradeTag(item) != null ? 'bulk' : 'trade'
}

export function tradeTag(item: ParsedItem): string | undefined {
  return item.info.tradeTag
}

export interface TradeTransport {
  search(leagueId: string, body: unknown): Promise<unknown>
  fetch(ids: string[], queryId: string): Promise<unknown>
  exchange(leagueId: string, body: unknown): Promise<unknown>
}

let transport: TradeTransport | null = null

export function setTradeTransport(t: TradeTransport): void {
  transport = t
}

export function tradeTransport(): TradeTransport {
  if (!transport) throw new Error('Trade transport not configured')
  return transport
}

/** "5m ago" style date (upstream uses luxon's toRelative({ style: 'short' })). */
export function relativeDate(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return `${s} sec. ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min. ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} hr. ago`
  const d = Math.round(h / 24)
  if (d < 60) return `${d} days ago`
  return `${Math.round(d / 30)} mo. ago`
}

/** Sets `obj.a.b.c = value` for the path "a.b.c" (upstream uses dot-prop). */
export function propSet(obj: object, path: string, value: unknown): void {
  const keys = path.split('.')
  let cur = obj as Record<string, unknown>
  for (const k of keys.slice(0, -1)) {
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {}
    cur = cur[k] as Record<string, unknown>
  }
  cur[keys[keys.length - 1]] = value
}
