import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import type { PriceCheckPayload } from '../../../shared/types'
import {
  identifyAs,
  isStatFilter,
  ItemRarity,
  moreListings,
  prepareCheck,
  prepareItem,
  searchBulk,
  searchKind,
  searchTrade,
  uniqueCandidates,
  type BaseType,
  type BulkResult,
  type FilterOrGroup,
  type ItemFilters,
  type ParsedItem,
  type PreparedCheck,
  type StatFilter,
  type TradeSearch
} from '../../../trade'
import { ago, num, price, rarityClass } from '../lib/format'

/* ---------- utilidades ---------- */

const RARITY_FRAME: Record<string, number> = { Normal: 0, Magic: 1, Rare: 2, Unique: 3 }

function frameOf(item: ParsedItem | undefined, fallback: number): number {
  if (!item) return fallback
  if (item.rarity) return RARITY_FRAME[item.rarity] ?? fallback
  return fallback
}

const CURRENCY_LABEL: Record<string, string> = {
  chaos: 'c',
  divine: 'div',
  exalted: 'ex',
  mirror: 'mirror',
  'mirror-shard': 'shard',
  alch: 'alch',
  vaal: 'vaal'
}
const currency = (c: string): string => CURRENCY_LABEL[c] ?? c

/** Texto do filtro com os valores do item no lugar de '#'. */
function statText(s: StatFilter): string {
  const v = s.roll?.value
  const t = s.text.trim()
  if (v === undefined) return t
  const shown = num(Math.round(v * 100) / 100, 2)
  // Um valor: no lugar do '#'. Dois (ex.: "Adds # to # Damage"): a busca usa a média, como no Awakened.
  return (t.match(/#/g)?.length ?? 0) === 1 ? t.replace('#', shown) : `${t} (avg ${shown})`
}

function rollPercent(s: StatFilter): number | null {
  const r = s.roll
  if (!r?.bounds || r.bounds.max === r.bounds.min) return null
  const p = (r.value - r.bounds.min) / (r.bounds.max - r.bounds.min)
  return Math.max(0, Math.min(100, Math.round(p * 100)))
}

const TAG_LABEL: Record<string, string> = {
  pseudo: 'pseudo',
  explicit: '',
  implicit: 'implicit',
  crafted: 'crafted',
  enchant: 'enchant',
  fractured: 'fractured',
  veiled: 'veiled',
  property: 'property',
  variant: 'variant'
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'trade'; data: TradeSearch; loadingMore?: boolean }
  | { status: 'bulk'; data: BulkResult }
  | { status: 'error'; message: string }

interface Check {
  payload: PriceCheckPayload
  prepared?: PreparedCheck
  error?: string
  presetId: string
  filters?: ItemFilters
  stats?: FilterOrGroup[]
}

function clone<T>(v: T): T {
  return structuredClone(v)
}

/* ---------- componentes pequenos ---------- */

function Chip(props: { on: boolean; onClick?: () => void; title?: string; children: React.ReactNode; warn?: boolean }) {
  return (
    <button
      type="button"
      className={`chip${props.on ? ' on' : ''}${props.warn ? ' warn' : ''}`}
      onClick={props.onClick}
      title={props.title}
      disabled={!props.onClick}
    >
      {props.children}
    </button>
  )
}

function NumInput(props: { value: number | '' | undefined; placeholder?: number; onChange: (v: number | '') => void; label: string }) {
  return (
    <input
      className="num"
      type="number"
      aria-label={props.label}
      value={props.value ?? ''}
      placeholder={props.placeholder !== undefined ? String(props.placeholder) : ''}
      onChange={(e) => props.onChange(e.target.value === '' ? '' : Number(e.target.value))}
    />
  )
}

function StatRow({ s, onChange, nested }: { s: StatFilter; onChange: () => void; nested?: boolean }) {
  const pct = rollPercent(s)
  const tag = TAG_LABEL[s.tag] ?? s.tag
  return (
    <div className={`stat${s.disabled ? ' off' : ''}${nested ? ' nested' : ''}`}>
      <label className="stat-main">
        <input
          type="checkbox"
          checked={!s.disabled}
          onChange={(e) => {
            s.disabled = !e.target.checked
            onChange()
          }}
        />
        <span className="stat-text">
          {statText(s)}
          {tag && <span className={`stat-tag t-${s.tag}`}>{tag}</span>}
        </span>
      </label>
      {s.roll && (
        <span className="stat-roll">
          {pct !== null && (
            <span className="pct" title="Roll within its tier range" style={{ ['--p' as string]: `${pct}%` }}>
              {pct}%
            </span>
          )}
          <NumInput
            label="Minimum"
            value={s.roll.min}
            placeholder={s.roll.default.min}
            onChange={(v) => {
              s.roll!.min = v
              s.disabled = false
              onChange()
            }}
          />
          <NumInput
            label="Maximum"
            value={s.roll.max}
            onChange={(v) => {
              s.roll!.max = v
              s.disabled = false
              onChange()
            }}
          />
        </span>
      )}
    </div>
  )
}

/* ---------- filtros do item (chips) ---------- */

function ItemChips({ f, item, onChange }: { f: ItemFilters; item: ParsedItem; onChange: () => void }) {
  const toggle = (o: { disabled: boolean }) => () => {
    o.disabled = !o.disabled
    onChange()
  }
  const chips: React.ReactNode[] = []
  if (f.searchRelaxed) {
    chips.push(
      <Chip key="relaxed" on={!f.searchRelaxed.disabled} onClick={toggle(f.searchRelaxed)} title="Search any base of this category">
        Any {f.searchRelaxed.category?.split('.').pop() ?? 'base'}
      </Chip>
    )
  }
  if (f.rarity) {
    chips.push(
      <Chip key="rarity" on={!f.rarity.disabled} onClick={toggle(f.rarity)}>
        {f.rarity.value === 'nonunique' ? 'Non-unique' : f.rarity.value}
      </Chip>
    )
  }
  const numeric = (key: keyof ItemFilters, label: (v: number) => string) => {
    const n = f[key] as { value: number; max?: number; disabled: boolean } | undefined
    if (!n) return
    chips.push(
      <Chip key={key} on={!n.disabled} onClick={toggle(n)}>
        {label(n.value)}
      </Chip>
    )
  }
  numeric('itemLevel', (v) => `iLvl ${v}+`)
  numeric('linkedSockets', (v) => `${v}L`)
  numeric('whiteSockets', (v) => `${v} white`)
  numeric('quality', (v) => `Q ${v}%+`)
  numeric('gemLevel', (v) => `Level ${v}+`)
  numeric('mapTier', (v) => `T${v}`)
  numeric('areaLevel', (v) => `Area ${v}+`)
  numeric('stackSize', (v) => `Stack ${v}+`)
  numeric('sentinelCharge', (v) => `Charge ${v}`)
  for (const inf of f.influences ?? []) {
    chips.push(
      <Chip key={`inf-${inf.value}`} on={!inf.disabled} onClick={toggle(inf)}>
        {inf.value}
      </Chip>
    )
  }
  if (f.corrupted) {
    chips.push(
      <Chip
        key="corrupted"
        on={!!f.corrupted.exact}
        warn={f.corrupted.value}
        onClick={() => {
          f.corrupted!.exact = !f.corrupted!.exact
          onChange()
        }}
        title={f.corrupted.exact ? 'Only items with the same corruption state' : 'Corrupted or not'}
      >
        {f.corrupted.value ? 'Corrupted' : 'Not corrupted'}
      </Chip>
    )
  }
  if (f.unidentified) {
    chips.push(
      <Chip key="unid" on={!f.unidentified.disabled} onClick={toggle(f.unidentified)}>
        Unidentified
      </Chip>
    )
  }
  if (f.mirrored && !f.mirrored.hidden) {
    chips.push(
      <Chip key="mirror" on={!f.mirrored.disabled} onClick={toggle(f.mirrored)}>
        Mirrored
      </Chip>
    )
  }
  if (f.foulborn?.value) chips.push(<Chip key="foulborn" on>Foulborn</Chip>)
  void item
  return <div className="chips">{chips}</div>
}

/* ---------- resultados ---------- */

function Listings({ s, onMore }: { s: Extract<SearchState, { status: 'trade' }>; onMore: () => void }) {
  const { data } = s
  if (!data.total) return <div className="empty">No listings found. Try turning off some filters.</div>
  return (
    <>
      <table className="listings">
        <tbody>
          {data.listings.map((l) => (
            <tr key={l.id}>
              <td className="lp">
                {num(l.priceAmount, 2)} <span className="cur">{currency(l.priceCurrency)}</span>
              </td>
              <td className="li">
                {l.level ? `lvl ${l.level}` : l.itemLevel && l.itemLevel !== 'undefined' ? `ilvl ${l.itemLevel}` : ''}
                {l.quality ? ` · ${l.quality}` : ''}
                {l.corrupted ? ' · corr.' : ''}
              </td>
              <td className="la">{l.relativeDate}</td>
              <td className="ls">
                <span className={`dot ${l.accountStatus}`} title={l.accountStatus} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="res-foot">
        <span>
          {num(data.listings.length)} of {num(data.total)}
          {data.inexact ? '+' : ''}
        </span>
        {data.listings.length < Math.min(data.ids.length, 100) && (
          <button type="button" className="link" onClick={onMore} disabled={s.loadingMore}>
            {s.loadingMore ? 'Loading…' : 'Show more'}
          </button>
        )}
      </div>
    </>
  )
}

function BulkListings({ data }: { data: BulkResult }) {
  if (!data.results.some((r) => r.listed.length)) return <div className="empty">No offers found.</div>
  return (
    <>
      {data.results.map((r) => (
        <div key={r.haveTag} className="bulk">
          <div className="bulk-head">
            Paying with {currency(r.haveTag)} · {num(r.total)} offers
          </div>
          <table className="listings">
            <tbody>
              {r.listed.slice(0, 8).map((l) => (
                <tr key={l.id}>
                  <td className="lp">
                    {num(l.exchangeAmount / l.itemAmount, 3)} <span className="cur">{currency(r.haveTag)}</span>
                  </td>
                  <td className="li">
                    {num(l.exchangeAmount)} : {num(l.itemAmount)} · stock {num(l.stock)}
                  </td>
                  <td className="la">{l.relativeDate}</td>
                  <td className="ls">
                    <span className={`dot ${l.accountStatus}`} title={l.accountStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  )
}

/* ---------- janela ---------- */

export function PriceCheck(props: { dataReady: Promise<void>; register: (fn: (p: PriceCheckPayload) => void) => void }) {
  const [check, setCheck] = useState<Check | null>(null)
  const [search, setSearch] = useState<SearchState>({ status: 'idle' })
  const [dataLoaded, setDataLoaded] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [, bump] = useReducer((x: number) => x + 1, 0)
  const rootRef = useRef<HTMLDivElement>(null)
  const seq = useRef(0)
  const pendingVisible = useRef(false)

  const league = check?.payload.league ?? ''

  const runSearch = useCallback(async (c: Check) => {
    if (!c.prepared || !c.filters || !c.stats || !c.payload.league) return
    const my = ++seq.current
    setSearch({ status: 'loading' })
    try {
      const kind = searchKind(c.prepared.item, { filters: c.filters, stats: c.stats })
      if (kind === 'bulk') {
        const data = await searchBulk(c.prepared.item, c.filters)
        if (my === seq.current) setSearch({ status: 'bulk', data })
      } else {
        const data = await searchTrade(c.filters, c.stats)
        if (my === seq.current) setSearch({ status: 'trade', data })
      }
    } catch (e) {
      if (my === seq.current) setSearch({ status: 'error', message: (e as Error)?.message ?? String(e) })
    }
  }, [])

  const apply = useCallback(
    (payload: PriceCheckPayload, prepared: PreparedCheck | undefined, error?: string, presetId?: string) => {
      const id = presetId ?? prepared?.active ?? ''
      const preset = prepared?.presets.find((p) => p.id === id) ?? prepared?.presets[0]
      const c: Check = {
        payload,
        prepared,
        error,
        presetId: preset?.id ?? '',
        filters: preset ? clone(preset.filters) : undefined,
        stats: preset ? clone(preset.stats) : undefined
      }
      setCheck(c)
      setShowHidden(false)
      seq.current++
      setSearch({ status: 'idle' })
      // Como o Awakened: pesquisa assim que abre (exceto único não identificado com várias opções).
      if (prepared && !(prepared.item.isUnidentified && uniqueCandidates(prepared.item).length > 1)) void runSearch(c)
    },
    [runSearch]
  )

  // Novo item vindo do jogo.
  useEffect(() => {
    props.register((payload) => {
      pendingVisible.current = true
      void props.dataReady
        .then(() => {
          setDataLoaded(true)
          const r = payload.league ? prepareCheck(payload.text, { league: payload.league }) : { error: 'Pick your league in Stash Ledger first.' }
          if ('error' in r) apply(payload, undefined, r.error)
          else apply(payload, r)
        })
        .catch((e: Error) => apply(payload, undefined, `Could not load mod data: ${e.message}`))
      // Mostra já o preço do poe.ninja enquanto os dados de mods carregam (primeiro uso).
      setCheck((cur) => (cur && cur.payload === payload ? cur : { payload, presetId: '' }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tamanho da janela acompanha o conteúdo; mostra a janela depois do primeiro desenho.
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const send = () => void invoke('pricecheck_resize', { width: el.offsetWidth, height: el.scrollHeight })
    send()
    if (pendingVisible.current && check) {
      pendingVisible.current = false
      void invoke('pricecheck_visible')
    }
    const ro = new ResizeObserver(send)
    ro.observe(el)
    return () => ro.disconnect()
  })

  // Esc fecha (com a janela em foco; no jogo, o próprio app trata o Esc).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void invoke('pricecheck_hide')
      if (e.key === 'Enter' && check) void runSearch(check)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [check, runSearch])

  if (!check) return <div ref={rootRef} className="pc" />

  const { payload, prepared } = check
  const ninja = payload.ninja
  const item = prepared?.item
  const frame = frameOf(item, ninja.frameType)
  // Único escolhido na lista de não identificado: o nome dele; senão o nome lido do item.
  const resolved = item?.info.unique && ninja.frameType === 3 && !ninja.base
  const name = resolved ? item!.info.name : ninja.name
  const base = resolved ? item!.info.unique!.base : ninja.base
  const div = ninja.divineChaos
  const candidates = item && item.rarity === ItemRarity.Unique && item.isUnidentified ? uniqueCandidates(item) : []
  const stats = check.stats ?? []
  const visibleStats = stats.filter((s) => showHidden || !(isStatFilter(s) ? s.hidden : s.meta.hidden))
  const hiddenCount = stats.length - visibleStats.length
  const changed = () => bump()

  const identify = (u: BaseType) => {
    if (!item) return
    const identified = identifyAs(u, item)
    apply(payload, prepareItem(identified, { league }))
  }

  const pickPreset = (id: string) => apply(payload, prepared, undefined, id)

  return (
    <div ref={rootRef} className="pc">
      <div className="pc-head">
        <div className="pc-title">
          <div className={`pc-name ${rarityClass(frame)}`}>
            {ninja.quantity > 1 ? `${num(ninja.quantity)} × ` : ''}
            {name}
          </div>
          {base && <div className="pc-base">{base}</div>}
        </div>
        <button type="button" className="close" onClick={() => void invoke('pricecheck_hide')} aria-label="Close" title="Close (Esc)">
          ✕
        </button>
      </div>

      {resolved && ninja.candidates?.some((c) => c.name === name) && (
        <div className="ninja">
          <span className="ninja-label">poe.ninja</span>
          <span className="ninja-price">{price(ninja.candidates.find((c) => c.name === name)!.chaos, div)}</span>
        </div>
      )}

      {!resolved && ninja.ok && ninja.unitChaos !== undefined && (
        <div className="ninja">
          <span className="ninja-label">poe.ninja</span>
          <span className="ninja-price">
            {(ninja.candidates?.length ?? 0) > 1 ? 'from ' : ninja.approximate ? '≈ ' : ''}
            {price(ninja.totalChaos ?? ninja.unitChaos, div)}
          </span>
          {ninja.quantity > 1 && <span className="ninja-sub">{price(ninja.unitChaos, div)} each</span>}
          {ninja.detail && !(ninja.candidates?.length ?? 0) && <span className="ninja-sub">{ninja.detail}</span>}
          {ninja.confidence === 'low' && <span className="tag warn">low confidence</span>}
        </div>
      )}

      {candidates.length > 0 && (
        <div className="section">
          <div className="section-title">Unidentified: pick the unique to search</div>
          <div className="cands">
            {candidates.map((u) => {
              const n = ninja.candidates?.find((c) => c.name === u.name)
              return (
                <button type="button" key={u.refName} className="cand" onClick={() => identify(u)}>
                  <span className="r-unique">{u.name}</span>
                  <span className="cand-price">{n ? price(n.chaos, div) : ''}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {!dataLoaded && <div className="muted pad">Loading mod data…</div>}
      {check.error && <div className="muted pad">{check.error}</div>}

      {prepared && check.filters && (
        <>
          {prepared.presets.length > 1 && (
            <div className="presets">
              {prepared.presets.map((p) => (
                <button type="button" key={p.id} className={`preset${p.id === check.presetId ? ' on' : ''}`} onClick={() => pickPreset(p.id)}>
                  {p.id.replace(/^filters\.preset_/, '').replace('_', ' ')}
                </button>
              ))}
            </div>
          )}

          <ItemChips f={check.filters} item={prepared.item} onChange={changed} />

          {visibleStats.length > 0 && (
            <div className="stats">
              {visibleStats.map((s, i) =>
                isStatFilter(s) ? (
                  <StatRow key={`${s.statRef}-${i}`} s={s} onChange={changed} />
                ) : (
                  <div key={`g-${i}`} className="group">
                    <StatRow s={s.meta} onChange={changed} />
                    {s.stats.map((st, j) => (
                      <StatRow key={`${st.statRef}-${j}`} s={st} onChange={changed} nested />
                    ))}
                  </div>
                )
              )}
            </div>
          )}
          {hiddenCount > 0 && (
            <button type="button" className="link pad" onClick={() => setShowHidden((v) => !v)}>
              {showHidden ? 'Hide extra filters' : `Show ${hiddenCount} more filter${hiddenCount > 1 ? 's' : ''}`}
            </button>
          )}

          <div className="actions">
            <Chip
              on={check.filters.trade.merchantOnly}
              onClick={() => {
                check.filters!.trade.merchantOnly = !check.filters!.trade.merchantOnly
                changed()
              }}
              title="Only listings you can buy instantly (merchant tabs)"
            >
              Instant buyout
            </Chip>
            <Chip
              on={check.filters.trade.offline}
              onClick={() => {
                check.filters!.trade.offline = !check.filters!.trade.offline
                changed()
              }}
              title="Include offline sellers"
            >
              Offline too
            </Chip>
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => void runSearch(check)} disabled={search.status === 'loading'}>
              {search.status === 'loading' ? 'Searching…' : 'Search'}
            </button>
          </div>

          <div className="results">
            {search.status === 'error' && <div className="error">{search.message}</div>}
            {search.status === 'trade' && (
              <Listings
                s={search}
                onMore={() => {
                  const cur = search
                  setSearch({ ...cur, loadingMore: true })
                  void moreListings(cur.data)
                    .then((more) => setSearch({ status: 'trade', data: { ...cur.data, listings: [...cur.data.listings, ...more] } }))
                    .catch((e: Error) => setSearch({ status: 'error', message: e.message }))
                }}
              />
            )}
            {search.status === 'bulk' && <BulkListings data={search.data} />}
          </div>

          {(search.status === 'trade' || search.status === 'bulk') && search.data.url && (
            <div className="pc-foot">
              <button type="button" className="link" onClick={() => void invoke('open_external', { url: search.data.url })}>
                Open on the trade site ↗
              </button>
              <span>{league}</span>
            </div>
          )}
        </>
      )}

      {!prepared && ninja.message && <div className="muted pad">{ninja.message}</div>}
      {ninja.pricesUpdatedAt && !prepared && <div className="pc-foot">poe.ninja · updated {ago(ninja.pricesUpdatedAt)}</div>}
    </div>
  )
}
