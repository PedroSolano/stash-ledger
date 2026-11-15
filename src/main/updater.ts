import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/types'

/** Verifica de novo a cada 4 h, para quem deixa o app aberto. */
const RECHECK_MS = 4 * 3600 * 1000

/**
 * Auto-update via GitHub Releases (electron-updater). Ao abrir, o app procura uma versão nova,
 * baixa em segundo plano e avisa a interface; a instalação acontece ao reiniciar (ou ao fechar).
 * O endereço do repositório vem do app-update.yml que o electron-builder grava no instalador.
 * Os downloads são conferidos pelo hash SHA-512 publicado no latest.yml do release.
 */
export class Updater {
  private state: UpdateState = { status: 'idle' }
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly emit: (s: UpdateState) => void) {}

  get(): UpdateState {
    return this.state
  }

  private set(s: UpdateState): void {
    this.state = s
    this.emit(s)
  }

  start(): void {
    // Em desenvolvimento não há instalador nem app-update.yml.
    if (!app.isPackaged) {
      this.set({ status: 'disabled' })
      return
    }
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.logger = null

    autoUpdater.on('checking-for-update', () => {
      if (this.state.status !== 'downloading' && this.state.status !== 'ready') this.set({ status: 'checking' })
    })
    autoUpdater.on('update-not-available', () => this.set({ status: 'latest' }))
    autoUpdater.on('update-available', (info) => this.set({ status: 'downloading', version: info.version, percent: 0 }))
    autoUpdater.on('download-progress', (p) => {
      const version = this.state.status === 'downloading' ? this.state.version : '?'
      this.set({ status: 'downloading', version, percent: Math.round(p.percent) })
    })
    autoUpdater.on('update-downloaded', (info) => this.set({ status: 'ready', version: info.version }))
    autoUpdater.on('error', (err) => {
      // Sem internet ou sem release publicado: não atrapalha o uso, só registra o estado.
      if (this.state.status !== 'ready') this.set({ status: 'error', message: err?.message ?? String(err) })
    })

    this.check()
    this.timer = setInterval(() => this.check(), RECHECK_MS)
  }

  check(): void {
    if (!app.isPackaged || this.state.status === 'ready' || this.state.status === 'downloading') return
    autoUpdater.checkForUpdates().catch(() => undefined)
  }

  /** Fecha o app, instala em modo silencioso e abre a versão nova. */
  install(): void {
    if (this.state.status !== 'ready') return
    setImmediate(() => autoUpdater.quitAndInstall(true, true))
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
  }
}
