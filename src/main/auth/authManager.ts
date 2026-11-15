import type { AuthStatus } from '../../shared/types'
import { OAuthFlow, type TokenResponse } from './oauth'
import { SecureFile } from './secureFile'

interface StoredTokens {
  accessToken: string
  expiresAt: number
  refreshToken?: string
  username: string
  scope: string
}

/** Margem para renovar o token antes de expirar. */
const SKEW_MS = 2 * 60 * 1000

export class NotLoggedInError extends Error {
  constructor() {
    super('Sessão expirada. Faça login novamente.')
  }
}

export interface AuthConfigSource {
  clientId(): string
  redirectUri(): string
  userAgent(): string
  openBrowser(url: string): Promise<void>
}

/** Tokens OAuth: criptografados em disco (SecureFile) ou só na memória, se não houver criptografia. */
export class AuthManager {
  private tokens: StoredTokens | null = null
  private refreshing: Promise<void> | null = null
  private readonly store: SecureFile
  private readonly flow = new OAuthFlow()

  constructor(
    file: string,
    private readonly cfg: AuthConfigSource
  ) {
    this.store = new SecureFile(file)
  }

  get secureStorage(): boolean {
    return this.store.isAvailable
  }

  async load(): Promise<void> {
    const saved = await this.store.read()
    if (!saved) return
    try {
      const parsed = JSON.parse(saved.text) as StoredTokens
      // Sem refresh token e com acesso vencido não há o que aproveitar.
      if (parsed.expiresAt > Date.now() || parsed.refreshToken) {
        this.tokens = parsed
        if (saved.reencrypt) await this.persist()
      }
    } catch {
      this.tokens = null
    }
  }

  private async persist(): Promise<void> {
    if (this.tokens) await this.store.write(JSON.stringify(this.tokens))
  }

  status(): AuthStatus {
    if (!this.tokens) return { loggedIn: false }
    return {
      loggedIn: true,
      method: 'oauth',
      username: this.tokens.username,
      expiresAt: this.tokens.expiresAt,
      refreshable: !!this.tokens.refreshToken
    }
  }

  async login(): Promise<AuthStatus> {
    const clientId = this.cfg.clientId()
    if (!clientId) throw new Error('Configure o Client ID do seu app GGG nas configurações antes de entrar.')
    const res = await this.flow.run({
      clientId,
      redirectUri: this.cfg.redirectUri(),
      userAgent: this.cfg.userAgent(),
      openBrowser: (url) => this.cfg.openBrowser(url)
    })
    await this.accept(res)
    return this.status()
  }

  cancelLogin(): void {
    this.flow.cancel()
  }

  async logout(): Promise<void> {
    this.tokens = null
    await this.store.remove()
  }

  /** Token de acesso válido, renovando com o refresh token quando necessário. */
  async accessToken(): Promise<string> {
    if (!this.tokens) throw new NotLoggedInError()
    if (this.tokens.expiresAt - SKEW_MS > Date.now()) return this.tokens.accessToken
    await this.refresh()
    return this.tokens!.accessToken
  }

  /** Chamado após um 401: tenta renovar uma única vez. */
  async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing
    this.refreshing = (async () => {
      const rt = this.tokens?.refreshToken
      if (!rt) {
        await this.logout()
        throw new NotLoggedInError()
      }
      try {
        const res = await this.flow.refresh({ clientId: this.cfg.clientId(), userAgent: this.cfg.userAgent() }, rt)
        await this.accept(res)
      } catch {
        await this.logout()
        throw new NotLoggedInError()
      }
    })().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  private async accept(res: TokenResponse): Promise<void> {
    // Clientes públicos recebem tokens de acesso de 10 h; null significa "sem expiração".
    const ttl = (res.expires_in ?? 10 * 3600) * 1000
    this.tokens = {
      accessToken: res.access_token,
      expiresAt: Date.now() + ttl,
      refreshToken: res.refresh_token,
      username: res.username,
      scope: res.scope
    }
    await this.persist()
  }
}
