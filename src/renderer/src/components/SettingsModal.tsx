import { useState } from 'react'
import type { AppState, Settings, UpdateState } from '../../../shared/types'

function updateText(u: UpdateState): string {
  switch (u.status) {
    case 'disabled':
      return 'atualização automática só no app instalado'
    case 'checking':
      return 'procurando atualização…'
    case 'latest':
      return 'versão mais recente'
    case 'downloading':
      return `baixando ${u.version} (${u.percent}%)`
    case 'ready':
      return `${u.version} pronta para instalar`
    case 'error':
      return 'não foi possível verificar atualizações'
    default:
      return ''
  }
}

interface Props {
  state: AppState
  update: UpdateState
  onClose: () => void
  onSave: (patch: Partial<Settings>) => Promise<void>
  onClearHistory: (() => Promise<void>) | null
}

export function SettingsModal({ state, update, onClose, onSave, onClearHistory }: Props) {
  const [s, setS] = useState<Settings>(state.settings)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof Settings>(k: K, v: Settings[K]): void => setS((prev) => ({ ...prev, [k]: v }))

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await onSave({
        clientId: s.clientId,
        redirectUri: s.redirectUri,
        contact: s.contact,
        ninjaBaseUrl: s.ninjaBaseUrl,
        autoSnapshotMinutes: s.autoSnapshotMinutes,
        includeLowConfidence: s.includeLowConfidence,
        priceBaseTypes: s.priceBaseTypes,
        hideBelowChaos: s.hideBelowChaos
      })
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="frame modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header>
          <h2 id="settings-title">Configurações</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>
        <div className="body">
          <div className="section-title">Login GGG (OAuth)</div>
          <div className="field">
            <label htmlFor="cid">Client ID</label>
            <input id="cid" className="input" value={s.clientId} onChange={(e) => set('clientId', e.target.value)} />
            <span className="hint">
              ID do seu app registrado na GGG como cliente público. Não existe segredo: o login usa PKCE.{' '}
              <a href="https://www.pathofexile.com/developer/docs" target="_blank" rel="noreferrer">
                Documentação da GGG
              </a>
            </span>
          </div>
          <div className="field">
            <label htmlFor="ruri">Redirect URI</label>
            <input id="ruri" className="input" value={s.redirectUri} onChange={(e) => set('redirectUri', e.target.value)} />
            <span className="hint">Precisa ser idêntica à registrada e local, por exemplo http://127.0.0.1:8080/callback</span>
          </div>
          <div className="field">
            <label htmlFor="contact">Contato do User-Agent</label>
            <input id="contact" className="input" value={s.contact} onChange={(e) => set('contact', e.target.value)} />
            <span className="hint">A GGG exige um contato (e-mail ou URL) no User-Agent das requisições.</span>
          </div>

          <div className="section-title">Preços</div>
          <label className="check">
            <input type="checkbox" checked={s.priceBaseTypes} onChange={(e) => set('priceBaseTypes', e.target.checked)} />
            <span>
              Precificar bases ilvl 82+
              <div className="sub">Itens normais/mágicos/raros recebem o preço da base (com influência) do poe.ninja.</div>
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={s.includeLowConfidence}
              onChange={(e) => set('includeLowConfidence', e.target.checked)}
            />
            <span>
              Somar preços de baixa confiança
              <div className="sub">Itens com menos de 5 amostras no poe.ninja aparecem na tabela, mas ficam fora do total.</div>
            </span>
          </label>
          <div className="field">
            <label htmlFor="ninja">Servidor de preços</label>
            <input id="ninja" className="input" value={s.ninjaBaseUrl} onChange={(e) => set('ninjaBaseUrl', e.target.value)} />
            <span className="hint">
              Padrão: https://poe.ninja. O poe.ninja recomenda que apps desktop usem um proxy com cache; se você tiver um,
              coloque o endereço aqui.
            </span>
          </div>

          <div className="section-title">Snapshots</div>
          <div className="field">
            <label htmlFor="auto">Snapshot automático</label>
            <select
              id="auto"
              className="select"
              value={s.autoSnapshotMinutes}
              onChange={(e) => set('autoSnapshotMinutes', Number(e.target.value))}
            >
              <option value={0}>Desligado</option>
              <option value={5}>A cada 5 minutos</option>
              <option value={10}>A cada 10 minutos</option>
              <option value={15}>A cada 15 minutos</option>
              <option value={30}>A cada 30 minutos</option>
              <option value={60}>A cada hora</option>
            </select>
            <span className="hint">Respeita os limites de requisição da GGG: se precisar, espera antes de buscar as abas.</span>
          </div>
          {onClearHistory && (
            <button
              className="btn"
              onClick={async () => {
                if (window.confirm('Apagar todo o histórico de snapshots desta liga? Não dá para desfazer.')) {
                  await onClearHistory()
                }
              }}
            >
              Apagar histórico desta liga
            </button>
          )}
          <button className="btn" style={{ marginLeft: onClearHistory ? 10 : 0 }} onClick={() => void window.api.openLog()}>
            Abrir log de erros
          </button>
          {!state.secureStorage && (
            <div className="banner" style={{ marginTop: 16 }}>
              O sistema não oferece armazenamento criptografado: o login não será lembrado entre sessões.
            </div>
          )}
          {error && (
            <div className="banner" style={{ marginTop: 16 }}>
              {error}
            </div>
          )}
        </div>
        <footer>
          <span className="sub" title={update.status === 'error' ? update.message : undefined}>
            v{state.version}
            {updateText(update) ? ` · ${updateText(update)}` : ''}
          </span>
          {(update.status === 'latest' || update.status === 'error') && (
            <button className="btn ghost" onClick={() => void window.api.checkUpdate()}>
              Procurar atualização
            </button>
          )}
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" onClick={save} disabled={saving}>
            Salvar
          </button>
        </footer>
      </div>
    </div>
  )
}
