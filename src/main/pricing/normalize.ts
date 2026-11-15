import type { PoeItem, PoeItemProperty, PoeSocket } from '../../shared/types'

// Itens reais das APIs da GGG nem sempre seguem o formato à risca: o endpoint antigo prefixa nomes
// com marcação (<<set:MS>><<set:M>><<set:S>>), textos podem trazer tags [Tag|Texto] e alguns campos
// chegam como número, objeto ou ausentes. Tudo passa por aqui antes da precificação.

/** Remove marcação do jogo: <<set:...>> e tags [Chave|Texto] / [Texto]. */
export function cleanText(s: string): string {
  return s
    .replace(/<<[^>]*>>/g, '')
    .replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2')
    .replace(/\[([^\]|]+)\]/g, '$1')
    .trim()
}

function str(x: unknown): string {
  if (typeof x === 'string') return cleanText(x)
  if (typeof x === 'number' && Number.isFinite(x)) return String(x)
  return ''
}

function num(x: unknown, fallback = 0): number {
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : NaN
  return Number.isFinite(n) ? n : fallback
}

function strList(x: unknown): string[] | undefined {
  if (!Array.isArray(x)) return undefined
  const out = x.map(str).filter(Boolean)
  return out.length ? out : undefined
}

function props(x: unknown): PoeItemProperty[] | undefined {
  if (!Array.isArray(x)) return undefined
  const out: PoeItemProperty[] = []
  for (const p of x) {
    if (!p || typeof p !== 'object') continue
    const raw = p as Record<string, unknown>
    const values: [string, number][] = []
    if (Array.isArray(raw.values)) {
      for (const v of raw.values) {
        if (Array.isArray(v)) values.push([str(v[0]), num(v[1])])
        else if (typeof v === 'string' || typeof v === 'number') values.push([str(v), 0])
      }
    }
    out.push({ name: str(raw.name), values })
  }
  return out.length ? out : undefined
}

function sockets(x: unknown): PoeSocket[] | undefined {
  if (!Array.isArray(x)) return undefined
  return x
    .filter((s) => s && typeof s === 'object')
    .map((s) => {
      const r = s as Record<string, unknown>
      return { group: num(r.group), attr: typeof r.attr === 'string' ? r.attr : undefined }
    })
}

/** Converte um item cru (de qualquer API da GGG) no formato estrito que o motor de preços espera. */
export function normalizeItem(raw: unknown): PoeItem {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const typeLine = str(r.typeLine)
  const influences =
    r.influences && typeof r.influences === 'object'
      ? Object.fromEntries(Object.entries(r.influences as Record<string, unknown>).map(([k, v]) => [k, v === true]))
      : undefined
  const item: PoeItem = {
    id: typeof r.id === 'string' ? r.id : undefined,
    name: str(r.name),
    typeLine,
    baseType: str(r.baseType) || typeLine,
    icon: typeof r.icon === 'string' && /^https:\/\//.test(r.icon) ? r.icon : '',
    frameType: num(r.frameType),
    ilvl: num(r.ilvl ?? r.itemLevel),
    identified: r.identified !== false,
    corrupted: r.corrupted === true,
    stackSize: r.stackSize === undefined ? undefined : Math.max(1, num(r.stackSize, 1)),
    properties: props(r.properties),
    additionalProperties: props(r.additionalProperties),
    sockets: sockets(r.sockets),
    influences,
    enchantMods: strList(r.enchantMods),
    implicitMods: strList(r.implicitMods),
    explicitMods: strList(r.explicitMods),
    craftedMods: strList(r.craftedMods),
    fracturedMods: strList(r.fracturedMods),
    mutatedMods: strList(r.mutatedMods),
    utilityMods: strList(r.utilityMods),
    descrText: str(r.descrText) || undefined,
    secDescrText: str(r.secDescrText) || undefined,
    mutated: r.mutated === true,
    replica: r.replica === true,
    isRelic: r.isRelic === true,
    note: typeof r.note === 'string' ? r.note : undefined
  }
  const socketed = Array.isArray(r.socketedItems) ? r.socketedItems.map(normalizeItem) : undefined
  if (socketed?.length) (item as PoeItem & { socketedItems?: PoeItem[] }).socketedItems = socketed
  return item
}
