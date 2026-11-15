import { useMemo, useState } from 'react'
import type { SnapshotDetail, SnapshotSummary } from '../../../shared/types'
import { ago, chaosText, fmtDateTime, num, price } from '../lib/format'
import { HistoryChart, type Point } from './HistoryChart'
import { ItemTable } from './ItemTable'

type Range = '6h' | '24h' | '7d' | 'all'
const RANGE_MS: Record<Range, number> = { '6h': 6 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 24 * 3600e3, all: Infinity }
const RANGE_LABEL: Record<Range, string> = { '6h': '6 h', '24h': '24 h', '7d': '7 dias', all: 'Tudo' }

interface Props {
  latest: SnapshotDetail | null
  history: SnapshotSummary[]
  hideBelow: number
  onHideBelowChange: (v: number) => void
}

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

export function Dashboard({ latest, history, hideBelow, onHideBelowChange }: Props) {
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
      <div className="frame card">
        <div className="empty">
          Nenhum snapshot ainda. Escolha as abas e clique em <strong>Atualizar agora</strong>.
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
    <>
      <div className="tiles">
        <div className="frame card tile">
          <div className="label">Patrimônio nas abas acompanhadas</div>
          <div className="hero">{divine ? `${num(latest.totalChaos / divine, 1)} div` : chaosText(latest.totalChaos)}</div>
          <div className="meta">
            {chaosText(latest.totalChaos)} · 1 div = {num(divine, 1)} c · {fmtDateTime(latest.takenAt)}
          </div>
        </div>
        <div className="frame card tile">
          <div className="label">Desde o snapshot anterior</div>
          {prev ? <Delta value={delta} unit={unit} /> : <div className="value">—</div>}
          <div className="meta">{prev ? fmtDateTime(prev.takenAt) : 'Tire outro snapshot para comparar'}</div>
        </div>
        <div className="frame card tile">
          <div className="label">Por hora ({RANGE_LABEL[range]})</div>
          {perHour !== null ? <Delta value={perHour} unit={unit} /> : <div className="value">—</div>}
          <div className="meta">{perHour !== null ? `em ${num(spanH, 1)} h de histórico` : 'Precisa de 10 min de histórico'}</div>
        </div>
        <div className="frame card tile">
          <div className="label">Itens com preço</div>
          <div className="value">
            {num(latest.pricedCount)} <span className="sub">/ {num(latest.itemCount)}</span>
          </div>
          <div className="meta">
            Preços do poe.ninja {ago(latest.pricesUpdatedAt)}
            {latest.errorCount ? (
              <>
                {' · '}
                <button className="link" onClick={() => void window.api.openLog()} title="Abrir o log de erros">
                  {num(latest.errorCount)} com erro
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="frame card">
          <div className="card-head">
            <h2>Histórico</h2>
            <span className="sub">patrimônio em {unit === 'div' ? 'divines' : 'chaos'}</span>
            <span className="spacer" />
            <div className="seg" role="group" aria-label="Período">
              {(Object.keys(RANGE_MS) as Range[]).map((r) => (
                <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>
                  {RANGE_LABEL[r]}
                </button>
              ))}
            </div>
            <div className="seg" role="group" aria-label="Unidade">
              <button aria-pressed={unit === 'div'} onClick={() => setUnit('div')}>
                div
              </button>
              <button aria-pressed={unit === 'chaos'} onClick={() => setUnit('chaos')}>
                chaos
              </button>
            </div>
            <button className="btn ghost" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
              {showTable ? 'Gráfico' : 'Tabela'}
            </button>
          </div>
          {showTable ? (
            <div style={{ maxHeight: 230, overflow: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th className="num">Patrimônio</th>
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
            <HistoryChart points={points} unit={unit} digits={unit === 'div' ? 1 : 0} />
          )}
        </div>

        <div className="frame card">
          <div className="card-head">
            <h2>Por aba</h2>
            <span className="sub">{latest.tabs.length} abas</span>
          </div>
          <div className="tab-rows">
            {sortedTabs.map((t) => (
              <div className="tab-row" key={t.id} title={`${t.name}: ${chaosText(t.chaos)} · ${t.itemCount} itens`}>
                <span className="tab-name">
                  <span className="dot" style={t.colour ? { background: `#${t.colour}` } : undefined} />
                  <span className="label-text">{t.name}</span>
                </span>
                <div className="bar-track">
                  <div className="bar" style={{ width: `${Math.max(0.5, (t.chaos / maxTab) * 100)}%` }} />
                </div>
                <span className="tab-val">{price(t.chaos, divine)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <ItemTable items={latest.items} divine={divine} hideBelow={hideBelow} onHideBelowChange={onHideBelowChange} />
    </>
  )
}
