import type { PoeItem, StashTabInfo } from '../../shared/types'
import { RateLimiter } from './rateLimiter'
import type { StashSource } from './poeApi'

// Modo sessão: endpoint antigo do site (o mesmo que o Exilence original e o Acquisition usavam),
// autenticado com o cookie POESESSID. NÃO faz parte da API documentada da GGG: pode mudar ou ser
// bloqueado sem aviso. Os limites (política "backend-item-request-limit") são lidos dos cabeçalhos.

const ENDPOINT = 'https://www.pathofexile.com/character-window/get-stash-items'

/** O POESESSID é um hexadecimal de 32 caracteres; validar evita injeção de cabeçalho e erros de cópia. */
export const POESESSID_RE = /^[0-9a-f]{32}$/i

export interface LegacyCreds {
  poesessid: string
  accountName: string
}

export class SessionInvalidError extends Error {
  constructor() {
    super(
      'GGG rejected the session. Check your POESESSID (it expires when you sign out of the website) and your account name including the #1234.'
    )
  }
}

/** Nome de conta do PoE, com o discriminador (#1234). Rejeita espaços nas pontas e caracteres de controle. */
export function normalizeAccountName(raw: string): string {
  const v = String(raw ?? '').trim()
  if (!/^[^\s#\p{Cc}][^#\p{Cc}]{1,40}(#\d{4})?$/u.test(v)) {
    throw new Error('Invalid account name. Use the format shown on the website, e.g. YourName#1234.')
  }
  return v
}

export function normalizePoesessid(raw: string): string {
  const v = String(raw ?? '').trim()
  if (!POESESSID_RE.test(v)) throw new Error('Invalid POESESSID: it must be 32 hexadecimal characters.')
  return v.toLowerCase()
}

interface LegacyTab {
  n: string
  i: number
  id: string
  type: string
  colour?: { r: number; g: number; b: number }
  hidden?: boolean
  children?: LegacyTab[]
}

interface LegacyResponse {
  numTabs?: number
  tabs?: LegacyTab[]
  items?: PoeItem[]
  error?: { code?: number; message?: string }
}

function hex(c?: { r: number; g: number; b: number }): string | undefined {
  if (!c) return undefined
  const h = (n: number): string => Math.max(0, Math.min(255, Math.round(n || 0))).toString(16).padStart(2, '0')
  return `${h(c.r)}${h(c.g)}${h(c.b)}`
}

/** Converte a lista de abas do endpoint antigo; o `index` aqui é o tabIndex usado nas requisições. */
export function flattenLegacyTabs(tabs: LegacyTab[]): StashTabInfo[] {
  const out: StashTabInfo[] = []
  for (const t of [...tabs].sort((a, b) => a.i - b.i)) {
    if (t.children?.length) {
      for (const c of t.children) {
        out.push({ id: c.id, name: c.n, type: c.type, index: c.i, colour: hex(c.colour), parentId: t.id, parentName: t.n })
      }
      continue
    }
    if (t.type === 'Folder') continue
    out.push({ id: t.id, name: t.n, type: t.type, index: t.i, colour: hex(t.colour) })
  }
  return out
}

export class LegacyApi implements StashSource {
  readonly limiter: RateLimiter

  constructor(
    private readonly creds: () => LegacyCreds | null,
    private readonly userAgent: () => string,
    onWait?: (ms: number) => void,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.limiter = new RateLimiter(onWait)
  }

  /** Uma requisição ao endpoint. `override` serve para validar credenciais antes de guardá-las. */
  async request(league: string, tabIndex: number, withTabs: boolean, override?: LegacyCreds, attempt = 0): Promise<LegacyResponse> {
    const creds = override ?? this.creds()
    if (!creds) throw new SessionInvalidError()
    if (!Number.isInteger(tabIndex) || tabIndex < 0 || tabIndex > 10000) throw new Error('Invalid tab index.')
    const url = new URL(ENDPOINT)
    url.searchParams.set('league', league)
    url.searchParams.set('realm', 'pc')
    url.searchParams.set('accountName', creds.accountName)
    url.searchParams.set('tabs', withTabs ? '1' : '0')
    url.searchParams.set('tabIndex', String(tabIndex))

    const res = await this.limiter.schedule('legacy-stash', async () => {
      const r = await this.fetchImpl(url, {
        headers: {
          Cookie: `POESESSID=${normalizePoesessid(creds.poesessid)}`,
          'User-Agent': this.userAgent(),
          Accept: 'application/json'
        },
        redirect: 'manual'
      })
      this.limiter.update('legacy-stash', r.headers, r.status)
      return r
    })

    if (res.status === 429 && attempt === 0) return this.request(league, tabIndex, withTabs, override, attempt + 1)
    // Sem sessão o site responde 403 com HTML (ou redireciona para o login).
    if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) throw new SessionInvalidError()
    const isJson = (res.headers.get('content-type') ?? '').includes('json')
    if (!isJson) {
      if (res.ok) throw new SessionInvalidError()
      throw new Error(`The GGG website responded with HTTP ${res.status}.`)
    }
    const body = (await res.json()) as LegacyResponse
    if (body.error) {
      if (body.error.code === 6 || body.error.code === 8) throw new SessionInvalidError()
      if (body.error.code === 1) throw new Error(`Stash not found in league ${league}.`)
      throw new Error(`GGG website: ${body.error.message ?? `error ${body.error.code}`}`)
    }
    if (!res.ok) throw new Error(`The GGG website responded with HTTP ${res.status}.`)
    return body
  }

  /** O endpoint antigo não lista ligas; o controller usa as ligas do poe.ninja. */
  async leagues(): Promise<string[]> {
    return []
  }

  async listTabs(league: string): Promise<StashTabInfo[]> {
    const r = await this.request(league, 0, true)
    return flattenLegacyTabs(r.tabs ?? [])
  }

  async tabItems(league: string, tab: StashTabInfo): Promise<PoeItem[]> {
    const r = await this.request(league, tab.index, false)
    return r.items ?? []
  }
}
