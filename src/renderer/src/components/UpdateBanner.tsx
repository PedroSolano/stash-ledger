import { useEffect, useState } from 'react'
import type { UpdateState } from '../../../shared/types'

const COUNTDOWN_S = 15

interface Props {
  update: UpdateState
  /** Enquanto um snapshot estiver rodando, a contagem fica pausada. */
  busy: boolean
}

/**
 * Faixa de atualização: mostra o download e, quando a versão nova está pronta, reinicia sozinho
 * depois de uma contagem curta. "Depois" adia; aí a versão nova entra quando o app for fechado.
 */
export function UpdateBanner({ update, busy }: Props) {
  const [seconds, setSeconds] = useState(COUNTDOWN_S)
  const [postponed, setPostponed] = useState(false)
  const ready = update.status === 'ready'

  useEffect(() => {
    if (!ready || postponed || busy) return
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
        Baixando a versão {update.version}… {update.percent}%
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
        <strong>Versão {update.version} pronta.</strong>{' '}
        {postponed
          ? 'Ela será instalada quando você fechar o app.'
          : busy
            ? 'Reinicio assim que o snapshot terminar.'
            : `Reiniciando para atualizar em ${seconds} s…`}
      </span>
      <span className="spacer" />
      <button className="btn primary" onClick={() => void window.api.installUpdate()}>
        Atualizar agora
      </button>
      {!postponed && (
        <button className="btn ghost" onClick={() => setPostponed(true)}>
          Depois
        </button>
      )}
    </div>
  )
}
