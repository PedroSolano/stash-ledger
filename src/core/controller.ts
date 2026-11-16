import type {
  AppState,
  AuthStatus,
  DropAlert,
  PoeItem,
  PricedItem,
  PriceStatus,
  ProgressEvent,
  Settings,
  SnapshotDetail,
  SnapshotSummary,
  StashTabInfo
} from '../shared/types'
import { buildAlert, detectDrops } from './alerts'
import { DEMO_TABS, demoItems } from './demo/fixtures'
import type { CompactPrices } from './pricing/ninja'
import { PriceIndex } from './pricing/priceIndex'
import { DEFAULT_PRICING, valueItems, type TabItems } from './pricing/priceItem'
import { defaultSettings, sanitizeSettings } from './settings'

/** Status do cache local de preços, como o backend devolve. */
export interface NinjaStatus {
  updatedAt: number | null
  categories: number
  failed: string[]
}

/**
 * Tudo que depende do sistema (rede, segredos, arquivos) mora no backend Rust (src-tauri).
 * O controller só fala com ele por esta interface, o que também permite testá-lo sem o Tauri.
 */
export interface Platform {
  appInfo(): Promise<{ version: string; secureStorage: boolean }>
  storeGet<T>(name: string): Promise<T | null>
  storeSet(name: string, value: unknown): Promise<void>
  storeDelete(name: string): Promise<void>
  configure(cfg: { clientId: string; redirectUri: string; contact: string; ninjaBaseUrl: string }): Promise<void>
  authStatus(): Promise<AuthStatus>
  sessionLogin(accountName: string, poesessid: string, league: string): Promise<StashTabInfo[] | null>
  oauthLogin(): Promise<AuthStatus>
  oauthCancel(): Promise<void>
  logout(): Promise<void>
  accountLeagues(): Promise<string[]>
  stashTabs(league: string): Promise<StashTabInfo[]>
  stashItems(league: string, tab: StashTabInfo): Promise<unknown[]>
  ninjaLeagues(): Promise<string[]>
  ninjaStatus(league: string): Promise<NinjaStatus>
  ninjaRefresh(league: string, force: boolean): Promise<NinjaStatus>
  ninjaPrices(league: string): Promise<CompactPrices | null>
  logError(context: string, message: string, extra?: Record<string, unknown>): Promise<void>
  /** Abre o overlay de alerta no canto superior esquerdo da tela, sem tirar o foco do jogo. */
  showAlert(alert: DropAlert): Promise<void>
}

export interface ControllerEvents {
  progress(ev: ProgressEvent): void
  snapshot(snap: SnapshotDetail): void
}

const MAX_HISTORY = 5000

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'league'
}

export class Controller {
  private settings: Settings
  private info = { version: '0.0.0', secureStorage: false }
  private auth: AuthStatus = { loggedIn: false }
  private demo = false
  private tabsCache = new Map<string, StashTabInfo[]>()
  private snapshotTimer: ReturnType<typeof setInterval> | null = null
  private priceTimer: ReturnType<typeof setInterval> | null = null
  private running: Promise<SnapshotDetail> | null = null

  constructor(
    private readonly p: Platform,
    private readonly events: ControllerEvents,
    env: Record<string, string | undefined> = {}
  ) {
    this.settings = defaultSettings(env)
  }

  async init(): Promise<void> {
    this.info = await this.p.appInfo()
    const saved = await this.p.storeGet<Partial<Settings>>('settings').catch(() => null)
    const defaults = this.settings
    this.settings = sanitizeSettings(saved ?? {}, defaults)
    // Variáveis de build preenchem campos vazios (client_id do release, por exemplo).
    if (!this.settings.clientId) this.settings.clientId = defaults.clientId
    if (!this.settings.contact) this.settings.contact = defaults.contact
    await this.pushConfig()
    this.auth = await this.p.authStatus()
    this.schedule()
  }

  private pushConfig(): Promise<void> {
    const s = this.settings
    return this.p.configure({ clientId: s.clientId, redirectUri: s.redirectUri, contact: s.contact, ninjaBaseUrl: s.ninjaBaseUrl })
  }

  private method(): 'demo' | 'oauth' | 'session' | null {
    if (this.demo) return 'demo'
    if (this.auth.loggedIn) return this.auth.method ?? 'oauth'
    return null
  }

  private active(): boolean {
    return this.method() !== null
  }

  async state(): Promise<AppState> {
    this.auth = await this.p.authStatus().catch(() => this.auth)
    return {
      version: this.info.version,
      settings: this.settings,
      auth: this.auth,
      demo: this.demo,
      configured: !!this.settings.clientId,
      secureStorage: this.info.secureStorage
    }
  }

  private async saveSettings(next: Settings): Promise<void> {
    const prev = this.settings
    this.settings = next
    await this.p.storeSet('settings', next)
    if (
      prev.clientId !== next.clientId ||
      prev.redirectUri !== next.redirectUri ||
      prev.contact !== next.contact ||
      prev.ninjaBaseUrl !== next.ninjaBaseUrl
    ) {
      await this.pushConfig()
    }
    if (prev.autoSnapshotMinutes !== next.autoSnapshotMinutes || prev.priceRefreshMinutes !== next.priceRefreshMinutes) {
      this.schedule()
    }
  }

  /* ---------- sessão ---------- */

  async login(): Promise<AppState> {
    this.auth = await this.p.oauthLogin()
    this.demo = false
    this.tabsCache.clear()
    this.schedule()
    return this.state()
  }

  async loginSession(accountName: string, poesessid: string): Promise<AppState> {
    const league = this.settings.league ?? (await this.p.ninjaLeagues().catch(() => ['Standard']))[0] ?? 'Standard'
    const tabs = await this.p.sessionLogin(accountName, poesessid, league)
    this.demo = false
    this.tabsCache.clear()
    if (tabs) this.tabsCache.set(league, tabs)
    if (!this.settings.league) await this.saveSettings({ ...this.settings, league })
    this.auth = await this.p.authStatus()
    this.schedule()
    return this.state()
  }

  cancelLogin(): Promise<void> {
    return this.p.oauthCancel()
  }

  async logout(): Promise<AppState> {
    await this.p.logout()
    this.tabsCache.clear()
    this.auth = { loggedIn: false }
    this.schedule()
    return this.state()
  }

  async startDemo(): Promise<AppState> {
    this.demo = true
    this.tabsCache.clear()
    if (!this.settings.league) {
      const leagues = await this.listLeagues()
      await this.saveSettings({ ...this.settings, league: leagues[0] ?? 'Standard' })
    }
    const league = this.settings.league!
    if (!this.settings.selectedTabs[`demo:${league}`]) {
      await this.selectTabs(league, DEMO_TABS.map((t) => t.id))
    }
    this.schedule()
    return this.state()
  }

  async stopDemo(): Promise<AppState> {
    this.demo = false
    this.tabsCache.clear()
    this.schedule()
    return this.state()
  }

  /* ---------- ligas e abas ---------- */

  async listLeagues(): Promise<string[]> {
    if (this.method() !== 'oauth') return this.p.ninjaLeagues()
    const [account, ninja] = await Promise.all([this.p.accountLeagues(), this.p.ninjaLeagues().catch(() => [] as string[])])
    // Ligas com preço no poe.ninja primeiro (a liga atual vem no topo).
    const priced = ninja.filter((l) => account.includes(l))
    return [...priced, ...account.filter((l) => !priced.includes(l))]
  }

  async listTabs(league: string): Promise<StashTabInfo[]> {
    if (this.demo) return DEMO_TABS
    const cached = this.tabsCache.get(league)
    if (cached) return cached
    const tabs = await this.p.stashTabs(league)
    this.tabsCache.set(league, tabs)
    return tabs
  }

  private selectionKey(league: string): string {
    const m = this.method()
    return m === 'demo' ? `demo:${league}` : m === 'session' ? `session:${league}` : league
  }

  async selectLeague(league: string): Promise<AppState> {
    if (typeof league !== 'string' || !league || league.length > 100) throw new Error('Invalid league.')
    await this.saveSettings({ ...this.settings, league })
    return this.state()
  }

  async selectTabs(league: string, tabIds: string[]): Promise<AppState> {
    const ids = [...new Set(tabIds.filter((id) => typeof id === 'string' && /^[0-9a-f]{10,64}$/i.test(id)))].slice(0, 500)
    const s = this.settings
    await this.saveSettings({ ...s, selectedTabs: { ...s.selectedTabs, [this.selectionKey(league)]: ids } })
    return this.state()
  }

  async updateSettings(patch: Partial<Settings>): Promise<AppState> {
    await this.saveSettings(sanitizeSettings(patch, this.settings))
    return this.state()
  }

  /* ---------- preços ---------- */

  async refreshPrices(force: boolean): Promise<PriceStatus> {
    const league = this.settings.league
    if (!league) throw new Error('Pick a league first.')
    const status = await this.p.ninjaRefresh(league, force)
    this.events.progress({ kind: 'idle' })
    return { league, ...status, divineChaos: null }
  }

  /**
   * As consultas usam o cache local; a rede só entra se o cache estiver vazio ou muito velho
   * (o agendador normalmente já o mantém em dia, a cada `priceRefreshMinutes`).
   */
  private async ensurePrices(league: string): Promise<{ index: PriceIndex; updatedAt: number | null }> {
    let status = await this.p.ninjaStatus(league)
    const maxAge = Math.max(2 * this.settings.priceRefreshMinutes, 60) * 60_000
    if (!status.updatedAt || Date.now() - status.updatedAt > maxAge || status.categories === 0) {
      status = await this.p.ninjaRefresh(league, false)
    }
    const cats = await this.p.ninjaPrices(league)
    if (!cats) throw new Error('Could not load poe.ninja prices for this league.')
    const index = PriceIndex.fromCompact(cats)
    if (!index.size) throw new Error('Could not load poe.ninja prices for this league.')
    return { index, updatedAt: status.updatedAt }
  }

  /* ---------- snapshots ---------- */

  private historyName(league: string): string {
    return `snapshots/${this.demo ? 'demo-' : ''}${slug(league)}-history`
  }

  private latestName(league: string): string {
    return `snapshots/${this.demo ? 'demo-' : ''}${slug(league)}-latest`
  }

  async getSnapshots(league: string): Promise<SnapshotSummary[]> {
    return (await this.p.storeGet<SnapshotSummary[]>(this.historyName(league))) ?? []
  }

  getLatest(league: string): Promise<SnapshotDetail | null> {
    return this.p.storeGet<SnapshotDetail>(this.latestName(league))
  }

  /** Overlay de teste: o item mais valioso do último snapshot (ou um exemplo, se ainda não houver). */
  async testAlert(): Promise<void> {
    const league = this.settings.league
    const latest = league ? await this.getLatest(league).catch(() => null) : null
    const top = latest?.items
      .filter((i) => i.counted && i.unitChaos > 0)
      .reduce<PricedItem | undefined>((best, i) => (!best || i.unitChaos > best.unitChaos ? i : best), undefined)
    const divine = latest?.divineChaos || 140
    const item = top
      ? { name: top.name, detail: top.detail, icon: top.icon, frameType: top.frameType, quantity: 1, unitChaos: top.unitChaos, totalChaos: top.unitChaos }
      : { name: 'Mirror Shard', icon: '', frameType: 5, quantity: 1, unitChaos: 13 * divine, totalChaos: 13 * divine }
    await this.p.showAlert({ ...buildAlert([item], divine, this.settings.alertSound), test: true })
  }

  async clearHistory(league: string): Promise<void> {
    await this.p.storeDelete(this.historyName(league))
    await this.p.storeDelete(this.latestName(league))
  }

  takeSnapshot(): Promise<SnapshotDetail> {
    if (this.running) return this.running
    this.running = this.doSnapshot()
      .catch(async (err: unknown) => {
        await this.p.logError('snapshot', (err as Error)?.message ?? String(err), {
          method: this.method(),
          league: this.settings.league
        }).catch(() => undefined)
        // Uma sessão recusada é apagada pelo backend: sincroniza o estado.
        this.auth = await this.p.authStatus().catch(() => this.auth)
        throw err
      })
      .finally(() => {
        this.running = null
        this.events.progress({ kind: 'idle' })
      })
    return this.running
  }

  private async doSnapshot(): Promise<SnapshotDetail> {
    if (!this.active()) throw new Error('Sign in or use demo mode first.')
    const s = this.settings
    const league = s.league
    if (!league) throw new Error('Pick a league first.')
    const selected = s.selectedTabs[this.selectionKey(league)] ?? []
    if (!selected.length) throw new Error('Select at least one stash tab.')

    const { index, updatedAt } = await this.ensurePrices(league)

    // No modo sessão o backend acessa as abas pela posição, que muda se você reordenar no jogo:
    // relista a cada snapshot (1 requisição) para não ler a aba errada.
    if (this.method() === 'session') this.tabsCache.delete(league)
    const allTabs = await this.listTabs(league)
    const tabs = allTabs.filter((t) => selected.includes(t.id))
    if (!tabs.length) throw new Error('The selected tabs no longer exist in this league. Pick your tabs again.')

    const seed = Math.floor(Date.now() / 1000) % 100000
    const tabItems: TabItems[] = []
    for (const [i, tab] of tabs.entries()) {
      this.events.progress({ kind: 'tabs', done: i, total: tabs.length, tabName: tab.name })
      const items = this.demo ? demoItems(tab.id, seed) : ((await this.p.stashItems(league, tab)) as PoeItem[])
      tabItems.push({ tabId: tab.id, tabName: tab.name, items })
    }
    this.events.progress({ kind: 'tabs', done: tabs.length, total: tabs.length })

    let logged = 0
    const result = valueItems(tabItems, index, {
      ...DEFAULT_PRICING,
      priceBaseTypes: s.priceBaseTypes,
      includeLowConfidence: s.includeLowConfidence,
      onItemError: (err, item) => {
        // Os primeiros 20 erros por snapshot bastam para diagnosticar.
        if (logged++ < 20) {
          void this.p.logError('pricing', (err as Error)?.message ?? String(err), {
            typeLine: item.typeLine,
            name: item.name,
            baseType: item.baseType,
            frameType: item.frameType,
            ilvl: item.ilvl
          })
        }
      }
    })

    const detail: SnapshotDetail = {
      id: crypto.randomUUID(),
      takenAt: Date.now(),
      league,
      totalChaos: result.totalChaos,
      divineChaos: index.divineChaos,
      itemCount: result.itemCount,
      pricedCount: result.pricedCount,
      errorCount: result.errorCount || undefined,
      tabs: tabs.map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        colour: t.colour,
        chaos: result.byTab.get(t.id)?.chaos ?? 0,
        itemCount: result.byTab.get(t.id)?.itemCount ?? 0
      })),
      items: result.items,
      pricesUpdatedAt: updatedAt,
      demo: this.demo || undefined
    }

    // Sirene: compara com o snapshot anterior antes de sobrescrevê-lo.
    if (s.alertsEnabled && index.divineChaos > 0) {
      const prev = await this.getLatest(league).catch(() => null)
      const drops = detectDrops(prev, detail, s.alertThresholdDiv * index.divineChaos)
      if (drops.length) {
        this.p.showAlert(buildAlert(drops, index.divineChaos, s.alertSound)).catch((e: Error) => void this.p.logError('alert', e.message))
      }
    }

    const { items: _items, pricesUpdatedAt: _p, ...summary } = detail
    const history = await this.getSnapshots(league)
    history.push(summary)
    await this.p.storeSet(this.historyName(league), history.slice(-MAX_HISTORY))
    await this.p.storeSet(this.latestName(league), detail)
    this.events.snapshot(detail)
    return detail
  }

  /* ---------- agendamento ---------- */

  /**
   * Dois relógios, ambos só com sessão ativa: atualização do cache de preços (requisições
   * condicionais; quase sempre respostas 304 vazias) e snapshot automático, se ligado.
   */
  private schedule(): void {
    if (this.snapshotTimer) clearInterval(this.snapshotTimer)
    if (this.priceTimer) clearInterval(this.priceTimer)
    this.snapshotTimer = null
    this.priceTimer = null
    if (!this.active()) return

    this.priceTimer = setInterval(
      () => {
        const league = this.settings.league
        if (!this.active() || !league || this.running) return
        this.p.ninjaRefresh(league, false).catch((err: Error) => void this.p.logError('prices', err.message))
      },
      Math.max(15, this.settings.priceRefreshMinutes) * 60_000
    )

    const minutes = this.settings.autoSnapshotMinutes
    if (minutes) {
      this.snapshotTimer = setInterval(
        () => {
          if (!this.active()) return
          this.takeSnapshot().catch((err: Error) => this.events.progress({ kind: 'error', message: err.message }))
        },
        Math.max(5, minutes) * 60_000
      )
    }
  }
}
