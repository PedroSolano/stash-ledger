import { useState } from 'react'
import { comboFromEvent, comboLabel } from '../../../shared/hotkeys'

interface Props {
  id?: string
  value: string
  onChange: (combo: string) => void
  disabled?: boolean
  invalid?: boolean
}

/**
 * Grava um atalho: clique e aperte a combinação. Esc cancela, Backspace limpa.
 * Enquanto grava, os atalhos do app ficam pausados (senão o próprio Shift+Space esconderia a janela).
 */
export function HotkeyInput({ id, value, onChange, disabled, invalid }: Props) {
  const [recording, setRecording] = useState(false)
  return (
    <input
      id={id}
      readOnly
      disabled={disabled}
      className={`input hotkey-input${recording ? ' recording' : ''}`}
      style={invalid ? { borderColor: 'var(--bad)' } : undefined}
      value={recording ? 'Press keys… (Esc cancels)' : value ? comboLabel(value) : 'Not set'}
      onFocus={() => {
        setRecording(true)
        void window.api.pauseHotkeys(true)
      }}
      onBlur={() => {
        setRecording(false)
        void window.api.pauseHotkeys(false)
      }}
      onKeyDown={(e) => {
        if (!recording) return
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Escape') return e.currentTarget.blur()
        if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
          onChange('')
          return e.currentTarget.blur()
        }
        const combo = comboFromEvent(e)
        if (combo) {
          onChange(combo)
          e.currentTarget.blur()
        }
      }}
    />
  )
}
