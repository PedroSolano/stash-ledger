/**
 * Atalhos de teclado: formato "Ctrl+Shift+Alt+<tecla>", em que a tecla é o `KeyboardEvent.code`
 * (posição física, igual em qualquer layout: ABNT2, US…). O backend (src-tauri/src/hotkeys.rs)
 * converte o nome para o scan code — manter as duas listas em sincronia.
 */

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const DIGITS = '0123456789'.split('')
const FKEYS = Array.from({ length: 24 }, (_, i) => `F${i + 1}`)
const NUMPAD = [...DIGITS.map((d) => `Numpad${d}`), 'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide', 'NumpadDecimal']
const OTHER = [
  'Space',
  'Tab',
  'Backquote',
  'Minus',
  'Equal',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'Semicolon',
  'Quote',
  'Comma',
  'Period',
  'Slash',
  'IntlBackslash',
  'IntlRo',
  'Insert',
  'Delete',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight'
]

/** Teclas aceitas (nomes do backend). */
export const HOTKEY_KEYS: readonly string[] = [...LETTERS, ...DIGITS, ...FKEYS, ...NUMPAD, ...OTHER]
const KEYS = new Set(HOTKEY_KEYS)
/** Nome em minúsculas → nome canônico (aceita "space", "f5"…). */
const CANON = new Map(HOTKEY_KEYS.map((k) => [k.toLowerCase(), k]))

const LABEL: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  IntlBackslash: '\\ (ISO)',
  IntlRo: '/ (ABNT)',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .'
}

export interface Combo {
  ctrl: boolean
  shift: boolean
  alt: boolean
  key: string
}

export function parseCombo(s: unknown): Combo | null {
  if (typeof s !== 'string') return null
  const parts = s.split('+').map((p) => p.trim())
  const key = CANON.get((parts.pop() ?? '').toLowerCase())
  if (!key) return null
  const mods = new Set(parts.map((p) => p.toLowerCase()))
  for (const m of mods) if (!['ctrl', 'shift', 'alt'].includes(m)) return null
  return { ctrl: mods.has('ctrl'), shift: mods.has('shift'), alt: mods.has('alt'), key }
}

export function formatCombo(c: Combo): string {
  return [c.ctrl && 'Ctrl', c.shift && 'Shift', c.alt && 'Alt', c.key].filter(Boolean).join('+')
}

/** Forma canônica ("shift+space" → "Shift+Space"), ou '' se inválido. */
export function normalizeCombo(s: unknown): string {
  const c = parseCombo(s)
  return c ? formatCombo(c) : ''
}

/** Texto para mostrar na interface. */
export function comboLabel(s: string): string {
  const c = parseCombo(s)
  if (!c) return '—'
  const key = LABEL[c.key] ?? c.key.replace(/^Numpad(\d)$/, 'Num $1')
  return [c.ctrl && 'Ctrl', c.shift && 'Shift', c.alt && 'Alt', key].filter(Boolean).join(' + ')
}

/** Combinação a partir de uma tecla apertada; null para modificadores sozinhos ou teclas não aceitas. */
export function comboFromEvent(e: { code: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): string | null {
  let key = e.code
  if (key.startsWith('Key')) key = key.slice(3)
  else if (key.startsWith('Digit')) key = key.slice(5)
  if (!KEYS.has(key)) return null
  return formatCombo({ ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, key })
}

export interface ChatCommand {
  key: string
  command: string
}

export const DEFAULT_CHAT_COMMANDS: ChatCommand[] = [
  { key: 'F5', command: '/hideout' },
  { key: 'F6', command: '/kingsmarch' },
  { key: 'F9', command: '/exit' }
]

/** Comandos válidos: atalho aceito, texto de uma linha só, sem atalhos repetidos. */
export function sanitizeChatCommands(v: unknown, reserved: string[] = []): ChatCommand[] {
  if (!Array.isArray(v)) return DEFAULT_CHAT_COMMANDS
  const used = new Set(reserved.filter(Boolean))
  const out: ChatCommand[] = []
  for (const raw of v.slice(0, 30)) {
    if (!raw || typeof raw !== 'object') continue
    const key = normalizeCombo((raw as ChatCommand).key)
    const command = String((raw as ChatCommand).command ?? '')
      .replace(/[\r\n\t]/g, ' ')
      .trim()
      .slice(0, 120)
    if (!command) continue
    // Sem tecla ainda (linha nova na interface) é aceito; tecla repetida não.
    if (key && used.has(key)) continue
    if (key) used.add(key)
    out.push({ key, command })
  }
  return out
}
