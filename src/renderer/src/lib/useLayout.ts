import { useEffect, useState } from 'react'

export type Layout = 'compact' | 'normal' | 'wide' | 'ultrawide'
export type LayoutPref = 'auto' | Layout

export const LAYOUT_LABEL: Record<Layout, string> = {
  compact: 'Compact',
  normal: 'Normal',
  wide: 'Wide',
  ultrawide: 'Ultrawide'
}

/**
 * Escolhe o layout pelo tamanho da janela em pixels CSS (já considerando a escala do Windows)
 * e pela proporção: janelas 21:9 / 32:9 ganham três colunas mesmo com escala de 125–150%.
 */
export function layoutFor(width: number, height: number): Layout {
  const ratio = width / Math.max(1, height)
  if (width < 1100) return 'compact'
  if (width >= 3000 || (width >= 2200 && ratio >= 2.05)) return 'ultrawide'
  if (width >= 1700) return 'wide'
  return 'normal'
}

const KEY = 'stash-ledger:layout'

function readPref(): LayoutPref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'compact' || v === 'normal' || v === 'wide' || v === 'ultrawide' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

/** Layout atual (detectado ou escolhido) e a preferência salva neste computador. */
export function useLayout(): { layout: Layout; detected: Layout; pref: LayoutPref; setPref: (p: LayoutPref) => void } {
  const [detected, setDetected] = useState<Layout>(() => layoutFor(window.innerWidth, window.innerHeight))
  const [pref, setPrefState] = useState<LayoutPref>(readPref)

  useEffect(() => {
    let frame = 0
    const onResize = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setDetected(layoutFor(window.innerWidth, window.innerHeight)))
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  const setPref = (p: LayoutPref): void => {
    setPrefState(p)
    try {
      if (p === 'auto') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, p)
    } catch {
      /* armazenamento indisponível: vale só nesta sessão */
    }
  }

  return { layout: pref === 'auto' ? detected : pref, detected, pref, setPref }
}
