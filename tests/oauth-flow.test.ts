import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { base64url, OAuthFlow, TOKEN_URL } from '../src/main/auth/oauth'

// Simula o navegador (que é redirecionado para o servidor local) e o endpoint de token da GGG.
function fakeToken(captured: { body?: URLSearchParams; url?: string; ua?: string }): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    captured.url = String(url)
    captured.body = init?.body as URLSearchParams
    captured.ua = (init?.headers as Record<string, string>)['User-Agent']
    return new Response(
      JSON.stringify({ access_token: 'tok', expires_in: 36000, token_type: 'bearer', scope: 'account:stashes', username: 'Exile', sub: 'x', refresh_token: 'rt' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }) as typeof fetch
}

const port = () => 40000 + Math.floor(Math.random() * 20000)

describe('OAuthFlow (fluxo completo simulado)', () => {
  it('abre a autorização com PKCE S256, valida o state e troca o código', async () => {
    const redirectUri = `http://127.0.0.1:${port()}/callback`
    const captured: { body?: URLSearchParams; url?: string; ua?: string } = {}
    let authUrl: URL | undefined
    const flow = new OAuthFlow()
    const res = await flow.run({
      clientId: 'stashledger',
      redirectUri,
      userAgent: 'OAuth stashledger/0.1.0 (contact: test) StashLedger',
      fetchImpl: fakeToken(captured),
      openBrowser: async (url) => {
        authUrl = new URL(url)
        const state = authUrl.searchParams.get('state')!
        // "Usuário aprovou": a GGG redireciona para o servidor local.
        setTimeout(() => void fetch(`${redirectUri}?code=abc123&state=${state}`), 10)
      }
    })
    expect(res.access_token).toBe('tok')
    expect(authUrl!.origin + authUrl!.pathname).toBe('https://www.pathofexile.com/oauth/authorize')
    expect(authUrl!.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authUrl!.searchParams.get('scope')).toBe('account:profile account:leagues account:stashes')
    expect(captured.url).toBe(TOKEN_URL)
    expect(captured.body!.get('code')).toBe('abc123')
    expect(captured.body!.get('grant_type')).toBe('authorization_code')
    expect(captured.body!.get('client_secret')).toBeNull()
    const verifier = captured.body!.get('code_verifier')!
    expect(base64url(createHash('sha256').update(verifier).digest())).toBe(authUrl!.searchParams.get('code_challenge'))
    expect(captured.ua).toMatch(/^OAuth stashledger\/0\.1\.0 \(contact: /)
  })

  it('rejeita um redirecionamento com state diferente (CSRF)', async () => {
    const redirectUri = `http://127.0.0.1:${port()}/callback`
    const flow = new OAuthFlow()
    await expect(
      flow.run({
        clientId: 'x',
        redirectUri,
        userAgent: 'ua',
        fetchImpl: fakeToken({}),
        openBrowser: async () => {
          setTimeout(() => void fetch(`${redirectUri}?code=evil&state=forjado`).catch(() => undefined), 10)
        }
      })
    ).rejects.toThrow(/invalid state/)
  })

  it('pode ser cancelado pelo usuário', async () => {
    const flow = new OAuthFlow()
    const p = flow.run({
      clientId: 'x',
      redirectUri: `http://127.0.0.1:${port()}/callback`,
      userAgent: 'ua',
      fetchImpl: fakeToken({}),
      openBrowser: async () => {
        setTimeout(() => flow.cancel(), 10)
      }
    })
    await expect(p).rejects.toThrow(/cancelled/)
  })
})
