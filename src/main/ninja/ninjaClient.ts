import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ALL_CATEGORIES,
  categoryId,
  categoryPath,
  stripPayload,
  type NinjaCategory,
  type NinjaPayload
} from '../pricing/ninja'
import { PriceIndex } from '../pricing/priceIndex'

interface CacheEntry {
  etag?: string
  fetchedAt: number
  data: NinjaPayload
}

export interface NinjaStatus {
  league: string
  updatedAt: number | null
  categories: number
  failed: string[]
}

export interface NinjaClientOptions {
  cacheDir: string
  baseUrl: () => string
  userAgent: () => string
  onProgress?: (done: number, total: number) => void
  fetchImpl?: typeof fetch
}

/** O poe.ninja atualiza as visões gerais do PoE 1 a cada ~15 min; não adianta buscar antes disso. */
export const MIN_REFRESH_MS = 15 * 60 * 1000
/** Mesmo em atualização forçada, nunca busca uma categoria com menos de 5 min de cache. */
export const FORCE_FLOOR_MS = 5 * 60 * 1000
const CONCURRENCY = 3

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'league'
}

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(data))
  await rename(tmp, file)
}

/**
 * Cliente "educado" do poe.ninja: cache em disco por liga/categoria, requisições condicionais (ETag),
 * concorrência baixa e intervalo mínimo entre atualizações, como pede a documentação deles.
 */
export class NinjaClient {
  private memory = new Map<string, { index: PriceIndex; status: NinjaStatus }>()
  private inflight = new Map<string, Promise<{ index: PriceIndex; status: NinjaStatus }>>()
  private readonly fetchImpl: typeof fetch

  constructor(private readonly opts: NinjaClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  async leagues(): Promise<string[]> {
    const res = await this.fetchImpl(`${this.base()}/poe1/api/economy/leagues`, {
      headers: { 'User-Agent': this.opts.userAgent(), Accept: 'application/json' }
    })
    if (!res.ok) throw new Error(`poe.ninja respondeu ${res.status} ao listar ligas`)
    const data = (await res.json()) as { id: string }[]
    return data.map((l) => l.id)
  }

  /** Índice de preços da liga, buscando apenas o que estiver desatualizado. */
  async get(league: string, force = false): Promise<{ index: PriceIndex; status: NinjaStatus }> {
    const key = `${league}|${force}`
    const running = this.inflight.get(key)
    if (running) return running
    const p = this.load(league, force).finally(() => this.inflight.delete(key))
    this.inflight.set(key, p)
    return p
  }

  peek(league: string): { index: PriceIndex; status: NinjaStatus } | undefined {
    return this.memory.get(league)
  }

  private base(): string {
    return this.opts.baseUrl().replace(/\/+$/, '')
  }

  private dir(league: string): string {
    return join(this.opts.cacheDir, slug(league))
  }

  private async readCache(league: string, cat: NinjaCategory): Promise<CacheEntry | undefined> {
    try {
      const raw = await readFile(join(this.dir(league), `${categoryId(cat)}.json`), 'utf8')
      return JSON.parse(raw) as CacheEntry
    } catch {
      return undefined
    }
  }

  private async load(league: string, force: boolean): Promise<{ index: PriceIndex; status: NinjaStatus }> {
    await mkdir(this.dir(league), { recursive: true })
    const now = Date.now()
    const maxAge = force ? FORCE_FLOOR_MS : MIN_REFRESH_MS
    const entries = new Map<string, CacheEntry | undefined>()
    const failed: string[] = []

    const cached = await Promise.all(ALL_CATEGORIES.map((c) => this.readCache(league, c)))
    ALL_CATEGORIES.forEach((c, i) => entries.set(categoryId(c), cached[i]))

    const stale = ALL_CATEGORIES.filter((c) => {
      const e = entries.get(categoryId(c))
      return !e || now - e.fetchedAt >= maxAge
    })

    let done = ALL_CATEGORIES.length - stale.length
    const total = ALL_CATEGORIES.length
    this.opts.onProgress?.(done, total)

    const queue = [...stale]
    const worker = async (): Promise<void> => {
      for (let cat = queue.shift(); cat; cat = queue.shift()) {
        const id = categoryId(cat)
        try {
          const fresh = await this.fetchCategory(league, cat, entries.get(id))
          entries.set(id, fresh)
        } catch {
          failed.push(`${cat.kind}:${cat.type}`)
        }
        done++
        this.opts.onProgress?.(done, total)
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))

    const payloads = ALL_CATEGORIES.map((c) => ({ kind: c.kind, type: c.type, data: entries.get(categoryId(c))?.data }))
    const index = PriceIndex.fromPayloads(payloads)
    const times = [...entries.values()].filter(Boolean).map((e) => e!.fetchedAt)
    const status: NinjaStatus = {
      league,
      updatedAt: times.length ? Math.min(...times) : null,
      categories: payloads.filter((p) => p.data).length,
      failed
    }
    const result = { index, status }
    this.memory.set(league, result)
    return result
  }

  private async fetchCategory(league: string, cat: NinjaCategory, prev: CacheEntry | undefined): Promise<CacheEntry> {
    const headers: Record<string, string> = {
      'User-Agent': this.opts.userAgent(),
      Accept: 'application/json'
    }
    if (prev?.etag) headers['If-None-Match'] = prev.etag
    const res = await this.fetchImpl(this.base() + categoryPath(cat, league), { headers })
    const file = join(this.dir(league), `${categoryId(cat)}.json`)

    if (res.status === 304 && prev) {
      const touched = { ...prev, fetchedAt: Date.now() }
      await writeJsonAtomic(file, touched)
      return touched
    }
    if (!res.ok) throw new Error(`poe.ninja ${res.status} em ${cat.type}`)
    const raw = await res.json()
    const entry: CacheEntry = {
      etag: res.headers.get('etag') ?? undefined,
      fetchedAt: Date.now(),
      data: stripPayload(cat.kind, raw)
    }
    await writeJsonAtomic(file, entry)
    return entry
  }
}
