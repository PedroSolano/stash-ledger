import '@fontsource/cinzel/latin-700.css'
import '@fontsource/alegreya-sc/latin-500.css'
import '@fontsource/alegreya-sans/latin-400.css'
import '@fontsource/alegreya-sans/latin-500.css'
import './pricecheck.css'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { createRoot } from 'react-dom/client'
import type { PriceCheckPayload } from '../../../shared/types'
import { loadTradeData, setTradeTransport } from '../../../trade'
import { PriceCheck } from './PriceCheck'

// Rede da trade: pelo backend (limites de requisição e sem cookies).
setTradeTransport({
  search: (league, body) => invoke('trade_search', { league, body }),
  fetch: (ids, query) => invoke('trade_fetch', { ids, query }),
  exchange: (league, body) => invoke('trade_exchange', { league, body })
})

// Dados de mods e bases (do Awakened), carregados uma vez por janela.
const dataReady: Promise<void> = Promise.all([
  fetch('/trade-data/stats.ndjson').then((r) => r.text()),
  fetch('/trade-data/items.ndjson').then((r) => r.text())
]).then(([stats, items]) => loadTradeData({ stats, items }))

let render: ((p: PriceCheckPayload) => void) | null = null
let queued: PriceCheckPayload | null = null

function App() {
  return (
    <PriceCheck
      dataReady={dataReady}
      register={(fn) => {
        render = fn
        if (queued) {
          fn(queued)
          queued = null
        }
      }}
    />
  )
}

createRoot(document.getElementById('root')!).render(<App />)

function show(p: PriceCheckPayload): void {
  if (render) render(p)
  else queued = p
}

void listen<PriceCheckPayload>('price', (e) => show(e.payload))
void invoke<PriceCheckPayload | null>('pricecheck_ready').then((p) => {
  if (p) show(p)
})
