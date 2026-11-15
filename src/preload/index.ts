import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ProgressEvent, SnapshotDetail, StashLedgerApi, UpdateState } from '../shared/types'

// Ponte mínima: o renderer não tem acesso a Node, tokens nem rede da GGG — só a estas funções.
const api: StashLedgerApi = {
  getState: () => ipcRenderer.invoke('state:get'),
  login: () => ipcRenderer.invoke('auth:login'),
  loginSession: (accountName, poesessid) => ipcRenderer.invoke('auth:session', accountName, poesessid),
  cancelLogin: () => ipcRenderer.invoke('auth:cancel'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  startDemo: () => ipcRenderer.invoke('demo:start'),
  stopDemo: () => ipcRenderer.invoke('demo:stop'),
  listLeagues: () => ipcRenderer.invoke('leagues:list'),
  listTabs: (league) => ipcRenderer.invoke('tabs:list', league),
  selectLeague: (league) => ipcRenderer.invoke('league:select', league),
  selectTabs: (league, ids) => ipcRenderer.invoke('tabs:select', league, ids),
  refreshPrices: (force) => ipcRenderer.invoke('prices:refresh', force),
  takeSnapshot: () => ipcRenderer.invoke('snapshot:take'),
  getSnapshots: (league) => ipcRenderer.invoke('snapshot:list', league),
  getLatest: (league) => ipcRenderer.invoke('snapshot:latest', league),
  clearHistory: (league) => ipcRenderer.invoke('snapshot:clear', league),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  onProgress: (cb) => {
    const listener = (_e: IpcRendererEvent, ev: ProgressEvent): void => cb(ev)
    ipcRenderer.on('progress', listener)
    return () => ipcRenderer.removeListener('progress', listener)
  },
  onSnapshot: (cb) => {
    const listener = (_e: IpcRendererEvent, snap: SnapshotDetail): void => cb(snap)
    ipcRenderer.on('snapshot', listener)
    return () => ipcRenderer.removeListener('snapshot', listener)
  },
  getUpdate: () => ipcRenderer.invoke('update:get'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: (cb) => {
    const listener = (_e: IpcRendererEvent, s: UpdateState): void => cb(s)
    ipcRenderer.on('update', listener)
    return () => ipcRenderer.removeListener('update', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
