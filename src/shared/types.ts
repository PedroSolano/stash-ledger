// Tipos compartilhados entre o controller (src/core), a interface e o overlay.
import type { ChatCommand } from './hotkeys'

/* ---------- Formato dos itens da API oficial da GGG (subconjunto usado) ---------- */

export interface PoeItemProperty {
  name: string
  values: [string, number][]
  displayMode?: number
  type?: number
}

export interface PoeSocket {
  group: number
  attr?: string
  sColour?: string
}

export interface PoeItem {
  id?: string
  name: string
  typeLine: string
  baseType: string
  icon: string
  frameType?: number
  ilvl: number
  identified: boolean
  corrupted?: boolean
  stackSize?: number
  maxStackSize?: number
  properties?: PoeItemProperty[]
  additionalProperties?: PoeItemProperty[]
  sockets?: PoeSocket[]
  influences?: Record<string, boolean>
  enchantMods?: string[]
  implicitMods?: string[]
  explicitMods?: string[]
  craftedMods?: string[]
  fracturedMods?: string[]
  mutatedMods?: string[]
  utilityMods?: string[]
  descrText?: string
  secDescrText?: string
  mutated?: boolean
  replica?: boolean
  isRelic?: boolean
  foilVariation?: number
  w?: number
  h?: number
  x?: number
  y?: number
  inventoryId?: string
  note?: string
}

export interface PoeStashTab {
  id: string
  parent?: string
  name: string
  type: string
  index?: number
  metadata?: { public?: boolean; folder?: boolean; colour?: string }
  children?: PoeStashTab[]
  items?: PoeItem[]
}

/* ---------- Modelos do app ---------- */

/** Aba selecionável (lista achatada: filhos de pastas aparecem como abas próprias). */
export interface StashTabInfo {
  id: string
  name: string
  type: string
  index: number
  colour?: string
  parentId?: string
  parentName?: string
}

export type Confidence = 'high' | 'low'

export interface PricedItem {
  key: string
  name: string
  typeLine: string
  icon: string
  frameType: number
  quantity: number
  unitChaos: number
  totalChaos: number
  /** false quando o preço existe mas não entra no total (baixa confiança desativada). */
  counted: boolean
  category?: string
  confidence?: Confidence
  approximate?: boolean
  detail?: string
  tabs: string[]
}

export interface TabValue {
  id: string
  name: string
  /** Tipo da aba na GGG (ex.: UniqueStash). */
  type?: string
  colour?: string
  chaos: number
  itemCount: number
}

export interface SnapshotSummary {
  id: string
  takenAt: number
  league: string
  totalChaos: number
  divineChaos: number
  itemCount: number
  pricedCount: number
  /** Itens que não puderam ser lidos/precificados por erro (detalhes no log). */
  errorCount?: number
  tabs: TabValue[]
  demo?: boolean
}

export interface SnapshotDetail extends SnapshotSummary {
  items: PricedItem[]
  pricesUpdatedAt: number | null
}

export interface Settings {
  /** client_id do app registrado na GGG (cliente público, sem segredo). */
  clientId: string
  /** URI de retorno registrada na GGG. Precisa ser local, ex.: http://127.0.0.1:8080/callback */
  redirectUri: string
  /** Contato exigido pela GGG no User-Agent (e-mail ou URL do projeto). */
  contact: string
  /** Base das requisições ao poe.ninja. Troque por um proxy com cache, se tiver um. */
  ninjaBaseUrl: string
  league: string | null
  selectedTabs: Record<string, string[]>
  /** Intervalo de snapshot automático em minutos (0 = desligado). */
  autoSnapshotMinutes: number
  /** Soma itens com poucas amostras no poe.ninja ao patrimônio total. */
  includeLowConfidence: boolean
  /** Precifica bases ilvl 82+ (normais/mágicas/raras) pela tabela de bases do poe.ninja. */
  priceBaseTypes: boolean
  /** Esconde itens abaixo desse valor (em chaos) na tabela. */
  hideBelowChaos: number
  /** De quanto em quanto tempo (min) o cache local de preços é atualizado a partir do poe.ninja. */
  priceRefreshMinutes: number
  /** Sirene no canto da tela quando um item caro entra na stash. */
  alertsEnabled: boolean
  /** Preço unitário mínimo (em divines) para disparar a sirene. */
  alertThresholdDiv: number
  /** Tocar o som da sirene junto com o overlay. */
  alertSound: boolean
  /** Atalhos dentro do jogo (abrir o app por cima do jogo, comandos de chat). */
  hotkeysEnabled: boolean
  /** Mostra/esconde o app por cima do jogo. Formato em src/shared/hotkeys.ts. */
  overlayKey: string
  /** Atalho → comando de chat (/hideout, /kingsmarch…). */
  chatCommands: ChatCommand[]
  /** Price check do item sob o cursor (padrão Alt+D; vazio = desligado). */
  priceCheckKey: string
}

/** Resultado do price check (atalho sobre um item no jogo), mostrado na janelinha ao lado do cursor. */
export interface PriceCheckResult {
  /** false: o texto copiado não era um item, ou não havia preços carregados. */
  ok: boolean
  name: string
  base?: string
  frameType: number
  quantity: number
  unitChaos?: number
  totalChaos?: number
  divineChaos: number
  category?: string
  confidence?: Confidence
  approximate?: boolean
  detail?: string
  icon?: string
  /** Explicação quando não há preço. */
  message?: string
  /** Único não identificado: os únicos possíveis dessa base, do mais caro ao mais barato. */
  candidates?: { name: string; chaos: number; confidence: Confidence; detail?: string; icon?: string }[]
  league?: string
  pricesUpdatedAt?: number | null
}

export interface WindowVisibility {
  visible: boolean
  overlay: boolean
}

/** Configuração de atalhos enviada ao backend. */
export interface HotkeyConfig {
  enabled: boolean
  overlay: string
  priceCheck: string
  commands: ChatCommand[]
}

export interface DropAlertItem {
  name: string
  detail?: string
  icon: string
  frameType: number
  quantity: number
  unitChaos: number
  totalChaos: number
}

/** Conteúdo do overlay de alerta. */
export interface DropAlert {
  items: DropAlertItem[]
  totalChaos: number
  divineChaos: number
  sound: boolean
  test?: boolean
}

export interface AuthStatus {
  loggedIn: boolean
  /** 'oauth' = API oficial; 'session' = POESESSID no endpoint antigo do site. */
  method?: 'oauth' | 'session'
  username?: string
  expiresAt?: number
  refreshable?: boolean
}

export interface AppState {
  version: string
  settings: Settings
  auth: AuthStatus
  demo: boolean
  /** true quando há client_id configurado (login real possível). */
  configured: boolean
  /** true quando o sistema operacional oferece armazenamento criptografado para os tokens. */
  secureStorage: boolean
}

export interface PriceStatus {
  league: string
  updatedAt: number | null
  divineChaos: number | null
  categories: number
  failed: string[]
}

export type ProgressEvent =
  | { kind: 'idle' }
  | { kind: 'prices'; done: number; total: number }
  | { kind: 'tabs'; done: number; total: number; tabName?: string }
  | { kind: 'ratelimit'; waitMs: number }
  | { kind: 'error'; message: string }

export type UpdateState =
  | { status: 'idle' | 'disabled' | 'checking' | 'latest' }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string }

/** API usada pela interface (window.api), montada em src/renderer/src/lib/api.ts. */
export interface StashLedgerApi {
  getState(): Promise<AppState>
  login(): Promise<AppState>
  /** Modo sessão: valida o POESESSID com uma requisição e só então o guarda (criptografado). */
  loginSession(accountName: string, poesessid: string): Promise<AppState>
  cancelLogin(): Promise<void>
  logout(): Promise<AppState>
  startDemo(): Promise<AppState>
  stopDemo(): Promise<AppState>
  listLeagues(): Promise<string[]>
  listTabs(league: string): Promise<StashTabInfo[]>
  selectLeague(league: string): Promise<AppState>
  selectTabs(league: string, tabIds: string[]): Promise<AppState>
  refreshPrices(force: boolean): Promise<PriceStatus>
  takeSnapshot(): Promise<SnapshotDetail>
  getSnapshots(league: string): Promise<SnapshotSummary[]>
  getLatest(league: string): Promise<SnapshotDetail | null>
  clearHistory(league: string): Promise<void>
  updateSettings(patch: Partial<Settings>): Promise<AppState>
  openExternal(url: string): Promise<void>
  onProgress(cb: (ev: ProgressEvent) => void): () => void
  onSnapshot(cb: (snap: SnapshotDetail) => void): () => void
  /** Mostra o arquivo de log de erros no Explorer. */
  openLog(): Promise<void>
  /** Dispara o overlay de alerta com um item de exemplo. */
  testAlert(): Promise<void>
  /** Suspende os atalhos enquanto o usuário grava uma combinação nas configurações. */
  pauseHotkeys(paused: boolean): Promise<void>
  /** Esconde a janela (fica na bandeja); se estava por cima do jogo, devolve o foco a ele. */
  hideWindow(): Promise<void>
  /** Fecha o app de vez (instala a atualização pendente, se houver). */
  quit(): Promise<void>
  /** Janela visível ou escondida (bandeja / atalho do overlay); `overlay`: aberta por cima do jogo. */
  onVisibility(cb: (v: WindowVisibility) => void): () => void
  getUpdate(): Promise<UpdateState>
  checkUpdate(): Promise<void>
  installUpdate(): Promise<void>
  onUpdate(cb: (s: UpdateState) => void): () => void
}
