import { describe, expect, it } from 'vitest'
import { comboFromEvent, comboLabel, DEFAULT_CHAT_COMMANDS, normalizeCombo, sanitizeChatCommands } from '../src/shared/hotkeys'
import { defaultSettings, sanitizeSettings } from '../src/core/settings'

const ev = (code: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods
})

describe('atalhos', () => {
  it('normaliza combinações e recusa teclas desconhecidas', () => {
    expect(normalizeCombo('shift+space')).toBe('Shift+Space')
    expect(normalizeCombo('Alt+Ctrl+D')).toBe('Ctrl+Alt+D')
    expect(normalizeCombo('F5')).toBe('F5')
    expect(normalizeCombo('Ctrl+Enter')).toBe('')
    expect(normalizeCombo('Super+D')).toBe('')
    expect(normalizeCombo(42)).toBe('')
  })

  it('lê a tecla física do evento (KeyboardEvent.code)', () => {
    expect(comboFromEvent(ev('KeyD', { altKey: true }))).toBe('Alt+D')
    expect(comboFromEvent(ev('Space', { shiftKey: true }))).toBe('Shift+Space')
    expect(comboFromEvent(ev('Digit1', { ctrlKey: true }))).toBe('Ctrl+1')
    expect(comboFromEvent(ev('IntlRo'))).toBe('IntlRo')
    // Modificador sozinho ainda não é um atalho.
    expect(comboFromEvent(ev('ShiftLeft', { shiftKey: true }))).toBeNull()
  })

  it('mostra nomes legíveis', () => {
    expect(comboLabel('Shift+Space')).toBe('Shift + Space')
    expect(comboLabel('Ctrl+Numpad5')).toBe('Ctrl + Num 5')
    expect(comboLabel('Backquote')).toBe('`')
    expect(comboLabel('')).toBe('—')
  })

  it('limpa a lista de comandos de chat', () => {
    const out = sanitizeChatCommands(
      [
        { key: 'f5', command: ' /hideout ' },
        { key: 'F5', command: '/dup' },
        { key: 'Shift+Space', command: '/clash' },
        { key: 'F6', command: '/a\n/b' },
        { key: '', command: '/menagerie' },
        { key: 'F7', command: '   ' }
      ],
      ['Shift+Space']
    )
    expect(out).toEqual([
      { key: 'F5', command: '/hideout' },
      { key: 'F6', command: '/a /b' },
      { key: '', command: '/menagerie' }
    ])
    expect(sanitizeChatCommands('nope')).toEqual(DEFAULT_CHAT_COMMANDS)
  })

  it('configurações: padrões e validação', () => {
    const d = defaultSettings()
    expect(d.overlayKey).toBe('Shift+Space')
    expect(d.chatCommands.map((c) => c.command)).toEqual(['/hideout', '/kingsmarch', '/exit'])
    // Arquivo antigo, sem os campos novos: ganha os padrões.
    expect(sanitizeSettings({}, d).chatCommands).toHaveLength(3)
    expect(sanitizeSettings({ overlayKey: 'bogus' }, d).overlayKey).toBe('Shift+Space')
    expect(sanitizeSettings({ overlayKey: '' }, d).overlayKey).toBe('')
    // Trocar o atalho do overlay para um já usado por um comando tira o comando.
    const s = sanitizeSettings({ overlayKey: 'F5' }, d)
    expect(s.chatCommands.map((c) => c.key)).toEqual(['F6', 'F9'])
  })
})
