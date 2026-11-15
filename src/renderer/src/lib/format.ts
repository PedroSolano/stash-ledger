const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })

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

export function signed(text: string, value: number): string {
  if (value > 0) return `+${text}`
  if (value < 0) return `−${text.replace(/^-/, '')}`
  return text
}

export function ago(ts: number | null | undefined): string {
  if (!ts) return 'nunca'
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return 'agora'
  const m = Math.round(s / 60)
  if (m < 60) return `há ${m} min`
  const h = Math.round(m / 60)
  if (h < 48) return `há ${h} h`
  return `há ${Math.round(h / 24)} dias`
}

const dt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const tm = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
const dm = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })

export const fmtDateTime = (t: number): string => dt.format(t)
export const fmtTime = (t: number): string => tm.format(t)
export const fmtDay = (t: number): string => dm.format(t)

export const CATEGORY_LABEL: Record<string, string> = {
  Currency: 'Moedas',
  Fragment: 'Fragmentos',
  Runegraft: 'Runegrafts',
  AllflameEmber: 'Brasas',
  Tattoo: 'Tatuagens',
  Omen: 'Presságios',
  DjinnCoin: 'Moedas de Djinn',
  Ducat: 'Ducados',
  EnshroudingCrystal: 'Cristais',
  DivinationCard: 'Cartas',
  Artifact: 'Artefatos',
  Oil: 'Óleos',
  DeliriumOrb: 'Orbes de Delírio',
  Scarab: 'Escaravelhos',
  Astrolabe: 'Astrolábios',
  Thread: 'Fios',
  Fossil: 'Fósseis',
  Resonator: 'Ressonadores',
  Essence: 'Essências',
  Wombgift: 'Wombgifts',
  Corpse: 'Cadáveres',
  Viscera: 'Vísceras',
  Incubator: 'Incubadoras',
  UniqueWeapon: 'Armas únicas',
  UniqueArmour: 'Armaduras únicas',
  UniqueAccessory: 'Acessórios únicos',
  UniqueFlask: 'Frascos únicos',
  UniqueJewel: 'Joias únicas',
  ForbiddenJewel: 'Joias proibidas',
  ShrineBelt: 'Cintos de santuário',
  UniqueTincture: 'Tinturas únicas',
  UniqueRelic: 'Relíquias',
  SkillGem: 'Gemas',
  ImbuedGem: 'Gemas imbuídas',
  ClusterJewel: 'Cluster jewels',
  Map: 'Mapas',
  BlightedMap: 'Mapas blighted',
  BlightRavagedMap: 'Mapas blight-ravaged',
  UniqueMap: 'Mapas únicos',
  ValdoMap: 'Mapas de Valdo',
  Invitation: 'Convites',
  Memory: 'Memórias',
  IncursionTemple: 'Templos',
  ScryingOrb: 'Orbes de vidência',
  BaseType: 'Bases',
  Flask: 'Frascos',
  Beast: 'Bestas',
  Vial: 'Frascos de Vaal'
}

export function categoryLabel(c?: string): string {
  if (!c) return 'Sem preço'
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
