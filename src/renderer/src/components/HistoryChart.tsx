import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { fmtDateTime, fmtDay, fmtTime, num } from '../lib/format'

export interface Point {
  t: number
  v: number
}

interface Props {
  points: Point[]
  unit: string
  digits: number
}

const HEIGHT = 230
const PAD = { top: 16, right: 64, bottom: 26, left: 52 }

/** Escala "bonita" para o eixo Y (1, 2, 2.5, 5 × 10^n). */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const d = Math.abs(min) * 0.05 || 1
    min -= d
    max += d
  }
  const raw = (max - min) / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const start = Math.floor(min / step) * step
  const ticks: number[] = []
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Number(v.toFixed(10)))
  return ticks
}

/** Marcas do eixo X sem rótulos repetidos (snapshots próximos caem no mesmo minuto). */
function timeTicks(t0: number, t1: number, width: number, multiDay: boolean): { t: number; label: string }[] {
  const n = Math.max(2, Math.min(6, Math.floor(width / 120)))
  const fmt = multiDay ? fmtDay : fmtTime
  if (t1 === t0) return [{ t: t0, label: fmt(t0) }]
  const out: { t: number; label: string }[] = []
  for (let i = 0; i < n; i++) {
    const t = t0 + ((t1 - t0) * i) / (n - 1)
    const label = fmt(t)
    if (!out.some((o) => o.label === label)) out.push({ t, label })
  }
  return out
}

/** Patrimônio ao longo do tempo: linha única, crosshair com tooltip e rótulo no último ponto. */
export function HistoryChart({ points, unit, digits }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(700)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(320, entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const geo = useMemo(() => {
    if (points.length < 2) return null
    const t0 = points[0].t
    const t1 = points[points.length - 1].t
    const vs = points.map((p) => p.v)
    const ticks = niceTicks(Math.min(...vs), Math.max(...vs))
    const y0 = ticks[0]
    const y1 = ticks[ticks.length - 1]
    const iw = width - PAD.left - PAD.right
    const ih = HEIGHT - PAD.top - PAD.bottom
    const x = (t: number): number => PAD.left + (t1 === t0 ? iw / 2 : ((t - t0) / (t1 - t0)) * iw)
    const y = (v: number): number => PAD.top + ih - ((v - y0) / (y1 - y0 || 1)) * ih
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('')
    const multiDay = t1 - t0 > 36 * 3600 * 1000
    return { t0, t1, ticks, x, y, path, multiDay, iw, ih }
  }, [points, width])

  if (!geo) {
    return (
      <div ref={wrapRef} className="chart-wrap">
        <div className="empty">Tire pelo menos dois snapshots para ver o histórico.</div>
      </div>
    )
  }

  const { ticks, x, y, path, multiDay } = geo
  const last = points[points.length - 1]
  const hp = hover !== null ? points[hover] : null

  const onMove = (e: PointerEvent<SVGSVGElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    let best = 0
    let bestD = Infinity
    points.forEach((p, i) => {
      const d = Math.abs(x(p.t) - px)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    setHover(best)
  }

  const onKey = (e: KeyboardEvent<SVGSVGElement>): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const cur = hover ?? points.length - 1
    setHover(Math.min(points.length - 1, Math.max(0, cur + (e.key === 'ArrowRight' ? 1 : -1))))
  }

  return (
    <div ref={wrapRef} className="chart-wrap">
      <svg
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={`Patrimônio em ${unit}: ${num(last.v, digits)} no último snapshot`}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onFocus={() => setHover(points.length - 1)}
        onBlur={() => setHover(null)}
        onKeyDown={onKey}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text className="axis-text" x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
              {num(t, digits)}
            </text>
          </g>
        ))}
        {timeTicks(geo.t0, geo.t1, width, multiDay).map((t, i, arr) => (
          <text
            key={t.t}
            className="axis-text"
            x={x(t.t)}
            y={HEIGHT - 6}
            textAnchor={i === 0 ? 'start' : i === arr.length - 1 ? 'end' : 'middle'}
          >
            {t.label}
          </text>
        ))}
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(last.t)} cy={y(last.v)} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
        <text className="end-label" x={x(last.t) + 10} y={y(last.v) + 4}>
          {num(last.v, digits)}
        </text>
        {hp && (
          <g pointerEvents="none">
            <line x1={x(hp.t)} x2={x(hp.t)} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="var(--muted)" strokeWidth={1} />
            <circle cx={x(hp.t)} cy={y(hp.v)} r={5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hp && (
        <div className="tooltip" style={{ left: x(hp.t), top: y(hp.v) - 12 }}>
          <div className="tv">
            <span className="key" />
            {num(hp.v, digits)} {unit}
          </div>
          <div className="tl">{fmtDateTime(hp.t)}</div>
        </div>
      )}
    </div>
  )
}
