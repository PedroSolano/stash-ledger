import { DEFAULT_CHAT_COMMANDS, normalizeCombo, sanitizeChatCommands } from '../shared/hotkeys'
import type { AlertCurrency, Settings } from '../shared/types'

export const PRICE_REFRESH_OPTIONS = [15, 30, 60, 120] as const
export const ALERT_CURRENCIES: readonly AlertCurrency[] = ['chaos', 'exalted', 'divine']

export function defaultSettings(env: Record<string, string | undefined> = {}): Settings {
  return {
    clientId: env.VITE_POE_CLIENT_ID ?? '',
    redirectUri: env.VITE_POE_REDIRECT_URI || 'http://127.0.0.1:8080/callback',
    contact: env.VITE_POE_CONTACT ?? '',
    ninjaBaseUrl: 'https://poe.ninja',
    league: null,
    selectedTabs: {},
    autoSnapshotMinutes: 0,
    includeLowConfidence: false,
    priceBaseTypes: true,
    hideBelowChaos: 1,
    priceRefreshMinutes: 30,
    alertsEnabled: true,
    alertThreshold: 1,
    alertCurrency: 'divine',
    alertSound: true,
    hotkeysEnabled: true,
    overlayKey: 'Shift+Space',
    chatCommands: DEFAULT_CHAT_COMMANDS.map((c) => ({ ...c })),
    priceCheckKey: 'Alt+D'
  }
}

/** Valida e limpa um patch de configurações (vindo da interface ou de um arquivo antigo). */
export function sanitizeSettings(patch: Partial<Settings>, current: Settings): Settings {
  const next: Settings = { ...current }
  const str = (v: unknown, max = 300): string | undefined => (typeof v === 'string' ? v.trim().slice(0, max) : undefined)
  if (patch.clientId !== undefined) next.clientId = (str(patch.clientId, 100) ?? '').replace(/[^\w.-]/g, '')
  if (patch.redirectUri !== undefined) next.redirectUri = str(patch.redirectUri) ?? current.redirectUri
  if (patch.contact !== undefined) next.contact = (str(patch.contact, 120) ?? '').replace(/[\r\n()]/g, '')
  if (patch.ninjaBaseUrl !== undefined) {
    const v = str(patch.ninjaBaseUrl) ?? ''
    try {
      const u = new URL(v)
      if (u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname))) {
        next.ninjaBaseUrl = u.toString().replace(/\/+$/, '')
      }
    } catch {
      /* mantém o valor atual */
    }
  }
  if (patch.league !== undefined) next.league = typeof patch.league === 'string' && patch.league ? patch.league.slice(0, 100) : null
  if (patch.selectedTabs !== undefined && patch.selectedTabs && typeof patch.selectedTabs === 'object') {
    const clean: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(patch.selectedTabs)) {
      if (typeof k === 'string' && k.length <= 120 && Array.isArray(v)) {
        clean[k] = v.filter((id) => typeof id === 'string' && /^[0-9a-f]{10,64}$/i.test(id)).slice(0, 500)
      }
    }
    next.selectedTabs = clean
  }
  if (patch.autoSnapshotMinutes !== undefined) {
    const n = Math.round(Number(patch.autoSnapshotMinutes))
    next.autoSnapshotMinutes = n <= 0 ? 0 : Math.min(240, Math.max(5, n))
  }
  if (patch.includeLowConfidence !== undefined) next.includeLowConfidence = !!patch.includeLowConfidence
  if (patch.priceBaseTypes !== undefined) next.priceBaseTypes = !!patch.priceBaseTypes
  if (patch.hideBelowChaos !== undefined) next.hideBelowChaos = Math.max(0, Number(patch.hideBelowChaos) || 0)
  if (patch.priceRefreshMinutes !== undefined) {
    const n = Math.round(Number(patch.priceRefreshMinutes))
    // poe.ninja atualiza a cada ~15 min: menos que isso só gasta rede sem trazer nada novo.
    next.priceRefreshMinutes = Math.min(240, Math.max(15, Number.isFinite(n) ? n : 30))
  }
  if (patch.alertsEnabled !== undefined) next.alertsEnabled = !!patch.alertsEnabled
  if (patch.alertSound !== undefined) next.alertSound = !!patch.alertSound
  // Até a 0.7.2 o valor era sempre em divines (alertThresholdDiv).
  const legacyDiv = (patch as { alertThresholdDiv?: unknown }).alertThresholdDiv
  if (patch.alertThreshold === undefined && legacyDiv !== undefined) {
    patch = { ...patch, alertThreshold: Number(legacyDiv), alertCurrency: patch.alertCurrency ?? 'divine' }
  }
  if (patch.alertCurrency !== undefined) {
    next.alertCurrency = ALERT_CURRENCIES.includes(patch.alertCurrency) ? patch.alertCurrency : current.alertCurrency
  }
  if (patch.alertThreshold !== undefined) {
    const n = Number(patch.alertThreshold)
    next.alertThreshold = Number.isFinite(n) && n > 0 ? Math.min(1_000_000, Math.max(0.01, Math.round(n * 100) / 100)) : current.alertThreshold
  }
  if (patch.hotkeysEnabled !== undefined) next.hotkeysEnabled = !!patch.hotkeysEnabled
  // Atalho vazio desliga a função; inválido mantém o atual.
  if (patch.overlayKey !== undefined) next.overlayKey = patch.overlayKey === '' ? '' : normalizeCombo(patch.overlayKey) || current.overlayKey
  if (patch.priceCheckKey !== undefined) {
    const k = patch.priceCheckKey === '' ? '' : normalizeCombo(patch.priceCheckKey) || current.priceCheckKey
    // Mesmo atalho do overlay: o do overlay vence.
    next.priceCheckKey = k && k === next.overlayKey ? '' : k
  }
  if (patch.chatCommands !== undefined || patch.overlayKey !== undefined || patch.priceCheckKey !== undefined) {
    next.chatCommands = sanitizeChatCommands(patch.chatCommands ?? current.chatCommands, [next.overlayKey, next.priceCheckKey])
  }
  return next
}
