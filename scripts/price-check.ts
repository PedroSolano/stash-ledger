// Verificação ao vivo: baixa (ou reaproveita do cache) todas as categorias do poe.ninja para uma liga
// e precifica a stash de demonstração. Uso: npm run price-check -- [liga]
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEMO_TABS, demoItems } from '../src/main/demo/fixtures'
import { NinjaClient } from '../src/main/ninja/ninjaClient'
import { DEFAULT_PRICING, valueItems } from '../src/main/pricing/priceItem'

async function main(): Promise<void> {
  const ninja = new NinjaClient({
    cacheDir: join(tmpdir(), 'stash-ledger-price-check'),
    baseUrl: () => 'https://poe.ninja',
    userAgent: () => 'StashLedger/0.1.0 (price-check)',
    onProgress: (d, t) => process.stdout.write(`\rpoe.ninja: ${d}/${t} categorias`)
  })
  const league = process.argv[2] ?? (await ninja.leagues())[0]
  const { index, status } = await ninja.get(league)
  console.log(`\nLiga: ${league} · ${index.size} preços · 1 div = ${index.divineChaos.toFixed(1)} c`)
  if (status.failed.length) console.log('Falharam:', status.failed.join(', '))

  const tabs = DEMO_TABS.map((t) => ({ tabId: t.id, tabName: t.name, items: demoItems(t.id, 1) }))
  const r = valueItems(tabs, index, { ...DEFAULT_PRICING, includeLowConfidence: false })
  for (const i of r.items) {
    const flags = [i.approximate ? '≈' : '', i.confidence === 'low' ? 'baixa' : '', i.counted ? '' : 'fora do total'].filter(Boolean).join(' ')
    console.log(
      `${(i.category ?? 'SEM PREÇO').padEnd(18)} ${String(i.quantity).padStart(5)} × ${i.unitChaos.toFixed(2).padStart(9)} c = ${i.totalChaos
        .toFixed(1)
        .padStart(10)} c  ${i.name}${i.detail ? ` [${i.detail}]` : ''} ${flags}`
    )
  }
  console.log(`\nTotal: ${r.totalChaos.toFixed(0)} c (${(r.totalChaos / index.divineChaos).toFixed(2)} div) · ${r.pricedCount}/${r.itemCount} itens com preço`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
