// Só desenvolvimento: simula o backend Rust para a janela principal rodar no navegador com uma
// sessão e um snapshot de exemplo (http://127.0.0.1:5173/dev/app.html).
export {}

const now = Date.now()
const TABS = [
  { id: 'aaaaaaaaaa01', name: 'Currency', chaos: 21000, itemCount: 40, type: 'CurrencyStash' },
  { id: 'aaaaaaaaaa02', name: 'Dump', chaos: 9800, itemCount: 112, type: 'QuadStash' },
  { id: 'aaaaaaaaaa03', name: 'Uniques', chaos: 0, itemCount: 0, type: 'UniqueStash' },
  { id: 'aaaaaaaaaa04', name: 'Fragments', chaos: 3400, itemCount: 30, type: 'FragmentStash' }
]
const item = (name: string, typeLine: string, frameType: number, quantity: number, unitChaos: number, tab: string, extra = {}) => ({
  key: `${frameType}|${name}|${typeLine}`,
  name,
  typeLine,
  icon: '',
  frameType,
  quantity,
  unitChaos,
  totalChaos: unitChaos * quantity,
  counted: true,
  confidence: 'high',
  tabs: [tab],
  ...extra
})
const latest = {
  id: 's1',
  takenAt: now - 4 * 60_000,
  league: 'Keepers',
  totalChaos: 34200,
  divineChaos: 150,
  itemCount: 182,
  pricedCount: 160,
  tabs: TABS,
  pricesUpdatedAt: now - 12 * 60_000,
  items: [
    item('', 'Divine Orb', 5, 98, 150, 'Currency', { category: 'Currency' }),
    item('Headhunter', 'Leather Belt', 3, 1, 9000, 'Dump', { category: 'UniqueAccessory' }),
    item('', "The Maven's Writ", 0, 12, 67, 'Fragments', { category: 'Fragment' }),
    item('', 'Chaos Orb', 5, 1800, 1, 'Currency', { category: 'Currency' }),
    item('', 'Empower Support', 4, 1, 765, 'Dump', { category: 'SkillGem', detail: '4c' }),
    item('', 'The Nurse', 6, 2, 200, 'Dump', { category: 'DivinationCard' }),
    item('The Covenant', 'Spidersilk Robe', 3, 1, 990, 'Dump', { category: 'UniqueArmour', detail: '6L' }),
    item('', 'Stygian Vise', 2, 1, 333, 'Dump', { category: 'BaseType', detail: 'ilvl 86' })
  ]
}
const history = Array.from({ length: 40 }, (_, i) => ({
  id: `h${i}`,
  takenAt: now - (39 - i) * 36 * 60_000,
  league: 'Keepers',
  totalChaos: 26000 + i * 210 + Math.sin(i / 3) * 900,
  divineChaos: 150,
  itemCount: 170,
  pricedCount: 150,
  tabs: TABS
}))

const settings = {
  league: 'Keepers',
  selectedTabs: { 'session:Keepers': TABS.map((t) => t.id) },
  autoSnapshotMinutes: 5
}

;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
  transformCallback: () => 1,
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    switch (cmd) {
      case 'app_info':
        return { version: '0.6.2-dev', secureStorage: true }
      case 'auth_status':
        return { loggedIn: true, method: 'session', username: 'Exile#1234' }
      case 'ninja_leagues':
        return ['Keepers', 'Standard']
      case 'store_get':
        if (args.name === 'settings') return settings
        if (String(args.name).endsWith('-latest')) return latest
        if (String(args.name).endsWith('-history')) return history
        return null
      case 'plugin:event|listen':
        return 1
      case 'main_visibility':
        return { visible: true, overlay: false }
      default:
        return null
    }
  }
}
