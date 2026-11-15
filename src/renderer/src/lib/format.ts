// Interface em inglês (é como o jogo é jogado), com números e datas no formato en-US.
const LOCALE = 'en-US'
const nf0 = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 })
const compact = new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 })

export function num(n: number, digits = 0): string {
  if (digits === 0) return nf0.format(n)
  if (digits === 1) return nf1.format(n)
  return nf2.format(n)
}

export function compactNum(n: number): string {
  return Math.abs(n) >= 10000 ? compact.format(n) : nf0.format(n)
}

/** Valor em chaos formatado: usa divines quando passa de 1 div. */
export function price(chaos: number, divine: number | null | undefined): string {
  if (divine && Math.abs(chaos) >= divine) {
    const d = chaos / divine
    return `${Math.abs(d) >= 100 ? num(d) : num(d, Math.abs(d) >= 10 ? 1 : 2)} div`
  }
  if (Math.abs(chaos) >= 100) return `${num(chaos)} c`
  return `${num(chaos, Math.abs(chaos) >= 10 ? 1 : 2)} c`
}

export function chaosText(chaos: number): string {
  return `${Math.abs(chaos) >= 100 ? num(chaos) : num(chaos, 1)} c`
}

export function ago(ts: number | null | undefined): string {
  if (!ts) return 'never'
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

const dt = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const tm = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' })
const dm = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric' })

export const fmtDateTime = (t: number): string => dt.format(t)
export const fmtTime = (t: number): string => tm.format(t)
export const fmtDay = (t: number): string => dm.format(t)

export const CATEGORY_LABEL: Record<string, string> = {
  Currency: 'Currency',
  Fragment: 'Fragments',
  Runegraft: 'Runegrafts',
  AllflameEmber: 'Allflame Embers',
  Tattoo: 'Tattoos',
  Omen: 'Omens',
  DjinnCoin: 'Djinn Coins',
  Ducat: 'Ducats',
  EnshroudingCrystal: 'Enshrouding Crystals',
  DivinationCard: 'Divination Cards',
  Artifact: 'Artifacts',
  Oil: 'Oils',
  DeliriumOrb: 'Delirium Orbs',
  Scarab: 'Scarabs',
  Astrolabe: 'Astrolabes',
  Thread: 'Threads',
  Fossil: 'Fossils',
  Resonator: 'Resonators',
  Essence: 'Essences',
  Wombgift: 'Wombgifts',
  Corpse: 'Corpses',
  Viscera: 'Viscera',
  Incubator: 'Incubators',
  UniqueWeapon: 'Unique Weapons',
  UniqueArmour: 'Unique Armours',
  UniqueAccessory: 'Unique Accessories',
  UniqueFlask: 'Unique Flasks',
  UniqueJewel: 'Unique Jewels',
  ForbiddenJewel: 'Forbidden Jewels',
  ShrineBelt: 'Shrine Belts',
  UniqueTincture: 'Unique Tinctures',
  UniqueRelic: 'Unique Relics',
  SkillGem: 'Skill Gems',
  ImbuedGem: 'Imbued Gems',
  ClusterJewel: 'Cluster Jewels',
  Map: 'Maps',
  BlightedMap: 'Blighted Maps',
  BlightRavagedMap: 'Blight-ravaged Maps',
  UniqueMap: 'Unique Maps',
  ValdoMap: 'Valdo Maps',
  Invitation: 'Invitations',
  Memory: 'Memories',
  IncursionTemple: 'Temples',
  ScryingOrb: 'Scrying Orbs',
  BaseType: 'Base Types',
  Flask: 'Flasks',
  Beast: 'Beasts',
  Vial: 'Vials'
}

export function categoryLabel(c?: string): string {
  if (!c) return 'No price'
  return CATEGORY_LABEL[c] ?? c
}

/** Classe de cor do nome pelo frameType (raridade) do item. */
export function rarityClass(frameType: number): string {
  switch (frameType) {
    case 1:
      return 'r-magic'
    case 2:
      return 'r-rare'
    case 3:
    case 9:
    case 10:
      return 'r-unique'
    case 4:
      return 'r-gem'
    case 5:
      return 'r-currency'
    case 6:
      return 'r-card'
    default:
      return 'r-normal'
  }
}
