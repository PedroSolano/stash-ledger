// Adapted from Awakened PoE Trade (MIT, see ../../LICENSE): renderer/src/assets/data/index.ts.
// Same exported API; instead of the fnv1a binary indexes generated at build time, the lookups are
// built in memory from the ndjson when the data is loaded (once per price check window).
import type { BaseType, DropEntry, Stat, StatOrGroup, StatMatcher, TranslationDict } from './interfaces'
import CLIENT_STRINGS_EN from './client_strings.en.js'

export * from './interfaces'

export let ITEM_DROP: DropEntry[] = []
export let CLIENT_STRINGS: TranslationDict = CLIENT_STRINGS_EN as unknown as TranslationDict
export let CLIENT_STRINGS_REF: TranslationDict = CLIENT_STRINGS_EN as unknown as TranslationDict
export let APP_PATRONS: Array<{ from: string; months: number; style: number }> = []

export let ITEM_BY_TRANSLATED: (ns: BaseType['namespace'], name: string) => BaseType[] | undefined = () => undefined
export let ITEM_BY_REF: (ns: BaseType['namespace'], name: string) => BaseType[] | undefined = () => undefined
export let ITEMS_ITERATOR: (includes: string, andIncludes?: string[]) => Generator<BaseType> = function* () {}

export let ALTQ_GEM_NAMES: () => Generator<string> = function* () {}
export let REPLICA_UNIQUE_NAMES: () => Generator<string> = function* () {}

export let STAT_BY_MATCH_STR: (name: string) => { matcher: StatMatcher; stat: Stat } | undefined = () => undefined
export let STAT_BY_MATCH_STR_V2: (name: string) => StatOrGroup | undefined = () => undefined
export let STAT_BY_REF_V2: (name: string) => StatOrGroup | undefined = () => undefined
export let STATS_ITERATOR: (includes: string, andIncludes?: string[]) => Generator<Stat> = function* () {}

function ndjsonFindLines<T>(ndjson: string) {
  // it's preferable that passed `searchString` has good entropy
  return function* (searchString: string, andIncludes: string[] = []): Generator<T> {
    let start = 0
    while (start !== ndjson.length) {
      const matchPos = ndjson.indexOf(searchString, start)
      if (matchPos === -1) break
      start = ndjson.lastIndexOf('\n', matchPos) + 1
      const end = ndjson.indexOf('\n', matchPos)
      const jsonLine = ndjson.slice(start, end === -1 ? undefined : end)
      if (andIncludes.every((str) => jsonLine.includes(str))) {
        yield JSON.parse(jsonLine) as T
      }
      if (end === -1) break
      start = end + 1
    }
  }
}

function itemNamesFromLines(items: Generator<BaseType>) {
  let cached: string[] | null = null
  return function* (): Generator<string> {
    if (!cached) cached = [...items].map((i) => i.name)
    yield* cached
  }
}

/** Offsets of every line of an ndjson string, calling `each` with the parsed record. */
function scanLines(ndjson: string, each: (record: unknown, start: number) => void): void {
  let start = 0
  while (start < ndjson.length) {
    let end = ndjson.indexOf('\n', start)
    if (end === -1) end = ndjson.length
    if (end > start) each(JSON.parse(ndjson.slice(start, end)), start)
    start = end + 1
  }
}

function lineAt<T>(ndjson: string, start: number): T {
  let end = ndjson.indexOf('\n', start)
  if (end === -1) end = ndjson.length
  // Parsed again on every lookup: callers mutate the result (trade id merging).
  return JSON.parse(ndjson.slice(start, end)) as T
}

export function loadItems(ndjson: string): void {
  const byName = new Map<string, number[]>()
  const byRef = new Map<string, number[]>()
  const push = (m: Map<string, number[]>, k: string, v: number) => {
    const list = m.get(k)
    if (list) list.push(v)
    else m.set(k, [v])
  }
  scanLines(ndjson, (r, start) => {
    const rec = r as BaseType
    push(byName, `${rec.namespace}::${rec.name}`, start)
    push(byRef, `${rec.namespace}::${rec.refName}`, start)
  })
  const find = (m: Map<string, number[]>) => (ns: BaseType['namespace'], name: string) => {
    const offsets = m.get(`${ns}::${name}`)
    return offsets ? offsets.map((o) => lineAt<BaseType>(ndjson, o)) : undefined
  }
  ITEM_BY_TRANSLATED = find(byName)
  ITEM_BY_REF = find(byRef)
  ITEMS_ITERATOR = ndjsonFindLines<BaseType>(ndjson)
  ALTQ_GEM_NAMES = itemNamesFromLines(ITEMS_ITERATOR('altQuality":["Anomalous'))
  REPLICA_UNIQUE_NAMES = itemNamesFromLines(ITEMS_ITERATOR('refName":"Replica'))
}

/**
 * Exile's Companion: texto de mod sem as dicas entre parênteses do formato avançado, em minúsculas.
 * "Raised Spectres (Animated Weapons-Holy Armaments) is Doubled" e o "Raised Spectres(...) is Doubled"
 * que o jogo copia quando abrevia viram ambos "raised spectres is doubled". Só some parêntese com
 * letras ou "..."; faixas de roll ("(12-16)") ficam.
 */
export function hintless(s: string): string {
  return s
    .replace(/\s*\((?:\.\.\.|…|[^()]*[A-Za-z][^()]*)\)/g, '')
    .replace(/[ \t]+/g, ' ')
    .toLowerCase()
}

const AMBIGUOUS = -1

export function loadStats(ndjson: string): void {
  const byRef = new Map<string, number>()
  const byMatcher = new Map<string, number>()
  // Stash Ledger: palavras-chave do jogo vêm com maiúscula no texto copiado ("deal damage 6% Faster")
  // e minúscula nos dados ("faster"); se a busca exata falhar, tenta sem diferenciar maiúsculas.
  const byMatcherLower = new Map<string, number>()
  // Último recurso: sem as dicas entre parênteses (ver `hintless`). Textos que viram o mesmo em
  // registros diferentes ficam marcados como ambíguos e nunca casam por aqui.
  const byMatcherHintless = new Map<string, number>()
  scanLines(ndjson, (r, start) => {
    const sg = r as StatOrGroup
    const stats = 'stats' in sg ? sg.stats : [sg]
    for (const s of stats) {
      if (!byRef.has(s.ref)) byRef.set(s.ref, start)
      for (const m of s.matchers) {
        for (const str of m.advanced ? [m.string, m.advanced] : [m.string]) {
          if (!byMatcher.has(str)) byMatcher.set(str, start)
          const lower = str.toLowerCase()
          if (!byMatcherLower.has(lower)) byMatcherLower.set(lower, start)
          const loose = hintless(str)
          const prev = byMatcherHintless.get(loose)
          if (prev === undefined) byMatcherHintless.set(loose, start)
          else if (prev !== start) byMatcherHintless.set(loose, AMBIGUOUS)
        }
      }
    }
  })

  STAT_BY_REF_V2 = function (ref: string) {
    const start = byRef.get(ref)
    return start === undefined ? undefined : lineAt<StatOrGroup>(ndjson, start)
  }

  /**
   * Registro recém-lido (cópia própria) achado por uma busca aproximada: os matchers equivalentes
   * passam a ter o texto exato do item, para o código adiante, que compara com igualdade exata,
   * reconhecê-lo.
   */
  function adoptText(start: number, matchStr: string, same: (s: string) => string): StatOrGroup {
    const sg = lineAt<StatOrGroup>(ndjson, start)
    const key = same(matchStr)
    for (const s of 'stats' in sg ? sg.stats : [sg]) {
      for (const m of s.matchers) {
        if (same(m.string) === key) m.string = matchStr
        if (m.advanced && same(m.advanced) === key) m.advanced = matchStr
      }
    }
    return sg
  }

  STAT_BY_MATCH_STR_V2 = function (matchStr: string) {
    const start = byMatcher.get(matchStr)
    if (start !== undefined) return lineAt<StatOrGroup>(ndjson, start)
    const lowerStart = byMatcherLower.get(matchStr.toLowerCase())
    if (lowerStart !== undefined) return adoptText(lowerStart, matchStr, (s) => s.toLowerCase())
    const looseStart = byMatcherHintless.get(hintless(matchStr))
    if (looseStart !== undefined && looseStart !== AMBIGUOUS) return adoptText(looseStart, matchStr, hintless)
    return undefined
  }

  STAT_BY_MATCH_STR = function (matchStr: string) {
    const statOrGroup = STAT_BY_MATCH_STR_V2(matchStr)
    if (!statOrGroup) return undefined
    let stat: Stat
    if ('stats' in statOrGroup) {
      const stats = statOrGroup.stats.filter((s) => s.matchers.some((m) => m.string === matchStr || m.advanced === matchStr))
      if (stats.length !== 1) return undefined
      stat = stats[0]
    } else {
      stat = statOrGroup
    }
    const matcher = stat.matchers.find((m) => m.string === matchStr || m.advanced === matchStr)!
    return { stat, matcher }
  }

  const _STATS_ITERATOR = ndjsonFindLines<StatOrGroup>(ndjson)
  STATS_ITERATOR = function* (includes, andIncludes) {
    for (const statOrGroup of _STATS_ITERATOR(includes, andIncludes)) {
      if ('stats' in statOrGroup) yield* statOrGroup.stats
      else yield statOrGroup
    }
  }
}

export function pseudoStatByRef(ref: string): Stat | undefined {
  const statOrGroup = STAT_BY_REF_V2(ref)
  if (statOrGroup != null && 'stats' in statOrGroup) {
    return statOrGroup.stats.find((s) => s.ref === ref && 'pseudo' in s.trade.ids)
  }
  return statOrGroup
}

/** Marks a stat text used in code (upstream validates them at startup). */
export function stat(text: string): string {
  return text
}

/** Loads the English data (the only language the app supports). */
export function init(data: { stats: string; items: string }): void {
  CLIENT_STRINGS = CLIENT_STRINGS_EN as unknown as TranslationDict
  CLIENT_STRINGS_REF = CLIENT_STRINGS
  ITEM_DROP = []
  APP_PATRONS = []
  loadItems(data.items)
  loadStats(data.stats)
}
