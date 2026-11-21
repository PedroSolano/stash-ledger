import { describe, expect, it, vi } from 'vitest'
import { Controller, type NinjaStatus, type Platform } from '../src/core/controller'
import type { CompactPrices } from '../src/core/pricing/ninja'

const DIVINE_TEXT = ['Item Class: Stackable Currency', 'Rarity: Currency', 'Divine Orb', '--------', 'Stack Size: 2/20'].join('\n')

const prices = (div: number): CompactPrices => ({ exchange_Currency: { k: 'e', div, l: [['Divine Orb', div, '', 1e6]] } })

/** Plataforma falsa: cache local velho (2 dias) e uma rede que só responde quando o teste mandar. */
function fakePlatform(opts: { hasCache: boolean }) {
  let cats: CompactPrices | null = opts.hasCache ? prices(200) : null
  let updatedAt: number | null = opts.hasCache ? Date.now() - 2 * 86_400_000 : null
  let finishRefresh: () => void = () => undefined
  const refresh = vi.fn(
    () =>
      new Promise<NinjaStatus>((resolve) => {
        finishRefresh = () => {
          cats = prices(250)
          updatedAt = Date.now()
          resolve({ updatedAt, categories: 1, failed: [] })
        }
      })
  )
  const p = {
    appInfo: async () => ({ version: 'test', secureStorage: true }),
    storeGet: async <T,>(name: string) => (name === 'settings' ? ({ league: 'Covens' } as T) : null),
    storeSet: async () => undefined,
    configure: async () => undefined,
    configureHotkeys: async () => undefined,
    authStatus: async () => ({ loggedIn: false }),
    ninjaStatus: async () => ({ updatedAt, categories: cats ? 1 : 0, failed: [] }),
    ninjaRefresh: refresh,
    ninjaPrices: async () => cats,
    logError: async () => undefined
  } as unknown as Platform
  return { p, refresh, finish: () => finishRefresh() }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('price check sem esperar a rede', () => {
  it('responde na hora com o cache velho e troca o índice quando a atualização chega', async () => {
    const f = fakePlatform({ hasCache: true })
    const c = new Controller(f.p, { progress: () => undefined, snapshot: () => undefined })
    await c.init()
    const first = await c.priceCheck(DIVINE_TEXT)
    expect(first.unitChaos).toBe(200)
    // A atualização foi pedida em segundo plano, mas o atalho não esperou por ela.
    expect(f.refresh).toHaveBeenCalledTimes(1)
    f.finish()
    await tick()
    await tick()
    expect((await c.priceCheck(DIVINE_TEXT)).unitChaos).toBe(250)
    expect(f.refresh).toHaveBeenCalledTimes(1)
  })

  it('sem cache nenhum, espera a rede (não há o que mostrar)', async () => {
    const f = fakePlatform({ hasCache: false })
    const c = new Controller(f.p, { progress: () => undefined, snapshot: () => undefined })
    await c.init()
    const pending = c.priceCheck(DIVINE_TEXT)
    await tick()
    f.finish()
    expect((await pending).unitChaos).toBe(250)
  })

  it('aquece o índice ao abrir quando o price check está ligado', async () => {
    const f = fakePlatform({ hasCache: true })
    const c = new Controller(f.p, { progress: () => undefined, snapshot: () => undefined })
    await c.init()
    expect(c.warmPriceCheck()).toBe(true)
    await tick()
    await tick()
    expect(f.refresh).toHaveBeenCalledTimes(1)
  })
})
