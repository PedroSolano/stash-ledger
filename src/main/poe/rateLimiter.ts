// Limitador baseado nos cabeçalhos X-Rate-Limit-* da GGG.
// Os limites são dinâmicos, então nada é fixo no código: o app aprende a política na primeira
// resposta e, a partir daí, espera antes de estourar qualquer regra (ip/account/client).
// Docs: https://www.pathofexile.com/developer/docs#ratelimits

interface Rule {
  hits: number
  periodMs: number
}

interface PolicyState {
  rules: Rule[]
  log: number[]
  blockedUntil: number
}

export interface HeaderSource {
  get(name: string): string | null
}

export function parseRules(value: string | null): { hits: number; period: number; timeout: number }[] {
  if (!value) return []
  return value
    .split(',')
    .map((part) => part.trim().split(':').map(Number))
    .filter((p) => p.length === 3 && p.every((n) => Number.isFinite(n)))
    .map(([hits, period, timeout]) => ({ hits, period, timeout }))
}

export class RateLimiter {
  private policies = new Map<string, PolicyState>()
  private endpointPolicy = new Map<string, string>()
  private chain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly onWait?: (ms: number) => void,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
  ) {}

  /** Executa as requisições em fila (uma por vez), aguardando o necessário antes de cada uma. */
  schedule<T>(endpoint: string, fn: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const wait = this.delayFor(endpoint)
      if (wait > 0) {
        this.onWait?.(wait)
        await this.sleep(wait)
      }
      this.record(endpoint)
      return fn()
    }
    const next = this.chain.then(run, run)
    this.chain = next.catch(() => undefined)
    return next
  }

  /** Quanto esperar (ms) antes da próxima requisição nesse endpoint. */
  delayFor(endpoint: string): number {
    const policy = this.policies.get(this.endpointPolicy.get(endpoint) ?? '')
    if (!policy) return 0
    const now = this.now()
    let wait = Math.max(0, policy.blockedUntil - now)
    for (const rule of policy.rules) {
      // Margem de segurança: nunca usa a última "vaga" da janela.
      const allowed = Math.max(1, rule.hits - 1)
      const inWindow = policy.log.filter((t) => now - t < rule.periodMs)
      if (inWindow.length >= allowed) {
        const oldest = inWindow[inWindow.length - allowed]
        wait = Math.max(wait, oldest + rule.periodMs - now + 250)
      }
    }
    return wait
  }

  private record(endpoint: string): void {
    const policy = this.policies.get(this.endpointPolicy.get(endpoint) ?? '')
    if (!policy) return
    const now = this.now()
    policy.log.push(now)
    const maxPeriod = Math.max(0, ...policy.rules.map((r) => r.periodMs))
    policy.log = policy.log.filter((t) => now - t < maxPeriod)
  }

  /** Atualiza o estado com os cabeçalhos da resposta. */
  update(endpoint: string, headers: HeaderSource, status: number): void {
    const name = headers.get('x-rate-limit-policy')
    if (!name) return
    const firstSeen = !this.policies.has(name)
    this.endpointPolicy.set(endpoint, name)
    const policy = this.policies.get(name) ?? { rules: [], log: [], blockedUntil: 0 }
    const now = this.now()
    const rules: Rule[] = []
    for (const ruleName of (headers.get('x-rate-limit-rules') ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
      const limits = parseRules(headers.get(`x-rate-limit-${ruleName}`))
      const states = parseRules(headers.get(`x-rate-limit-${ruleName}-state`))
      limits.forEach((limit, i) => {
        rules.push({ hits: limit.hits, periodMs: limit.period * 1000 })
        const state = states[i]
        if (!state) return
        // state = hits atuais : período : restrição ativa (s)
        if (state.timeout > 0) policy.blockedUntil = Math.max(policy.blockedUntil, now + state.timeout * 1000)
        else if (state.hits >= limit.hits) policy.blockedUntil = Math.max(policy.blockedUntil, now + limit.period * 1000)
      })
    }
    if (rules.length) policy.rules = rules
    if (firstSeen) policy.log.push(now) // a requisição que trouxe a política também conta
    const retryAfter = Number(headers.get('retry-after'))
    if (status === 429 && retryAfter > 0) policy.blockedUntil = Math.max(policy.blockedUntil, now + retryAfter * 1000)
    this.policies.set(name, policy)
  }
}
