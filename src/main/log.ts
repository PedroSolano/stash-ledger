import { appendFile, rename, stat } from 'node:fs/promises'

// Log de erros em texto simples (userData/stash-ledger.log), para você ou um amigo poder mandar
// quando algo der errado. Nunca recebe cookies ou tokens: só mensagens, pilhas e dados de itens.

const MAX_BYTES = 1_000_000
let file: string | null = null
let queue: Promise<void> = Promise.resolve()

export function initLog(path: string): void {
  file = path
}

export function logPath(): string | null {
  return file
}

export function logError(context: string, err: unknown, extra?: Record<string, unknown>): void {
  const e = err instanceof Error ? err : new Error(String(err))
  console.error(`[${context}]`, e.message)
  if (!file) return
  const target = file
  const lines = [`${new Date().toISOString()} [${context}] ${e.message}`]
  if (e.stack) lines.push(e.stack.split('\n').slice(1, 6).join('\n'))
  if (extra) lines.push(`  ${JSON.stringify(extra).slice(0, 2000)}`)
  queue = queue
    .then(async () => {
      const s = await stat(target).catch(() => null)
      if (s && s.size > MAX_BYTES) await rename(target, `${target}.old`).catch(() => undefined)
      await appendFile(target, `${lines.join('\n')}\n`)
    })
    .catch(() => undefined)
}
