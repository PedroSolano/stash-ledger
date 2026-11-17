import { getCurrentWindow } from '@tauri-apps/api/window'
import { comboLabel } from '../../../shared/hotkeys'

interface Props {
  /** Atalho do overlay (vazio = desligado), mostrado como dica. */
  overlayKey: string
}

/**
 * Barra de título própria (a janela não tem a moldura do Windows, para parecer parte do jogo
 * quando abre por cima dele). Arrastar move a janela; duplo clique maximiza; ✕ esconde na bandeja.
 */
export function TitleBar({ overlayKey }: Props) {
  const win = getCurrentWindow()
  return (
    <div className="titlebar" data-tauri-drag-region>
      <span className="titlebar-brand" data-tauri-drag-region>
        <span className="brand-mark" data-tauri-drag-region>
          <span data-tauri-drag-region>E</span>
        </span>
        Exile's Companion
      </span>
      {overlayKey && (
        <span className="titlebar-hint" data-tauri-drag-region>
          <kbd>{comboLabel(overlayKey)}</kbd> in game to show or hide
        </span>
      )}
      <span className="spacer" data-tauri-drag-region />
      {/* Sem minimizar: o app não tem botão na barra de tarefas; o ✕ esconde na bandeja. */}
      <button className="tb-btn" onClick={() => void win.toggleMaximize()} aria-label="Maximize" title="Maximize">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      <button
        className="tb-btn close"
        onClick={() => void window.api.hideWindow()}
        aria-label="Hide to tray"
        title="Hide (Exile's Companion keeps running in the tray: alerts, auto snapshots and hotkeys stay on)"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  )
}
