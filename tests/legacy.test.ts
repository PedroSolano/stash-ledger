import { describe, expect, it } from 'vitest'
import {
  flattenLegacyTabs,
  LegacyApi,
  normalizeAccountName,
  normalizePoesessid,
  SessionInvalidError
} from '../src/main/poe/legacyApi'

const SESS = '0123456789abcdef0123456789abcdef'
const creds = { poesessid: SESS, accountName: 'Exile#1234' }

interface Call {
  url: URL
  headers: Record<string, string>
  redirect?: RequestInit['redirect']
}

function fakeFetch(respond: (url: URL) => Response, calls: Call[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url, headers: init?.headers as Record<string, string>, redirect: init?.redirect })
    return respond(url)
  }) as typeof fetch
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } })

describe('validação das credenciais', () => {
  it('POESESSID precisa ser hexadecimal de 32 caracteres', () => {
    expect(normalizePoesessid(` ${SESS.toUpperCase()} `)).toBe(SESS)
    expect(() => normalizePoesessid('abc')).toThrow()
    expect(() => normalizePoesessid(`${SESS}\r\nX-Evil: 1`)).toThrow()
  })
  it('nome da conta aceita o formato Nome#1234 e rejeita lixo', () => {
    expect(normalizeAccountName('  Exile#1234 ')).toBe('Exile#1234')
    expect(normalizeAccountName('Exile')).toBe('Exile')
    expect(() => normalizeAccountName('Exile#12')).toThrow()
    expect(() => normalizeAccountName('Ex\nile#1234')).toThrow()
    expect(() => normalizeAccountName('#1234')).toThrow()
  })
})

describe('lista de abas do endpoint antigo', () => {
  it('usa n/i/colour e entra nas pastas', () => {
    const tabs = flattenLegacyTabs([
      { n: 'Moedas', i: 1, id: 'aaaaaaaaaa', type: 'CurrencyStash', colour: { r: 217, g: 164, b: 65 } },
      { n: '1', i: 0, id: 'bbbbbbbbbb', type: 'PremiumStash' },
      { n: 'Pasta', i: 2, id: 'cccccccccc', type: 'Folder', children: [{ n: 'Venda', i: 3, id: 'dddddddddd', type: 'QuadStash' }] }
    ])
    expect(tabs.map((t) => [t.name, t.index])).toEqual([
      ['1', 0],
      ['Moedas', 1],
      ['Venda', 3]
    ])
    expect(tabs[1].colour).toBe('d9a441')
    expect(tabs[2].parentName).toBe('Pasta')
  })
})

describe('LegacyApi', () => {
  it('envia o cookie só para www.pathofexile.com, com os parâmetros certos e sem seguir redirecionamentos', async () => {
    const calls: Call[] = []
    const api = new LegacyApi(
      () => creds,
      () => 'StashLedger/0.1.0',
      undefined,
      fakeFetch(
        () =>
          json(
            { numTabs: 1, tabs: [{ n: 'A', i: 0, id: 'aaaaaaaaaa', type: 'PremiumStash' }], items: [{ typeLine: 'Chaos Orb' }] },
            200,
            {
              'x-rate-limit-policy': 'backend-item-request-limit',
              'x-rate-limit-rules': 'Ip',
              'x-rate-limit-ip': '30:60:120,90:1800:600',
              'x-rate-limit-ip-state': '1:60:0,1:1800:0'
            }
          ),
        calls
      )
    )
    const tabs = await api.listTabs('Covens')
    expect(tabs[0].name).toBe('A')
    const c = calls[0]
    expect(c.url.origin).toBe('https://www.pathofexile.com')
    expect(c.url.pathname).toBe('/character-window/get-stash-items')
    expect(c.url.searchParams.get('accountName')).toBe('Exile#1234')
    expect(c.url.searchParams.get('league')).toBe('Covens')
    expect(c.url.searchParams.get('tabs')).toBe('1')
    expect(c.headers.Cookie).toBe(`POESESSID=${SESS}`)
    expect(c.redirect).toBe('manual')
    // O cookie nunca vai na URL.
    expect(c.url.toString()).not.toContain(SESS)

    await api.tabItems('Covens', { id: 'aaaaaaaaaa', name: 'A', type: 'PremiumStash', index: 7 })
    expect(calls[1].url.searchParams.get('tabIndex')).toBe('7')
    expect(calls[1].url.searchParams.get('tabs')).toBe('0')
  })

  it('403 com HTML (sem sessão) vira SessionInvalidError', async () => {
    const api = new LegacyApi(
      () => creds,
      () => 'ua',
      undefined,
      fakeFetch(() => new Response('<!DOCTYPE html>', { status: 403, headers: { 'content-type': 'text/html' } }))
    )
    await expect(api.listTabs('Covens')).rejects.toBeInstanceOf(SessionInvalidError)
  })

  it('erro JSON "Forbidden" e redirecionamento para o login também', async () => {
    const forbidden = new LegacyApi(() => creds, () => 'ua', undefined, fakeFetch(() => json({ error: { code: 6, message: 'Forbidden' } }, 403)))
    await expect(forbidden.listTabs('Covens')).rejects.toBeInstanceOf(SessionInvalidError)
    const redirect = new LegacyApi(
      () => creds,
      () => 'ua',
      undefined,
      fakeFetch(() => new Response(null, { status: 302, headers: { location: '/login' } }))
    )
    await expect(redirect.listTabs('Covens')).rejects.toBeInstanceOf(SessionInvalidError)
  })

  it('stash inexistente na liga não é confundida com sessão inválida', async () => {
    const api = new LegacyApi(() => creds, () => 'ua', undefined, fakeFetch(() => json({ error: { code: 1, message: 'Resource not found' } }, 404)))
    await expect(api.listTabs('Covens')).rejects.toThrow(/não encontrada/)
  })

  it('sem credenciais não faz requisição nenhuma', async () => {
    const calls: Call[] = []
    const api = new LegacyApi(() => null, () => 'ua', undefined, fakeFetch(() => json({}), calls))
    await expect(api.listTabs('Covens')).rejects.toBeInstanceOf(SessionInvalidError)
    expect(calls).toHaveLength(0)
  })
})
