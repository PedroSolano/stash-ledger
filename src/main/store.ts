import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Settings, SnapshotDetail, SnapshotSummary } from '../shared/types'

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 1))
  await rename(tmp, file)
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'league'
}

export function defaultSettings(env: Record<string, string | undefined>): Settings {
  return {
    clientId: env.MAIN_VITE_POE_CLIENT_ID ?? '',
    redirectUri: env.MAIN_VITE_POE_REDIRECT_URI || 'http://127.0.0.1:8080/callback',
    contact: env.MAIN_VITE_POE_CONTACT ?? '',
    ninjaBaseUrl: env.MAIN_VITE_NINJA_BASE_URL || 'https://poe.ninja',
    league: null,
    selectedTabs: {},
    autoSnapshotMinutes: 0,
    includeLowConfidence: false,
    priceBaseTypes: true,
    hideBelowChaos: 1
  }
}

/** Valida e limpa um patch de configurações vindo do renderer. */
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
  if (patch.autoSnapshotMinutes !== undefined) {
    const n = Math.round(Number(patch.autoSnapshotMinutes))
    next.autoSnapshotMinutes = n <= 0 ? 0 : Math.min(240, Math.max(5, n))
  }
  if (patch.includeLowConfidence !== undefined) next.includeLowConfidence = !!patch.includeLowConfidence
  if (patch.priceBaseTypes !== undefined) next.priceBaseTypes = !!patch.priceBaseTypes
  if (patch.hideBelowChaos !== undefined) next.hideBelowChaos = Math.max(0, Number(patch.hideBelowChaos) || 0)
  return next
}

export class SettingsStore {
  private value!: Settings

  constructor(
    private readonly file: string,
    private readonly defaults: Settings
  ) {}

  async load(): Promise<Settings> {
    const saved = await readJson<Partial<Settings>>(this.file, {})
    this.value = { ...this.defaults, ...saved, selectedTabs: { ...(saved.selectedTabs ?? {}) } }
    // Variáveis de ambiente preenchem campos vazios (útil em desenvolvimento).
    if (!this.value.clientId) this.value.clientId = this.defaults.clientId
    if (!this.value.contact) this.value.contact = this.defaults.contact
    return this.value
  }

  get(): Settings {
    return this.value
  }

  async set(next: Settings): Promise<Settings> {
    this.value = next
    await writeJson(this.file, next)
    return next
  }
}

/** Histórico de snapshots por liga (resumos) + o último snapshot completo, para a tabela de itens. */
export class SnapshotStore {
  private static readonly MAX_HISTORY = 5000

  constructor(private readonly dir: string) {}

  private historyFile(league: string, demo: boolean): string {
    return join(this.dir, `${demo ? 'demo-' : ''}${slug(league)}-history.json`)
  }

  private latestFile(league: string, demo: boolean): string {
    return join(this.dir, `${demo ? 'demo-' : ''}${slug(league)}-latest.json`)
  }

  async history(league: string, demo: boolean): Promise<SnapshotSummary[]> {
    return readJson<SnapshotSummary[]>(this.historyFile(league, demo), [])
  }

  async latest(league: string, demo: boolean): Promise<SnapshotDetail | null> {
    return readJson<SnapshotDetail | null>(this.latestFile(league, demo), null)
  }

  async save(detail: SnapshotDetail): Promise<void> {
    const demo = !!detail.demo
    const list = await this.history(detail.league, demo)
    const { items: _items, pricesUpdatedAt: _p, ...summary } = detail
    list.push(summary)
    await writeJson(this.historyFile(detail.league, demo), list.slice(-SnapshotStore.MAX_HISTORY))
    await writeJson(this.latestFile(detail.league, demo), detail)
  }

  async clear(league: string, demo: boolean): Promise<void> {
    await rm(this.historyFile(league, demo), { force: true })
    await rm(this.latestFile(league, demo), { force: true })
  }
}
