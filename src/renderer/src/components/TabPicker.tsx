import { useEffect, useMemo, useState } from 'react'
import type { StashTabInfo } from '../../../shared/types'

interface Props {
  league: string
  selected: string[]
  sessionMode?: boolean
  onClose: () => void
  onSave: (ids: string[]) => void
}

const TYPE_LABEL: Record<string, string> = {
  NormalStash: 'Normal',
  PremiumStash: 'Premium',
  QuadStash: 'Quad',
  CurrencyStash: 'Moedas',
  FragmentStash: 'Fragmentos',
  MapStash: 'Mapas',
  UniqueStash: 'Únicos',
  DivinationCardStash: 'Cartas',
  EssenceStash: 'Essências',
  GemStash: 'Gemas',
  FlaskStash: 'Frascos',
  DelveStash: 'Delve',
  BlightStash: 'Blight',
  DeliriumStash: 'Delírio',
  MetamorphStash: 'Metamorph'
}

/** Abas especiais que o endpoint antigo do site historicamente não devolve com itens. */
const LEGACY_LIMITED = new Set(['MapStash', 'UniqueStash'])

export function TabPicker({ league, selected, sessionMode, onClose, onSave }: Props) {
  const [tabs, setTabs] = useState<StashTabInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState(() => new Set(selected))
  const [query, setQuery] = useState('')

  useEffect(() => {
    let alive = true
    window.api
      .listTabs(league)
      .then((t) => alive && setTabs(t))
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [league])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (tabs ?? []).filter((t) => !q || `${t.name} ${t.parentName ?? ''}`.toLowerCase().includes(q))
  }, [tabs, query])

  const toggle = (id: string): void =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  let lastGroup: string | undefined
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="frame modal" role="dialog" aria-modal="true" aria-labelledby="tabs-title">
        <header>
          <h2 id="tabs-title">Abas acompanhadas · {league}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>
        <div className="body">
          <div className="toolbar">
            <input className="input" placeholder="Filtrar abas…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button className="btn" onClick={() => setPicked(new Set((tabs ?? []).map((t) => t.id)))}>
              Todas
            </button>
            <button className="btn" onClick={() => setPicked(new Set())}>
              Nenhuma
            </button>
          </div>
          {error && <div className="banner">{error}</div>}
          {!tabs && !error && <div className="empty">Carregando abas da stash…</div>}
          {tabs && !tabs.length && <div className="empty">Nenhuma aba encontrada nesta liga.</div>}
          <div className="tab-list">
            {visible.map((t) => {
              const header = t.parentName !== lastGroup && t.parentName ? <div className="group-label">Pasta · {t.parentName}</div> : null
              lastGroup = t.parentName
              return (
                <div key={t.id}>
                  {header}
                  <label className="tab-item">
                    <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} />
                    <span className="dot" style={t.colour ? { background: `#${t.colour}` } : undefined} />
                    <span>{t.name}</span>
                    {sessionMode && LEGACY_LIMITED.has(t.type) && (
                      <span className="warn" title="O endpoint antigo do site pode não devolver itens deste tipo de aba">
                        pode vir vazia
                      </span>
                    )}
                    <span className="type">{TYPE_LABEL[t.type] ?? t.type.replace(/Stash$/, '')}</span>
                  </label>
                </div>
              )
            })}
          </div>
        </div>
        <footer>
          <span className="sub">{picked.size} selecionada(s)</span>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" onClick={() => onSave([...picked])} disabled={!tabs}>
            Salvar seleção
          </button>
        </footer>
      </div>
    </div>
  )
}
