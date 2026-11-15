import type { PoeItem, StashTabInfo } from '../../shared/types'

// Stash de demonstração no mesmo formato da API oficial da GGG.
// Serve para testar a precificação com preços reais do poe.ninja sem precisar entrar na conta.
// O cache de preços não guarda ícones de itens (itens reais da GGG já vêm com o ícone), então os
// itens da demo trazem os seus. Moedas e fragmentos usam os ícones do câmbio do poe.ninja.

const CDN = 'https://web.poecdn.com/gen/image/'
const ICON = {
  card: 'https://web.poecdn.com/image/Art/2DItems/Divination/InventoryIcon.png',
  mageblood: `${CDN}WzI1LDE0LHsiZiI6IjJESXRlbXMvQmVsdHMvSW5qZWN0b3JCZWx0IiwidyI6MiwiaCI6MSwic2NhbGUiOjF9XQ/21ec0269de/InjectorBelt.png`,
  covenant: `${CDN}WzI1LDE0LHsiZiI6IjJESXRlbXMvQXJtb3Vycy9Cb2R5QXJtb3Vycy9FbWJyYWNlIiwidyI6MiwiaCI6Mywic2NhbGUiOjF9XQ/d0110e7660/Embrace.png`,
  kaom: `${CDN}WzI1LDE0LHsiZiI6IjJESXRlbXMvQXJtb3Vycy9Cb2R5QXJtb3Vycy9Cb2R5U3RyM0NVbmlxdWUiLCJ3IjoyLCJoIjozLCJzY2FsZSI6MX1d/1027cdf1ad/BodyStr3CUnique.png`,
  vise: `${CDN}WzI1LDE0LHsiZiI6IjJESXRlbXMvQmVsdHMvQWJ5c3NCZWx0IiwidyI6MiwiaCI6MSwic2NhbGUiOjF9XQ/973fb5fe7a/AbyssBelt.png`,
  crown: `${CDN}WzI1LDE0LHsiZiI6IjJESXRlbXMvQXJtb3Vycy9IZWxtZXRzL01hc2tDcm93biIsInciOjIsImgiOjIsInNjYWxlIjoxfV0/dbad72643e/MaskCrown.png`,
  cluster: `${CDN}WzI1LDE0LHsiZiI6IjJESXRlbXMvSmV3ZWxzL05ld0dlbUJhc2UzIiwidyI6MSwiaCI6MSwic2NhbGUiOjF9XQ/db35e60885/NewGemBase3.png`,
  enlighten: `${CDN}WzI1LDE0LHsiZiI6IjJESXRlbXMvR2Vtcy9TdXBwb3J0L0VubGlnaHRlbiIsInciOjEsImgiOjEsInNjYWxlIjoxfV0/05a949e270/Enlighten.png`,
  empower: `${CDN}WzI1LDE0LHsiZiI6IjJESXRlbXMvR2Vtcy9TdXBwb3J0L0VtcG93ZXIiLCJ3IjoxLCJoIjoxLCJzY2FsZSI6MX1d/c2b1b38b15/Empower.png`,
  arc: `${CDN}WzMwLDE0LHsiZiI6IjJESXRlbXMvR2Vtcy9BcmMiLCJ3IjoxLCJoIjoxLCJzY2FsZSI6MX1d/b906e66011/Arc.png`,
  cleave: `${CDN}WzMwLDE0LHsiZiI6IjJESXRlbXMvR2Vtcy9DbGVhdmUiLCJ3IjoxLCJoIjoxLCJzY2FsZSI6MSwiZ2QiOjV9XQ/48d223a640/Cleave.png`,
  map: `${CDN}WzI4LDE0LHsiZiI6IjJESXRlbXMvTWFwcy9BdGxhczJNYXBzL05ldy9NYXBOdW1iZXJzMTYiLCJ3IjoxLCJoIjoxLCJzY2FsZSI6MSwibW4iOjI0LCJtdCI6MH1d/b4b8302406/MapNumbers16.png`,
  blighted: `${CDN}WzI4LDE0LHsiZiI6IjJESXRlbXMvTWFwcy9BdGxhczJNYXBzL05ldy9NYXBOdW1iZXJzMTYiLCJ3IjoxLCJoIjoxLCJzY2FsZSI6MSwibW4iOjI0LCJtdCI6MCwibWIiOnRydWV9XQ/d53d25cf47/MapNumbers16.png`,
  temple: `${CDN}WzI1LDE0LHsiZiI6IjJESXRlbXMvTWFwcy9UZW1wbGVNYXAiLCJ3IjoxLCJoIjoxLCJzY2FsZSI6MX1d/9be10cc6b3/TempleMap.png`,
  beast: `${CDN}WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQmVzdGlhcnlPcmJGdWxsIiwidyI6MSwiaCI6MSwic2NhbGUiOjF9XQ/3214b44360/BestiaryOrbFull.png`,
  wombgift: `${CDN}WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQ2hheXVsYS9CcmVhY2hGcnVpdDMiLCJ3IjoxLCJoIjoxLCJzY2FsZSI6MX1d/498811f501/BreachFruit3.png`
}

function currency(typeLine: string, stackSize: number, frameType = 5): PoeItem {
  const icon = frameType === 6 ? ICON.card : ''
  return { typeLine, baseType: typeLine, name: '', icon, frameType, ilvl: 0, identified: true, stackSize }
}

function gem(typeLine: string, icon: string, level: number, quality: number, corrupted = false): PoeItem {
  const properties = [{ name: 'Level', values: [[`${level}`, 0]] as [string, number][] }]
  if (quality) properties.push({ name: 'Quality', values: [[`+${quality}%`, 1]] })
  return { typeLine, baseType: typeLine, name: '', icon, frameType: 4, ilvl: 0, identified: true, corrupted, properties }
}

function sockets(groups: number[]): PoeItem['sockets'] {
  const out: NonNullable<PoeItem['sockets']> = []
  groups.forEach((size, g) => {
    for (let i = 0; i < size; i++) out.push({ group: g, attr: 'S', sColour: 'R' })
  })
  return out
}

const tier16 = [{ name: 'Map Tier', values: [['16', 0]] as [string, number][] }]

export const DEMO_TABS: StashTabInfo[] = [
  { id: 'd0000000a1', name: 'Currency', type: 'CurrencyStash', index: 0, colour: 'd9a441' },
  { id: 'd0000000b2', name: 'Fragments & Cards', type: 'PremiumStash', index: 1, colour: '7b5cd6' },
  { id: 'd0000000c3', name: 'Gear', type: 'QuadStash', index: 2, colour: 'c0392b' },
  { id: 'd0000000d4', name: 'Gems & Maps', type: 'PremiumStash', index: 3, colour: '2e86c1' },
  { id: 'd0000000e5', name: 'Sell', type: 'PremiumStash', index: 4, colour: '27ae60', parentId: 'd0000000f0', parentName: 'Folder' }
]

export function demoItems(tabId: string, seed: number): PoeItem[] {
  // Pequena variação entre snapshots para o gráfico de histórico ter movimento.
  const jitter = (n: number, pct = 0.08): number => Math.max(1, Math.round(n * (1 + Math.sin(seed * 1.7 + n) * pct)))
  switch (tabId) {
    case 'd0000000a1':
      return [
        currency('Divine Orb', jitter(14, 0.2)),
        currency('Chaos Orb', jitter(1270)),
        currency('Exalted Orb', 38),
        currency('Mirror Shard', 2),
        currency('Orb of Annulment', jitter(25)),
        currency('Orb of Alchemy', 300),
        currency('Vaal Orb', 60),
        currency("Gemcutter's Prism", 40),
        currency('Stacked Deck', jitter(30)),
        currency("Hinekora's Lock", 1),
        currency('Deafening Essence of Greed', 9),
        currency('Dense Fossil', 12),
        currency('Omen of Amelioration', 2)
      ]
    case 'd0000000b2':
      return [
        currency("The Maven's Writ", 3, 0),
        currency('Fragment of the Phoenix', 2, 0),
        currency('Simulacrum', 1, 0),
        currency('Awakening Fragment', 4, 0),
        currency('The Nurse', 3, 6),
        currency('I See Brothers', 1, 6),
        currency('Tattoo of the Hinekora Storyteller', 5),
        currency('Runegraft of Quaffing', 1)
      ]
    case 'd0000000c3':
      return [
        {
          name: 'Mageblood',
          typeLine: 'Heavy Belt',
          baseType: 'Heavy Belt',
          icon: ICON.mageblood,
          frameType: 3,
          ilvl: 84,
          identified: true,
          implicitMods: ['+35 to Strength'],
          explicitMods: [
            '+42 to Dexterity',
            '+18% to Fire Resistance',
            '+19% to Cold Resistance',
            'Magic Utility Flasks cannot be Used',
            'Leftmost 4 Magic Utility Flasks constantly apply their Flask Effects to you',
            'Magic Utility Flask Effects cannot be removed'
          ]
        },
        {
          name: 'The Covenant',
          typeLine: 'Spidersilk Robe',
          baseType: 'Spidersilk Robe',
          icon: ICON.covenant,
          frameType: 3,
          ilvl: 75,
          identified: true,
          sockets: sockets([6])
        },
        { name: "Kaom's Heart", typeLine: 'Glorious Plate', baseType: 'Glorious Plate', icon: ICON.kaom, frameType: 3, ilvl: 70, identified: true },
        { name: '', typeLine: 'Stygian Vise', baseType: 'Stygian Vise', icon: ICON.vise, frameType: 0, ilvl: 85, identified: true },
        {
          name: '',
          typeLine: 'Archdemon Crown',
          baseType: 'Archdemon Crown',
          icon: ICON.crown,
          frameType: 1,
          ilvl: 85,
          identified: true,
          influences: { shaper: true }
        },
        {
          name: 'Doom Hold',
          typeLine: 'Vaal Regalia',
          baseType: 'Vaal Regalia',
          icon: '',
          frameType: 2,
          ilvl: 70,
          identified: true,
          explicitMods: ['+80 to maximum Energy Shield']
        },
        {
          name: '',
          typeLine: 'Large Cluster Jewel',
          baseType: 'Large Cluster Jewel',
          icon: ICON.cluster,
          frameType: 2,
          ilvl: 84,
          identified: true,
          enchantMods: [
            'Adds 8 Passive Skills',
            '2 Added Passive Skills are Jewel Sockets',
            'Added Small Passive Skills grant: 12% increased Chaos Damage'
          ]
        }
      ]
    case 'd0000000d4':
      return [
        gem('Enlighten Support', ICON.enlighten, 3, 0),
        gem('Empower Support', ICON.empower, 4, 0, true),
        gem('Arc', ICON.arc, 20, 20),
        gem('Arc', ICON.arc, 18, 7),
        gem('Cleave of Rage', ICON.cleave, 21, 20, true),
        { ...currency('Map (Tier 16)', 1, 0), icon: ICON.map, properties: tier16 },
        { ...currency('Map (Tier 16)', 1, 0), icon: ICON.map, properties: tier16 },
        { ...currency('Blighted Map (Tier 16)', 1, 0), baseType: 'Map (Tier 16)', icon: ICON.blighted, properties: tier16 },
        {
          name: '',
          typeLine: 'Chronicle of Atzoatl',
          baseType: 'Chronicle of Atzoatl',
          icon: ICON.temple,
          frameType: 0,
          ilvl: 83,
          identified: true,
          explicitMods: ["Doryani's Institute (Tier 3)", 'Hall of Lords (Tier 3)']
        }
      ]
    case 'd0000000e5':
      return [
        { name: '', typeLine: 'Wild Bristle Matron', baseType: 'Wild Bristle Matron', icon: ICON.beast, frameType: 2, ilvl: 82, identified: true },
        {
          name: '',
          typeLine: 'Ancient Wombgift',
          baseType: 'Ancient Wombgift',
          icon: ICON.wombgift,
          frameType: 5,
          ilvl: 84,
          identified: true,
          stackSize: 3
        },
        currency('The Progeny of Lunaris', 1, 6)
      ]
    default:
      return []
  }
}
