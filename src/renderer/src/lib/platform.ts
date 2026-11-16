import { invoke } from '@tauri-apps/api/core'
import type { Platform } from '../../../core/controller'
import type { PriceCheckResult } from '../../../shared/types'

// Implementação da Platform sobre os comandos do backend Rust (src-tauri/src/lib.rs).
// Erros do Rust chegam como string; viram Error para a interface mostrar a mensagem.
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args)
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}

export const tauriPlatform: Platform = {
  appInfo: () => call('app_info'),
  storeGet: (name) => call('store_get', { name }),
  storeSet: (name, value) => call('store_set', { name, value }),
  storeDelete: (name) => call('store_delete', { name }),
  configure: (cfg) => call('configure', { cfg }),
  authStatus: () => call('auth_status'),
  sessionLogin: (accountName, poesessid, league) => call('session_login', { accountName, poesessid, league }),
  oauthLogin: () => call('oauth_login'),
  oauthCancel: () => call('oauth_cancel'),
  logout: () => call('logout'),
  accountLeagues: () => call('account_leagues'),
  stashTabs: (league) => call('stash_tabs', { league }),
  stashItems: (league, tab) => call('stash_items', { league, tab }),
  ninjaLeagues: () => call('ninja_leagues'),
  ninjaStatus: (league) => call('ninja_status', { league }),
  ninjaRefresh: (league, force) => call('ninja_refresh', { league, force }),
  ninjaPrices: (league) => call('ninja_prices', { league }),
  logError: (context, message, extra) => call('log_error', { context, message, extra: extra ?? null }),
  showAlert: (alert) => call('overlay_alert', { alert }),
  configureHotkeys: (cfg) => call('hotkeys_configure', { cfg })
}

export const pauseHotkeys = (paused: boolean): Promise<void> => call('hotkeys_pause', { paused })
export const hideWindow = (): Promise<void> => call('main_hide')
export const quitApp = (): Promise<void> => call('app_quit')
export const showPriceCheck = (result: PriceCheckResult): Promise<void> => call('pricecheck_show', { result })

export const openExternal = (url: string): Promise<void> => call('open_external', { url })
export const openLog = (): Promise<void> => call('open_log')
