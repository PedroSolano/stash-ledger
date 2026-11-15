import { describe, expect, it } from 'vitest'
import { niceTicks } from '../src/renderer/src/lib/scale'

describe('escala do gráfico', () => {
  it('sempre cobre o maior e o menor valor (caso do print: 1,85 a 2,3 div)', () => {
    const t = niceTicks(1.85, 2.3)
    expect(t[0]).toBeLessThanOrEqual(1.85)
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(2.3)
  })

  it('vale para várias faixas de valores', () => {
    for (const [min, max] of [
      [0.1, 0.7],
      [268, 312],
      [1.9, 1.9],
      [270.2, 285.6],
      [0.002, 0.009],
      [31981, 33074]
    ]) {
      const t = niceTicks(min, max)
      expect(t[0]).toBeLessThanOrEqual(min)
      expect(t[t.length - 1]).toBeGreaterThanOrEqual(max)
      expect(t.length).toBeLessThanOrEqual(8)
    }
  })
})
