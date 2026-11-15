import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'

// OAuth 2.1 da GGG para clientes públicos (apps desktop):
// Authorization Code + PKCE (S256) com redirect para um endereço local (loopback).
// Docs: https://www.pathofexile.com/developer/docs/authorization

export const AUTHORIZE_URL = 'https://www.pathofexile.com/oauth/authorize'
export const TOKEN_URL = 'https://www.pathofexile.com/oauth/token'
export const SCOPES = ['account:profile', 'account:leagues', 'account:stashes']

/** O código de autorização da GGG expira em 30 s; o usuário tem 5 min para aprovar no navegador. */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

export interface TokenResponse {
  access_token: string
  expires_in: number | null
  token_type: string
  scope: string
  username: string
  sub: string
  refresh_token?: string
}

export interface OAuthConfig {
  clientId: string
  redirectUri: string
  userAgent: string
  openBrowser: (url: string) => Promise<void>
  fetchImpl?: typeof fetch
}

export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/** Aceita apenas http://127.0.0.1, http://localhost ou http://[::1] com porta explícita. */
export function parseLoopbackRedirect(uri: string): URL {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    throw new Error('Invalid Redirect URI.')
  }
  const hostOk = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'http:' || !hostOk || !url.port) {
    throw new Error('The Redirect URI must be local with a port, e.g. http://127.0.0.1:8080/callback')
  }
  return url
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

function page(title: string, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>body{font-family:system-ui,sans-serif;background:#16130f;color:#eae2d6;display:grid;place-items:center;height:100vh;margin:0}
main{max-width:420px;text-align:center}h1{font-size:20px;color:#d9a441}p{color:#b8ad9c}</style></head>
<body><main><h1>${title}</h1><p>${message}</p></main></body></html>`
}

export class LoginCancelled extends Error {
  constructor() {
    super('Sign-in cancelled.')
  }
}

/**
 * Executa o fluxo completo: abre o navegador do sistema na página de autorização da GGG,
 * recebe o código no servidor local e troca pelo token. O app nunca vê a senha do usuário.
 */
export class OAuthFlow {
  private server: Server | null = null
  private cancelFn: (() => void) | null = null

  cancel(): void {
    this.cancelFn?.()
  }

  async run(cfg: OAuthConfig): Promise<TokenResponse> {
    this.cancel()
    const redirect = parseLoopbackRedirect(cfg.redirectUri)
    const { verifier, challenge } = createPkce()
    const state = base64url(randomBytes(16))

    const code = await new Promise<string>((resolve, reject) => {
      let settled = false
      const finish = (err: Error | null, value?: string): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.cancelFn = null
        this.server?.close()
        this.server = null
        if (err) reject(err)
        else resolve(value!)
      }
      const timer = setTimeout(() => finish(new Error('Timed out waiting for sign-in in the browser.')), LOGIN_TIMEOUT_MS)
      this.cancelFn = () => finish(new LoginCancelled())

      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', redirect.origin)
        if (req.method !== 'GET' || url.pathname !== redirect.pathname) {
          res.writeHead(404).end()
          return
        }
        const gotState = url.searchParams.get('state') ?? ''
        const error = url.searchParams.get('error')
        const gotCode = url.searchParams.get('code')
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        if (!safeEqual(gotState, state)) {
          res.writeHead(400).end(page('Sign-in failed', 'Invalid state parameter. Please try again from the app.'))
          finish(new Error('Sign-in response had an invalid state (possible forged request).'))
          return
        }
        if (error || !gotCode) {
          const desc = url.searchParams.get('error_description') ?? error ?? 'no code'
          res.writeHead(400).end(page('Sign-in not authorized', 'You can close this tab and try again in the app.'))
          finish(new Error(`GGG declined the authorization: ${desc}`))
          return
        }
        res.writeHead(200).end(page('Signed in', 'You can close this tab and return to Stash Ledger.'))
        finish(null, gotCode)
      })
      this.server = server
      server.on('error', (err: NodeJS.ErrnoException) => {
        const msg =
          err.code === 'EADDRINUSE'
            ? `Port ${redirect.port} is already in use. Close the other program or register a different Redirect URI.`
            : `Could not start the local sign-in server: ${err.message}`
        finish(new Error(msg))
      })
      const host = redirect.hostname === '[::1]' ? '::1' : '127.0.0.1'
      server.listen(Number(redirect.port), host, () => {
        const auth = new URL(AUTHORIZE_URL)
        auth.searchParams.set('client_id', cfg.clientId)
        auth.searchParams.set('response_type', 'code')
        auth.searchParams.set('scope', SCOPES.join(' '))
        auth.searchParams.set('state', state)
        auth.searchParams.set('redirect_uri', cfg.redirectUri)
        auth.searchParams.set('code_challenge', challenge)
        auth.searchParams.set('code_challenge_method', 'S256')
        cfg.openBrowser(auth.toString()).catch((e: Error) => finish(e))
      })
    })

    return this.exchange(cfg, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: cfg.redirectUri,
      scope: SCOPES.join(' '),
      code_verifier: verifier
    })
  }

  async refresh(cfg: Omit<OAuthConfig, 'openBrowser' | 'redirectUri'>, refreshToken: string): Promise<TokenResponse> {
    return this.exchange(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken })
  }

  private async exchange(
    cfg: Pick<OAuthConfig, 'clientId' | 'userAgent' | 'fetchImpl'>,
    params: Record<string, string>
  ): Promise<TokenResponse> {
    const body = new URLSearchParams({ client_id: cfg.clientId, ...params })
    const res = await (cfg.fetchImpl ?? fetch)(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': cfg.userAgent,
        Accept: 'application/json'
      },
      body
    })
    const text = await res.text()
    let json: Record<string, unknown> = {}
    try {
      json = JSON.parse(text)
    } catch {
      /* resposta não-JSON */
    }
    if (!res.ok || typeof json.access_token !== 'string') {
      const desc = (json.error_description ?? json.error ?? `HTTP ${res.status}`) as string
      throw new Error(`Failed to get a token from GGG: ${desc}`)
    }
    return json as unknown as TokenResponse
  }
}
