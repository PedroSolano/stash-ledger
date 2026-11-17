import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'
import type {
  PriceCheckResult,
  ProgressEvent,
  SnapshotDetail,
  StashLedgerApi,
  UpdateState,
  WindowVisibility
} from '../../../shared/types'
import { Controller } from '../../../core/controller'
import { hideWindow, openExternal, openLog, pauseHotkeys, quitApp, showPriceCheck, tauriPlatform } from './platform'

// Monta a window.api usada pelos componentes: controller (TS) + backend Rust + updater do Tauri.

type Listener<T> = (v: T) => void
function emitter<T>() {
  const ls = new Set<Listener<T>>()
  return {
    emit: (v: T) => ls.forEach((l) => l(v)),
    on: (l: Listener<T>) => {
      ls.add(l)
      return () => ls.delete(l)
    }
  }
}

const progress = emitter<ProgressEvent>()
const snapshots = emitter<SnapshotDetail>()
const updates = emitter<UpdateState>()
const visibility = emitter<WindowVisibility>()

const controller = new Controller(
  tauriPlatform,
  { progress: progress.emit, snapshot: snapshots.emit },
  import.meta.env as unknown as Record<string, string | undefined>
)
const ready = controller.init()

// Eventos emitidos pelo Rust (espera do rate limit da GGG, progresso do download de preços).
void listen<ProgressEvent>('progress', (e) => progress.emit(e.payload))
// `exiles-companion.exe --test-alert` (segunda instância) pede um alerta de teste.
void listen('test-alert', () => void ready.then(() => controller.testAlert()).catch(() => undefined))
// A janela vai e volta da bandeja (atalho do overlay, ícone da bandeja, botão fechar).
void listen<WindowVisibility>('main-visible', (e) => visibility.emit(e.payload))
// Price check: o atalho copiou um item no jogo; o preço sai do cache local do poe.ninja.
void listen<{ text: string }>('price-check', (e) => {
  void ready
    .then(() => controller.priceCheck(e.payload.text))
    .catch(
      (err: Error): PriceCheckResult => ({
        ok: false,
        name: 'Price check failed',
        frameType: 0,
        quantity: 1,
        divineChaos: 0,
        message: err?.message ?? String(err)
      })
    )
    .then((ninja) => showPriceCheck({ text: e.payload.text, ninja, league: controller.league() }))
    .catch(() => undefined)
})
// "Quit" na bandeja: fecha de vez, instalando antes a atualização que estiver pronta.
void listen('quit-requested', () => void quit())

// Só em desenvolvimento: VITE_DEV_DEMO=1 entra no modo demonstração e tira um snapshot ao abrir.
if (import.meta.env.DEV && import.meta.env.VITE_DEV_DEMO === '1') {
  void ready
    .then(() => controller.startDemo())
    .then(() => controller.takeSnapshot())
    .then((s) => console.info(`[dev-demo] ${s.pricedCount}/${s.itemCount} priced, ${Math.round(s.totalChaos)}c`))
    .catch((e: Error) => console.error('[dev-demo]', e.message))
}

/* ---------- atualização automática (tauri-plugin-updater, assinada) ---------- */

const RECHECK_MS = 4 * 3600 * 1000
let update: UpdateState = { status: import.meta.env.DEV ? 'disabled' : 'idle' }
let pending: Update | null = null

function setUpdate(s: UpdateState): void {
  update = s
  updates.emit(s)
}

async function checkUpdate(): Promise<void> {
  if (import.meta.env.DEV || update.status === 'downloading' || update.status === 'ready') return
  setUpdate({ status: 'checking' })
  try {
    const found = await check()
    if (!found) return setUpdate({ status: 'latest' })
    let total = 0
    let received = 0
    setUpdate({ status: 'downloading', version: found.version, percent: 0 })
    await found.download((ev) => {
      if (ev.event === 'Started') total = ev.data.contentLength ?? 0
      else if (ev.event === 'Progress') {
        received += ev.data.chunkLength
        setUpdate({ status: 'downloading', version: found.version, percent: total ? Math.min(100, Math.round((received / total) * 100)) : 0 })
      }
    })
    pending = found
    setUpdate({ status: 'ready', version: found.version })
  } catch (err) {
    setUpdate({ status: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

if (!import.meta.env.DEV) {
  setTimeout(() => void checkUpdate(), 3000)
  setInterval(() => void checkUpdate(), RECHECK_MS)
}

async function installUpdate(): Promise<void> {
  if (!pending) return
  // No Windows o instalador fecha o app sozinho; relaunch cobre os outros sistemas.
  await pending.install()
  await relaunch()
}

async function quit(): Promise<void> {
  if (pending) {
    try {
      // O instalador do Windows fecha o app sozinho.
      await pending.install()
      return
    } catch {
      /* segue fechando sem atualizar */
    }
  }
  await quitApp()
}

/* ---------- API ---------- */

const api: StashLedgerApi = {
  getState: async () => {
    await ready
    return controller.state()
  },
  login: () => controller.login(),
  loginSession: (accountName, poesessid) => controller.loginSession(accountName, poesessid),
  cancelLogin: () => controller.cancelLogin(),
  logout: () => controller.logout(),
  startDemo: () => controller.startDemo(),
  stopDemo: () => controller.stopDemo(),
  listLeagues: () => controller.listLeagues(),
  listTabs: (league) => controller.listTabs(league),
  selectLeague: (league) => controller.selectLeague(league),
  selectTabs: (league, ids) => controller.selectTabs(league, ids),
  refreshPrices: (force) => controller.refreshPrices(force),
  takeSnapshot: () => controller.takeSnapshot(),
  getSnapshots: (league) => controller.getSnapshots(league),
  getLatest: (league) => controller.getLatest(league),
  clearHistory: (league) => controller.clearHistory(league),
  updateSettings: (patch) => controller.updateSettings(patch),
  openExternal: (url) => openExternal(url),
  testAlert: () => controller.testAlert(),
  pauseHotkeys: (paused) => pauseHotkeys(paused),
  hideWindow: () => hideWindow(),
  quit: () => quit(),
  getVisibility: () => invoke<WindowVisibility>('main_visibility'),
  onVisibility: (cb) => {
    const off = visibility.on(cb)
    return () => void off()
  },
  onProgress: (cb) => {
    const off = progress.on(cb)
    return () => void off()
  },
  onSnapshot: (cb) => {
    const off = snapshots.on(cb)
    return () => void off()
  },
  openLog: () => openLog(),
  getUpdate: async () => update,
  checkUpdate: () => checkUpdate(),
  installUpdate: () => installUpdate(),
  onUpdate: (cb) => {
    const off = updates.on(cb)
    return () => void off()
  }
}

window.api = api
