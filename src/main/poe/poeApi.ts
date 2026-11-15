import type { PoeItem, PoeStashTab, StashTabInfo } from '../../shared/types'
import type { AuthManager } from '../auth/authManager'
import { RateLimiter } from './rateLimiter'

const API = 'https://api.pathofexile.com'

export class PoeApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

/** Origem das abas: API oficial (OAuth) ou endpoint antigo (POESESSID). */
export interface StashSource {
  leagues(): Promise<string[]>
  listTabs(league: string): Promise<StashTabInfo[]>
  tabItems(league: string, tab: StashTabInfo): Promise<PoeItem[]>
}

/** Valida IDs de aba (string hexadecimal de 10 caracteres, segundo a documentação). */
export function isStashId(id: string): boolean {
  return /^[0-9a-f]{10}$/i.test(id)
}

/**
 * Cliente da API oficial da GGG. Todas as chamadas passam pelo RateLimiter e rodam em série.
 * Erros 4xx contam para o limite de "requisições inválidas" da GGG, então só há uma nova tentativa
 * para 401 (token renovado) e para 429 (após o Retry-After).
 */
export class PoeApi implements StashSource {
  readonly limiter: RateLimiter

  constructor(
    private readonly auth: AuthManager,
    private readonly userAgent: () => string,
    onWait?: (ms: number) => void,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.limiter = new RateLimiter(onWait)
  }

  private async get<T>(endpoint: string, path: string, attempt = 0): Promise<T> {
    const res = await this.limiter.schedule(endpoint, async () => {
      const token = await this.auth.accessToken()
      const r = await this.fetchImpl(API + path, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': this.userAgent(), Accept: 'application/json' }
      })
      this.limiter.update(endpoint, r.headers, r.status)
      return r
    })
    if (res.status === 401 && attempt === 0) {
      await this.auth.refresh()
      return this.get<T>(endpoint, path, attempt + 1)
    }
    if (res.status === 429 && attempt === 0) return this.get<T>(endpoint, path, attempt + 1)
    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      try {
        const body = (await res.json()) as { error?: { message?: string } }
        if (body.error?.message) msg = body.error.message
      } catch {
        /* sem corpo JSON */
      }
      if (res.status === 403) msg = 'GGG denied access (missing scope). Please sign in again.'
      throw new PoeApiError(`GGG API: ${msg}`, res.status)
    }
    return (await res.json()) as T
  }

  async leagues(): Promise<string[]> {
    const data = await this.get<{ leagues: { id: string; realm?: string }[] }>('leagues', '/account/leagues')
    return data.leagues.filter((l) => !l.realm || l.realm === 'pc').map((l) => l.id)
  }

  async listTabs(league: string): Promise<StashTabInfo[]> {
    const data = await this.get<{ stashes: PoeStashTab[] }>('stash-list', `/stash/${encodeURIComponent(league)}`)
    return flattenTabs(data.stashes ?? [])
  }

  /** Itens de uma aba, incluindo sub-abas (abas de mapas/únicos são divididas pela GGG). */
  async tabItems(league: string, tab: StashTabInfo): Promise<PoeItem[]> {
    if (!isStashId(tab.id) || (tab.parentId && !isStashId(tab.parentId))) throw new Error('Invalid tab ID.')
    const l = encodeURIComponent(league)
    if (tab.parentId) {
      const data = await this.get<{ stash?: PoeStashTab }>('stash', `/stash/${l}/${tab.parentId}/${tab.id}`)
      const inner = data.stash?.children?.find((c) => c.id === tab.id) ?? data.stash
      return inner?.items ?? []
    }
    const data = await this.get<{ stash?: PoeStashTab }>('stash', `/stash/${l}/${tab.id}`)
    const stash = data.stash
    if (!stash) return []
    const items = [...(stash.items ?? [])]
    for (const child of stash.children ?? []) {
      if (child.items?.length) {
        items.push(...child.items)
        continue
      }
      if (!isStashId(child.id)) continue
      const sub = await this.get<{ stash?: PoeStashTab }>('stash', `/stash/${l}/${tab.id}/${child.id}`)
      const inner = sub.stash?.children?.find((c) => c.id === child.id)
      items.push(...(inner?.items ?? []))
    }
    return items
  }
}

/** Achata a lista: pastas viram suas abas internas; abas especiais com sub-abas continuam como uma só. */
export function flattenTabs(stashes: PoeStashTab[]): StashTabInfo[] {
  const out: StashTabInfo[] = []
  const sorted = [...stashes].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  for (const s of sorted) {
    const isFolder = s.type === 'Folder' || !!s.metadata?.folder
    if (isFolder) {
      for (const c of [...(s.children ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
        out.push({
          id: c.id,
          name: c.name,
          type: c.type,
          index: out.length,
          colour: c.metadata?.colour,
          parentId: s.id,
          parentName: s.name
        })
      }
      continue
    }
    out.push({ id: s.id, name: s.name, type: s.type, index: out.length, colour: s.metadata?.colour })
  }
  return out
}
