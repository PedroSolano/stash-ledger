import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AppState,
  PoeItem,
  PriceStatus,
  ProgressEvent,
  Settings,
  SnapshotDetail,
  SnapshotSummary,
  StashTabInfo
} from '../shared/types'
import { AuthManager } from './auth/authManager'
import { SessionAuth } from './auth/sessionAuth'
import { DEMO_TABS, demoItems } from './demo/fixtures'
import { NinjaClient } from './ninja/ninjaClient'
import { flattenLegacyTabs, LegacyApi, normalizeAccountName, normalizePoesessid, SessionInvalidError } from './poe/legacyApi'
import { PoeApi, type StashSource } from './poe/poeApi'
import { DEFAULT_PRICING, valueItems, type TabItems } from './pricing/priceItem'
import { defaultSettings, sanitizeSettings, SettingsStore, SnapshotStore } from './store'

export interface ControllerDeps {
  userData: string
  version: string
  env: Record<string, string | undefined>
  openBrowser: (url: string) => Promise<void>
  emitProgress: (ev: ProgressEvent) => void
  emitSnapshot: (snap: SnapshotDetail) => void
}

const APP_NAME = 'StashLedger'

/** Orquestra login, abas, preços e snapshots. Toda a rede passa por aqui (processo principal). */
export class AppController {
  readonly settings: SettingsStore
  readonly auth: AuthManager
  readonly session: SessionAuth
  readonly api: PoeApi
  readonly legacy: LegacyApi
  readonly ninja: NinjaClient
  readonly snapshots: SnapshotStore
  private demo = false
  private demoSeed = 0
  private tabsCache = new Map<string, StashTabInfo[]>()
  private timer: NodeJS.Timeout | null = null
  private snapshotRunning: Promise<SnapshotDetail> | null = null

  constructor(private readonly deps: ControllerDeps) {
    this.settings = new SettingsStore(join(deps.userData, 'settings.json'), defaultSettings(deps.env))
    this.auth = new AuthManager(join(deps.userData, 'auth.bin'), {
      clientId: () => this.settings.get().clientId,
      redirectUri: () => this.settings.get().redirectUri,
      userAgent: () => this.gggUserAgent(),
      openBrowser: deps.openBrowser
    })
    const onWait = (ms: number): void => deps.emitProgress({ kind: 'ratelimit', waitMs: ms })
    this.api = new PoeApi(this.auth, () => this.gggUserAgent(), onWait)
    this.session = new SessionAuth(join(deps.userData, 'session.bin'))
    this.legacy = new LegacyApi(() => this.session.get(), () => this.ninjaUserAgent(), onWait)
    this.ninja = new NinjaClient({
      cacheDir: join(deps.userData, 'ninja-cache'),
      baseUrl: () => this.settings.get().ninjaBaseUrl,
      userAgent: () => this.ninjaUserAgent(),
      onProgress: (done, total) => deps.emitProgress({ kind: 'prices', done, total })
    })
    this.snapshots = new SnapshotStore(join(deps.userData, 'snapshots'))
  }

  async init(): Promise<void> {
    await this.settings.load()
    await this.auth.load()
    await this.session.load()
    this.schedule()
  }

  /** Quem fornece as abas agora: demo, API oficial (OAuth) ou endpoint antigo (POESESSID). */
  private method(): 'demo' | 'oauth' | 'session' | null {
    if (this.demo) return 'demo'
    if (this.auth.status().loggedIn) return 'oauth'
    if (this.session.status().loggedIn) return 'session'
    return null
  }

  private source(): StashSource {
    return this.method() === 'oauth' ? this.api : this.legacy
  }

  /** Formato exigido pela GGG: "OAuth {clientId}/{versão} (contact: {contato})". */
  private gggUserAgent(): string {
    const s = this.settings.get()
    const contact = s.contact || 'not-provided'
    return `OAuth ${s.clientId || 'unregistered'}/${this.deps.version} (contact: ${contact}) ${APP_NAME}`
  }

  private ninjaUserAgent(): string {
    const contact = this.settings.get().contact
    return `${APP_NAME}/${this.deps.version}${contact ? ` (contact: ${contact})` : ''}`
  }

  state(): AppState {
    const settings = this.settings.get()
    return {
      version: this.deps.version,
      settings,
      auth: this.auth.status().loggedIn ? this.auth.status() : this.session.status(),
      demo: this.demo,
      configured: !!settings.clientId,
      secureStorage: this.auth.secureStorage
    }
  }

  private active(): boolean {
    return this.method() !== null
  }

  async login(): Promise<AppState> {
    await this.auth.login()
    await this.session.clear()
    this.demo = false
    this.tabsCache.clear()
    this.schedule()
    return this.state()
  }

  /** Valida o POESESSID com uma requisição real antes de guardar qualquer coisa. */
  async loginSession(accountName: string, poesessid: string): Promise<AppState> {
    const creds = { accountName: normalizeAccountName(accountName), poesessid: normalizePoesessid(poesessid) }
    const s = this.settings.get()
    const league = s.league ?? (await this.ninja.leagues().catch(() => ['Standard']))[0] ?? 'Standard'
    let tabs: StashTabInfo[] | null = null
    try {
      const res = await this.legacy.request(league, 0, true, creds)
      tabs = res.tabs ? flattenLegacyTabs(res.tabs) : null
    } catch (err) {
      // Conta sem stash nesta liga ainda prova que a sessão é válida; só 401/403 reprovam.
      if (err instanceof SessionInvalidError) throw err
      if (!/não encontrada/.test((err as Error).message)) throw err
    }
    await this.auth.logout()
    await this.session.set(creds)
    this.demo = false
    this.tabsCache.clear()
    if (tabs) this.tabsCache.set(league, tabs)
    if (!s.league) await this.settings.set({ ...this.settings.get(), league })
    this.schedule()
    return this.state()
  }

  cancelLogin(): void {
    this.auth.cancelLogin()
  }

  async logout(): Promise<AppState> {
    await this.auth.logout()
    await this.session.clear()
    this.tabsCache.clear()
    this.schedule()
    return this.state()
  }

  async startDemo(): Promise<AppState> {
    this.demo = true
    this.tabsCache.clear()
    const s = this.settings.get()
    if (!s.league) {
      const leagues = await this.listLeagues()
      await this.settings.set({ ...s, league: leagues[0] ?? 'Standard' })
    }
    const league = this.settings.get().league!
    if (!this.settings.get().selectedTabs[`demo:${league}`]) {
      await this.selectTabs(league, DEMO_TABS.map((t) => t.id))
    }
    this.schedule()
    return this.state()
  }

  stopDemo(): AppState {
    this.demo = false
    this.tabsCache.clear()
    this.schedule()
    return this.state()
  }

  async listLeagues(): Promise<string[]> {
    if (this.method() !== 'oauth') return this.ninja.leagues()
    const [account, ninja] = await Promise.all([this.api.leagues(), this.ninja.leagues().catch(() => [] as string[])])
    // Ligas com preço no poe.ninja primeiro (a liga atual vem no topo).
    const priced = ninja.filter((l) => account.includes(l))
    return [...priced, ...account.filter((l) => !priced.includes(l))]
  }

  async listTabs(league: string): Promise<StashTabInfo[]> {
    if (this.demo) return DEMO_TABS
    const cached = this.tabsCache.get(league)
    if (cached) return cached
    const tabs = await this.guard(() => this.source().listTabs(league))
    this.tabsCache.set(league, tabs)
    return tabs
  }

  /** Sessão recusada: descarta o cookie para não insistir (4xx repetidos contam contra o app na GGG). */
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof SessionInvalidError && this.method() === 'session') {
        await this.session.clear()
        this.tabsCache.clear()
      }
      throw err
    }
  }

  private selectionKey(league: string): string {
    const m = this.method()
    return m === 'demo' ? `demo:${league}` : m === 'session' ? `session:${league}` : league
  }

  async selectLeague(league: string): Promise<AppState> {
    if (typeof league !== 'string' || !league || league.length > 100) throw new Error('Liga inválida.')
    await this.settings.set({ ...this.settings.get(), league })
    return this.state()
  }

  async selectTabs(league: string, tabIds: string[]): Promise<AppState> {
    const ids = [...new Set(tabIds.filter((id) => typeof id === 'string' && /^[0-9a-f]{10,64}$/i.test(id)))].slice(0, 500)
    const s = this.settings.get()
    await this.settings.set({ ...s, selectedTabs: { ...s.selectedTabs, [this.selectionKey(league)]: ids } })
    return this.state()
  }

  async updateSettings(patch: Partial<Settings>): Promise<AppState> {
    const prev = this.settings.get()
    const next = sanitizeSettings(patch, prev)
    await this.settings.set(next)
    if (prev.autoSnapshotMinutes !== next.autoSnapshotMinutes) this.schedule()
    return this.state()
  }

  async refreshPrices(force: boolean): Promise<PriceStatus> {
    const league = this.settings.get().league
    if (!league) throw new Error('Escolha uma liga primeiro.')
    const { index, status } = await this.ninja.get(league, force)
    this.deps.emitProgress({ kind: 'idle' })
    return { ...status, divineChaos: index.divineChaos || null }
  }

  getSnapshots(league: string): Promise<SnapshotSummary[]> {
    return this.snapshots.history(league, this.demo)
  }

  getLatest(league: string): Promise<SnapshotDetail | null> {
    return this.snapshots.latest(league, this.demo)
  }

  clearHistory(league: string): Promise<void> {
    return this.snapshots.clear(league, this.demo)
  }

  /** Busca as abas selecionadas, precifica tudo e grava um snapshot. */
  takeSnapshot(): Promise<SnapshotDetail> {
    if (this.snapshotRunning) return this.snapshotRunning
    this.snapshotRunning = this.doSnapshot().finally(() => {
      this.snapshotRunning = null
      this.deps.emitProgress({ kind: 'idle' })
    })
    return this.snapshotRunning
  }

  private async doSnapshot(): Promise<SnapshotDetail> {
    if (!this.active()) throw new Error('Entre com sua conta ou use o modo demonstração.')
    const s = this.settings.get()
    const league = s.league
    if (!league) throw new Error('Escolha uma liga primeiro.')
    const selected = s.selectedTabs[this.selectionKey(league)] ?? []
    if (!selected.length) throw new Error('Selecione ao menos uma aba da stash.')

    const { index, status } = await this.ninja.get(league)
    if (!index.size) throw new Error('Não foi possível carregar preços do poe.ninja para essa liga.')

    // No modo sessão as requisições usam a posição da aba, que muda se você reordenar no jogo:
    // relista a cada snapshot (1 requisição) para não ler a aba errada.
    if (this.method() === 'session') this.tabsCache.delete(league)
    const allTabs = await this.listTabs(league)
    const tabs = allTabs.filter((t) => selected.includes(t.id))
    if (!tabs.length) throw new Error('As abas selecionadas não existem mais nesta liga. Escolha as abas de novo.')
    const tabItems: TabItems[] = []
    this.demoSeed = Math.floor(Date.now() / 1000) % 100000
    const source = this.source()
    for (const [i, tab] of tabs.entries()) {
      this.deps.emitProgress({ kind: 'tabs', done: i, total: tabs.length, tabName: tab.name })
      const items: PoeItem[] = this.demo
        ? demoItems(tab.id, this.demoSeed)
        : await this.guard(() => source.tabItems(league, tab))
      tabItems.push({ tabId: tab.id, tabName: tab.name, items })
    }
    this.deps.emitProgress({ kind: 'tabs', done: tabs.length, total: tabs.length })

    const result = valueItems(tabItems, index, {
      ...DEFAULT_PRICING,
      priceBaseTypes: s.priceBaseTypes,
      includeLowConfidence: s.includeLowConfidence
    })
    const detail: SnapshotDetail = {
      id: randomUUID(),
      takenAt: Date.now(),
      league,
      totalChaos: result.totalChaos,
      divineChaos: index.divineChaos,
      itemCount: result.itemCount,
      pricedCount: result.pricedCount,
      tabs: tabs.map((t) => ({
        id: t.id,
        name: t.name,
        colour: t.colour,
        chaos: result.byTab.get(t.id)?.chaos ?? 0,
        itemCount: result.byTab.get(t.id)?.itemCount ?? 0
      })),
      items: result.items,
      pricesUpdatedAt: status.updatedAt,
      demo: this.demo || undefined
    }
    await this.snapshots.save(detail)
    this.deps.emitSnapshot(detail)
    return detail
  }

  /** Snapshot automático: só roda com sessão ativa e respeitando o mínimo de 5 minutos. */
  private schedule(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const minutes = this.settings.get()?.autoSnapshotMinutes ?? 0
    if (!minutes) return
    this.timer = setInterval(
      () => {
        if (!this.active()) return
        this.takeSnapshot().catch((err: Error) => this.deps.emitProgress({ kind: 'error', message: err.message }))
      },
      Math.max(5, minutes) * 60 * 1000
    )
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.auth.cancelLogin()
  }
}
