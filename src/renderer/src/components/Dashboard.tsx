import { useMemo, useState } from 'react'
import type { SnapshotDetail, SnapshotSummary } from '../../../shared/types'
import { ago, chaosText, fmtDateTime, num, price } from '../lib/format'
import type { Layout } from '../lib/useLayout'
import { HistoryChart, type Point } from './HistoryChart'
import { ItemTable } from './ItemTable'

type Range = '6h' | '24h' | '7d' | 'all'
const RANGE_MS: Record<Range, number> = { '6h': 6 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 24 * 3600e3, all: Infinity }
const RANGE_LABEL: Record<Range, string> = { '6h': '6h', '24h': '24h', '7d': '7d', all: 'All' }

interface Props {
  latest: SnapshotDetail | null
  history: SnapshotSummary[]
  hideBelow: number
  onHideBelowChange: (v: number) => void
  layout: Layout
  sessionMode?: boolean
}

const CHART_HEIGHT: Record<Layout, number> = { compact: 220, normal: 230, wide: 260, ultrawide: 300 }

type Unit = 'div' | 'chaos'

function fmtUnit(v: number, unit: Unit): string {
  const a = Math.abs(v)
  return unit === 'div' ? `${num(a, a >= 100 ? 0 : a >= 10 ? 1 : 2)} div` : chaosText(a)
}

/** Variação na mesma unidade do gráfico, para os cartões nunca contradizerem a linha. */
function Delta({ value, unit }: { value: number; unit: Unit }) {
  if (!value) return <span className="value">0 {unit === 'div' ? 'div' : 'c'}</span>
  const up = value > 0
  return (
    <span className={`value ${up ? 'delta-up' : 'delta-down'}`}>
      {up ? '▲ +' : '▼ −'}
      {fmtUnit(value, unit)}
    </span>
  )
}

export function Dashboard({ latest, history, hideBelow, onHideBelowChange, layout, sessionMode }: Props) {
  const spacious = layout === 'wide' || layout === 'ultrawide'
  // O endpoint do POESESSID devolve a Unique Collection sempre vazia (confirmado com uma stash real).
  const unreadable = (t: { type?: string; itemCount: number }): boolean => !!sessionMode && t.type === 'UniqueStash' && !t.itemCount
  const [range, setRange] = useState<Range>('24h')
  const [unit, setUnit] = useState<Unit>('div')
  const [showTable, setShowTable] = useState(false)

  const inRange = useMemo(() => {
    const cutoff = Date.now() - RANGE_MS[range]
    return history.filter((h) => h.takenAt >= cutoff)
  }, [history, range])

  const points: Point[] = useMemo(
    () =>
      inRange.map((h) => ({
        t: h.takenAt,
        v: unit === 'div' && h.divineChaos ? h.totalChaos / h.divineChaos : h.totalChaos
      })),
    [inRange, unit]
  )

  if (!latest) {
    return (
      <div className={`dashboard layout-${layout}`}>
        <div className="frame card area-full">
          <div className="empty">
            No snapshots yet. Pick your tabs and click <strong>Refresh now</strong>.
          </div>
        </div>
      </div>
    )
  }

  const divine = latest.divineChaos || 0
  // Em div, cada snapshot usa a cotação do divine da época (igual ao gráfico).
  const val = (s: SnapshotSummary): number => (unit === 'div' && s.divineChaos ? s.totalChaos / s.divineChaos : s.totalChaos)
  const prev = history.length >= 2 ? history[history.length - 2] : null
  const delta = prev ? val(latest) - val(prev) : 0
  const first = inRange[0]
  const spanH = first ? (latest.takenAt - first.takenAt) / 3600e3 : 0
  const perHour = first && spanH >= 1 / 6 ? (val(latest) - val(first)) / spanH : null
  const maxTab = Math.max(1, ...latest.tabs.map((t) => t.chaos))
  const sortedTabs = [...latest.tabs].sort((a, b) => b.chaos - a.chaos)

  return (
    <div className={`dashboard layout-${layout}`}>
      <div className="tiles area-tiles">
        <div className="frame card tile">
          <div className="label">Net worth of tracked tabs</div>
          <div className="hero">{divine ? `${num(latest.totalChaos / divine, 1)} div` : chaosText(latest.totalChaos)}</div>
          <div className="meta">
            {chaosText(latest.totalChaos)} · 1 div = {num(divine, 1)} c · {fmtDateTime(latest.takenAt)}
          </div>
        </div>
        <div className="frame card tile">
          <div className="label">Since last snapshot</div>
          {prev ? <Delta value={delta} unit={unit} /> : <div className="value">—</div>}
          <div className="meta">{prev ? fmtDateTime(prev.takenAt) : 'Take another snapshot to compare'}</div>
        </div>
        <div className="frame card tile">
          <div className="label">Per hour ({RANGE_LABEL[range]})</div>
          {perHour !== null ? <Delta value={perHour} unit={unit} /> : <div className="value">—</div>}
          <div className="meta">{perHour !== null ? `over ${num(spanH, 1)} h of history` : 'Needs 10 min of history'}</div>
        </div>
        <div className="frame card tile">
          <div className="label">Priced items</div>
          <div className="value">
            {num(latest.pricedCount)} <span className="sub">/ {num(latest.itemCount)}</span>
          </div>
          <div className="meta">
            poe.ninja prices from {ago(latest.pricesUpdatedAt)}
            {latest.errorCount ? (
              <>
                {' · '}
                <button className="link" onClick={() => void window.api.openLog()} title="Open the error log">
                  {num(latest.errorCount)} failed
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="frame card area-chart">
        <div className="card-head">
          <h2>History</h2>
          <span className="sub">net worth in {unit === 'div' ? 'divines' : 'chaos'}</span>
          <span className="spacer" />
          <div className="seg" role="group" aria-label="Time range">
            {(Object.keys(RANGE_MS) as Range[]).map((r) => (
              <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Unit">
            <button aria-pressed={unit === 'div'} onClick={() => setUnit('div')}>
              div
            </button>
            <button aria-pressed={unit === 'chaos'} onClick={() => setUnit('chaos')}>
              chaos
            </button>
          </div>
          <button className="btn ghost" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
            {showTable ? 'Chart' : 'Table'}
          </button>
        </div>
        {showTable ? (
          <div style={{ maxHeight: CHART_HEIGHT[layout], overflow: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th className="num">Net worth</th>
                </tr>
              </thead>
              <tbody>
                {[...points].reverse().map((p) => (
                  <tr key={p.t}>
                    <td>{fmtDateTime(p.t)}</td>
                    <td className="num">
                      {num(p.v, unit === 'div' ? 1 : 0)} {unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <HistoryChart
            points={points}
            unit={unit}
            digits={unit === 'div' ? 1 : 0}
            height={CHART_HEIGHT[layout]}
            fill={layout === 'ultrawide'}
          />
        )}
      </div>

      <div className="frame card area-tabs">
        <div className="card-head">
          <h2>By tab</h2>
          <span className="sub">{latest.tabs.length} tabs</span>
        </div>
        <div className={`tab-rows ${spacious ? 'with-count' : ''}`}>
          {sortedTabs.map((t) => (
            <div className="tab-row" key={t.id} title={`${t.name}: ${chaosText(t.chaos)} · ${t.itemCount} items`}>
              <span className="tab-name">
                <span className="dot" style={t.colour ? { background: `#${t.colour}` } : undefined} />
                <span className="label-text">{t.name}</span>
              </span>
              <div className="bar-track">
                <div className="bar" style={{ width: `${Math.max(0.5, (t.chaos / maxTab) * 100)}%` }} />
              </div>
              {spacious && (
                <span
                  className={`tab-count ${t.itemCount ? '' : 'empty-tab'}`}
                  title={unreadable(t) ? 'GGG does not return the Unique Collection tab to POESESSID sign-in. Keep valuable uniques in a regular tab.' : undefined}
                >
                  {t.itemCount ? `${num(t.itemCount)} items` : unreadable(t) ? 'not readable' : 'empty'}
                </span>
              )}
              <span className="tab-val">{price(t.chaos, divine)}</span>
            </div>
          ))}
        </div>
      </div>

      <ItemTable
        className="area-items"
        items={latest.items}
        divine={divine}
        hideBelow={hideBelow}
        onHideBelowChange={onHideBelowChange}
        scroll={spacious}
        totalChaos={spacious ? latest.totalChaos : undefined}
      />
    </div>
  )
}
