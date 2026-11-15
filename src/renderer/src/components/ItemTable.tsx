import { useMemo, useState } from 'react'
import type { PricedItem } from '../../../shared/types'
import { categoryLabel, num, price, rarityClass } from '../lib/format'

type SortKey = 'name' | 'category' | 'quantity' | 'unitChaos' | 'totalChaos'

interface Props {
  items: PricedItem[]
  divine: number | null
  hideBelow: number
  onHideBelowChange: (v: number) => void
}

const PAGE = 300

export function ItemTable({ items, divine, hideBelow, onHideBelowChange }: Props) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'totalChaos', dir: -1 })
  const [limit, setLimit] = useState(PAGE)

  const categories = useMemo(() => {
    const set = new Map<string, number>()
    for (const i of items) set.set(i.category ?? '', (set.get(i.category ?? '') ?? 0) + i.totalChaos)
    return [...set.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
  }, [items])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = items.filter((i) => {
      if (category !== '__none' && category && i.category !== category) return false
      if (category === '__none' && i.category) return false
      if (q && !`${i.name} ${i.detail ?? ''} ${i.tabs.join(' ')}`.toLowerCase().includes(q)) return false
      if (!q && category !== '__none' && i.totalChaos < hideBelow) return false
      return true
    })
    const { key, dir } = sort
    return filtered.sort((a, b) => {
      const va = key === 'category' ? categoryLabel(a.category) : a[key]
      const vb = key === 'category' ? categoryLabel(b.category) : b[key]
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb, 'pt-BR') * dir
      return ((va as number) - (vb as number)) * dir
    })
  }, [items, query, category, sort, hideBelow])

  const hidden = items.length - rows.length
  const unpriced = items.filter((i) => !i.category).length

  const th = (key: SortKey, label: string, cls = '') => (
    <th
      className={`sortable ${cls}`}
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : key === 'name' || key === 'category' ? 1 : -1 }))}
    >
      {label}
      {sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </th>
  )

  return (
    <div className="frame card">
      <div className="card-head">
        <h2>Itens</h2>
        <span className="sub">
          {num(rows.length)} de {num(items.length)} grupos
          {hidden > 0 && !query ? ` · ${num(hidden)} ocultos pelo filtro` : ''}
          {unpriced > 0 ? ` · ${num(unpriced)} sem preço` : ''}
        </span>
      </div>
      <div className="toolbar">
        <input
          className="input"
          type="search"
          placeholder="Buscar item, detalhe ou aba…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setLimit(PAGE)
          }}
        />
        <select className="select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {categories.filter(Boolean).map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
          {unpriced > 0 && <option value="__none">Sem preço</option>}
        </select>
        <label className="sub" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Esconder abaixo de
          <input
            className="input"
            style={{ width: 80 }}
            type="number"
            min={0}
            step={1}
            value={hideBelow}
            onChange={(e) => onHideBelowChange(Math.max(0, Number(e.target.value) || 0))}
          />
          chaos
        </label>
      </div>
      <table className="table">
        <thead>
          <tr>
            {th('name', 'Item')}
            {th('category', 'Categoria')}
            <th>Abas</th>
            {th('quantity', 'Qtd', 'num')}
            {th('unitChaos', 'Preço un.', 'num')}
            {th('totalChaos', 'Total', 'num')}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((i) => (
            <tr key={i.key}>
              <td>
                <div className="item-cell">
                  {i.icon ? (
                    <img className="item-icon" src={i.icon} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="item-icon placeholder" aria-hidden="true" />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div className={`item-name ${rarityClass(i.frameType)}`}>
                      {i.name}
                      {i.approximate && (
                        <span className="badge" title="Preço aproximado: não havia variante exata no poe.ninja">
                          ≈
                        </span>
                      )}
                      {i.confidence === 'low' && (
                        <span className="badge low" title="Poucas amostras no poe.ninja">
                          baixa confiança
                        </span>
                      )}
                    </div>
                    {i.detail && <div className="item-detail">{i.detail}</div>}
                  </div>
                </div>
              </td>
              <td className="sub">{categoryLabel(i.category)}</td>
              <td className="tabs-cell" title={i.tabs.join(', ')}>
                {i.tabs.join(', ')}
              </td>
              <td className="num">{num(i.quantity)}</td>
              <td className="num">{i.category ? price(i.unitChaos, divine) : '—'}</td>
              <td className={`num ${i.counted ? '' : 'not-counted'}`} title={i.counted ? undefined : 'Fora do total (baixa confiança)'}>
                {i.category ? price(i.totalChaos, divine) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > limit && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button className="btn" onClick={() => setLimit((l) => l + PAGE)}>
            Mostrar mais ({num(rows.length - limit)} restantes)
          </button>
        </div>
      )}
      {!rows.length && <div className="empty">Nenhum item com esses filtros.</div>}
    </div>
  )
}
