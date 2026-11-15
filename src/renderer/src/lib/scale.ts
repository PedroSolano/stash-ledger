/** Escala "bonita" para o eixo Y (1, 2, 2.5, 5 × 10^n), sempre cobrindo do mínimo ao máximo. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1]
  if (min === max) {
    const d = Math.abs(min) * 0.05 || 1
    min -= d
    max += d
  }
  const raw = (max - min) / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  // Conta em passos inteiros (sem somar decimais): somar 0.2 várias vezes dá 2.4000000000000004,
  // e a escala parava antes do maior valor, fazendo a linha sair do painel.
  const first = Math.floor(min / step + 1e-9)
  const last = Math.ceil(max / step - 1e-9)
  const ticks: number[] = []
  for (let i = first; i <= Math.max(last, first + 1); i++) ticks.push(Number((i * step).toFixed(10)))
  return ticks
}
