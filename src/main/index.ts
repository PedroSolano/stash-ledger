import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProgressEvent, SnapshotDetail, UpdateState } from '../shared/types'
import { AppController } from './controller'
import { Updater } from './updater'

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null
let controller: AppController
const updater = new Updater((s) => send('update', s))

// Gancho de desenvolvimento: STASH_LEDGER_USER_DATA=pasta isola dados/cache de testes.
if (isDev && process.env.STASH_LEDGER_USER_DATA) app.setPath('userData', process.env.STASH_LEDGER_USER_DATA)

// Uma instância só: evita dois processos disputando a porta do login e os arquivos de dados.
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

/** Só abre no navegador do sistema endereços https de domínios conhecidos. */
const EXTERNAL_ALLOW = ['www.pathofexile.com', 'pathofexile.com', 'poe.ninja', 'github.com']

function isAllowedExternal(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && EXTERNAL_ALLOW.includes(u.hostname)
  } catch {
    return false
  }
}

function send(channel: string, payload: ProgressEvent | SnapshotDetail | UpdateState): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 620,
    show: false,
    backgroundColor: '#14110e',
    title: 'Stash Ledger',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // Nada de janelas novas ou navegação dentro do app: links vão para o navegador do sistema.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault()
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Gancho de desenvolvimento: STASH_LEDGER_SCREENSHOT=arquivo.png captura a janela e fecha o app.
  const shot = isDev ? process.env.STASH_LEDGER_SCREENSHOT : undefined
  if (shot) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        // STASH_LEDGER_SCREENSHOT_JS: script opcional (ex.: abrir um modal) executado antes da captura.
        const js = process.env.STASH_LEDGER_SCREENSHOT_JS
        if (js) {
          await mainWindow!.webContents.executeJavaScript(js).catch((e: Error) => console.error('[shot-js]', e.message))
          await new Promise((r) => setTimeout(r, 1200))
        }
        const image = await mainWindow!.webContents.capturePage()
        await writeFile(shot, image.toPNG())
        app.quit()
      }, Number(process.env.STASH_LEDGER_SCREENSHOT_DELAY ?? 6000))
    })
  }
}

type Handler = (...args: never[]) => unknown

function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    // Aceita chamadas apenas da janela principal do app.
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Origem não autorizada.')
    return (fn as (...a: unknown[]) => unknown)(...args)
  })
}

function registerIpc(): void {
  handle('state:get', () => controller.state())
  handle('auth:login', () => controller.login())
  handle('auth:session', (accountName: string, poesessid: string) =>
    controller.loginSession(String(accountName ?? ''), String(poesessid ?? ''))
  )
  handle('auth:cancel', () => controller.cancelLogin())
  handle('auth:logout', () => controller.logout())
  handle('demo:start', () => controller.startDemo())
  handle('demo:stop', () => controller.stopDemo())
  handle('leagues:list', () => controller.listLeagues())
  handle('tabs:list', (league: string) => controller.listTabs(String(league)))
  handle('league:select', (league: string) => controller.selectLeague(String(league)))
  handle('tabs:select', (league: string, ids: string[]) =>
    controller.selectTabs(String(league), Array.isArray(ids) ? ids.map(String) : [])
  )
  handle('prices:refresh', (force: boolean) => controller.refreshPrices(!!force))
  handle('snapshot:take', () => controller.takeSnapshot())
  handle('snapshot:list', (league: string) => controller.getSnapshots(String(league)))
  handle('snapshot:latest', (league: string) => controller.getLatest(String(league)))
  handle('snapshot:clear', (league: string) => controller.clearHistory(String(league)))
  handle('settings:update', (patch: object) => controller.updateSettings(patch && typeof patch === 'object' ? patch : {}))
  handle('external:open', async (url: string) => {
    if (isAllowedExternal(String(url))) await shell.openExternal(String(url))
  })
  handle('update:get', () => updater.get())
  handle('update:check', () => updater.check())
  handle('update:install', () => updater.install())
}

app.whenReady().then(async () => {
  controller = new AppController({
    userData: app.getPath('userData'),
    version: app.getVersion(),
    env: import.meta.env as unknown as Record<string, string | undefined>,
    openBrowser: (url) => shell.openExternal(url),
    emitProgress: (ev) => send('progress', ev),
    emitSnapshot: (snap) => send('snapshot', snap)
  })
  await controller.init()
  registerIpc()

  // Gancho de desenvolvimento: STASH_LEDGER_DEMO=1 entra no modo demonstração e tira um snapshot.
  if (isDev && process.env.STASH_LEDGER_DEMO === '1') {
    await controller.startDemo()
    await controller.takeSnapshot().catch((e: Error) => console.error('[demo]', e.message))
  }

  createWindow()
  // Procura atualização assim que a janela abre (no app instalado).
  mainWindow!.webContents.once('did-finish-load', () => updater.start())
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  controller?.dispose()
  updater.dispose()
  if (process.platform !== 'darwin') app.quit()
})
