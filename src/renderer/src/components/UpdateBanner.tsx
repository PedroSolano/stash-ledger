import { useEffect, useState } from 'react'
import type { UpdateState } from '../../../shared/types'

const COUNTDOWN_S = 15

interface Props {
  update: UpdateState
  /** Enquanto um snapshot estiver rodando, a contagem fica pausada. */
  busy: boolean
  /** Janela escondida (bandeja / jogando): não reinicia por conta própria no meio do jogo. */
  hidden?: boolean
}

/**
 * Faixa de atualização: mostra o download e, quando a versão nova está pronta, reinicia sozinho
 * depois de uma contagem curta. "Later" adia; aí a versão nova entra quando o app for fechado.
 */
export function UpdateBanner({ update, busy, hidden = false }: Props) {
  const [seconds, setSeconds] = useState(COUNTDOWN_S)
  const [postponed, setPostponed] = useState(false)
  const ready = update.status === 'ready'

  // Ao reaparecer, a contagem recomeça do início (o usuário precisa ver o aviso).
  useEffect(() => {
    if (hidden) setSeconds(COUNTDOWN_S)
  }, [hidden])

  useEffect(() => {
    if (!ready || postponed || busy || hidden) return
    if (seconds <= 0) {
      void window.api.installUpdate()
      return
    }
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [ready, postponed, busy, seconds])

  if (update.status === 'downloading') {
    return (
      <div className="update-banner" role="status">
        <span className="update-dot" />
        Downloading version {update.version}… {update.percent}%
        <div className="update-track">
          <div className="update-fill" style={{ width: `${update.percent}%` }} />
        </div>
      </div>
    )
  }

  if (update.status !== 'ready') return null

  return (
    <div className="update-banner ready" role="alert">
      <span className="update-dot" />
      <span>
        <strong>Version {update.version} is ready.</strong>{' '}
        {postponed
          ? 'It will be installed when you quit the app (tray icon → Quit).'
          : busy
            ? 'Restarting as soon as the snapshot finishes.'
            : `Restarting to update in ${seconds}s…`}
      </span>
      <span className="spacer" />
      <button className="btn primary" onClick={() => void window.api.installUpdate()}>
        Update now
      </button>
      {!postponed && (
        <button className="btn ghost" onClick={() => setPostponed(true)}>
          Later
        </button>
      )}
    </div>
  )
}
