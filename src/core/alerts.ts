import type { DropAlert, DropAlertItem, SnapshotDetail } from '../shared/types'

const MAX_ITEMS = 5

/**
 * Itens caros que entraram na stash entre dois snapshots.
 *
 * - Só itens cujo preço unitário passa do limite (em chaos) e que entram no total (alta confiança).
 * - "Entrou" = grupo novo ou quantidade maior que no snapshot anterior (conta só o que aumentou).
 * - Itens de abas que não existiam no snapshot anterior são ignorados: começar a acompanhar uma
 *   aba nova não pode disparar a sirene para tudo que já estava lá.
 */
export function detectDrops(prev: SnapshotDetail | null, next: SnapshotDetail, thresholdChaos: number): DropAlertItem[] {
  if (!prev || prev.league !== next.league || !(thresholdChaos > 0)) return []
  const prevQty = new Map(prev.items.map((i) => [i.key, i.quantity]))
  const knownTabs = new Set(prev.tabs.map((t) => t.name))
  const out: DropAlertItem[] = []
  for (const item of next.items) {
    if (!item.counted || item.unitChaos < thresholdChaos) continue
    if (!item.tabs.every((t) => knownTabs.has(t))) continue
    const gained = item.quantity - (prevQty.get(item.key) ?? 0)
    if (gained <= 0) continue
    out.push({
      name: item.name,
      detail: item.detail,
      icon: item.icon,
      frameType: item.frameType,
      quantity: gained,
      unitChaos: item.unitChaos,
      totalChaos: item.unitChaos * gained
    })
  }
  return out.sort((a, b) => b.totalChaos - a.totalChaos).slice(0, MAX_ITEMS)
}

export function buildAlert(items: DropAlertItem[], divineChaos: number, sound: boolean): DropAlert {
  return { items, totalChaos: items.reduce((s, i) => s + i.totalChaos, 0), divineChaos, sound }
}
