import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { base64url, createPkce, parseLoopbackRedirect } from '../src/main/auth/oauth'
import { RateLimiter } from '../src/main/poe/rateLimiter'
import { flattenTabs, isStashId } from '../src/main/poe/poeApi'
import { defaultSettings, sanitizeSettings } from '../src/main/store'

describe('PKCE', () => {
  it('gera verifier com entropia suficiente e challenge S256', () => {
    const { verifier, challenge } = createPkce()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(challenge).toBe(base64url(createHash('sha256').update(verifier).digest()))
    expect(createPkce().verifier).not.toBe(verifier)
  })
})

describe('Redirect URI', () => {
  it('aceita somente loopback http com porta', () => {
    expect(parseLoopbackRedirect('http://127.0.0.1:8080/callback').port).toBe('8080')
    expect(() => parseLoopbackRedirect('https://example.com/callback')).toThrow()
    expect(() => parseLoopbackRedirect('http://127.0.0.1/callback')).toThrow()
    expect(() => parseLoopbackRedirect('http://192.168.0.2:8080/callback')).toThrow()
  })
})

describe('RateLimiter', () => {
  const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null })

  it('espera antes de estourar a regra aprendida dos cabeçalhos', () => {
    let now = 1_000_000
    const rl = new RateLimiter(undefined, () => now)
    // 3 requisições por 10 s; a primeira resposta já informa o estado.
    rl.update('stash', headers({ 'x-rate-limit-policy': 'stash-request-limit', 'x-rate-limit-rules': 'Account', 'x-rate-limit-account': '3:10:60', 'x-rate-limit-account-state': '1:10:0' }), 200)
    expect(rl.delayFor('stash')).toBe(0)
    // registra uma segunda requisição: com margem de segurança (3-1), a terceira precisa esperar.
    ;(rl as unknown as { record(e: string): void }).record('stash')
    expect(rl.delayFor('stash')).toBeGreaterThan(9000)
    now += 10_500
    expect(rl.delayFor('stash')).toBe(0)
  })

  it('respeita Retry-After e restrição ativa', () => {
    const now = 5_000_000
    const rl = new RateLimiter(undefined, () => now)
    rl.update('x', headers({ 'x-rate-limit-policy': 'p', 'x-rate-limit-rules': 'Ip', 'x-rate-limit-ip': '10:5:60', 'x-rate-limit-ip-state': '11:5:60', 'retry-after': '60' }), 429)
    expect(rl.delayFor('x')).toBeGreaterThanOrEqual(60_000)
  })
})

describe('validação de entrada', () => {
  it('IDs de aba são hexadecimais de 10 caracteres', () => {
    expect(isStashId('a1b2c3d4e5')).toBe(true)
    expect(isStashId('../../etc')).toBe(false)
    expect(isStashId('a1b2c3d4e5/x')).toBe(false)
  })

  it('achata pastas mantendo o pai para a requisição', () => {
    const tabs = flattenTabs([
      { id: 'aaaaaaaaaa', name: 'Pasta', type: 'Folder', index: 1, children: [{ id: 'bbbbbbbbbb', name: 'Dentro', type: 'PremiumStash', index: 0 }] },
      { id: 'cccccccccc', name: 'Mapas', type: 'MapStash', index: 0, children: [{ id: 'dddddddddd', name: 'T16', type: 'MapStash' }] }
    ])
    expect(tabs.map((t) => t.name)).toEqual(['Mapas', 'Dentro'])
    expect(tabs[1].parentId).toBe('aaaaaaaaaa')
  })

  it('limpa configurações vindas da interface', () => {
    const cur = defaultSettings({})
    const next = sanitizeSettings(
      { clientId: 'my app<script>', contact: 'a@b.c)\r\nX-Evil: 1', ninjaBaseUrl: 'file:///etc/passwd', autoSnapshotMinutes: 1 },
      cur
    )
    expect(next.clientId).toBe('myappscript')
    expect(next.contact).not.toMatch(/[\r\n()]/)
    expect(next.ninjaBaseUrl).toBe('https://poe.ninja')
    expect(next.autoSnapshotMinutes).toBe(5)
  })
})
