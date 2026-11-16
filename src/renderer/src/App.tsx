import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  AppState,
  ProgressEvent,
  Settings,
  SnapshotDetail,
  SnapshotSummary,
  UpdateState,
  WindowVisibility
} from '../../shared/types'
import { Dashboard } from './components/Dashboard'
import { SettingsModal } from './components/SettingsModal'
import { TabPicker } from './components/TabPicker'
import { TitleBar } from './components/TitleBar'
import { UpdateBanner } from './components/UpdateBanner'
import { Welcome } from './components/Welcome'
import { ago } from './lib/format'
import { useLayout } from './lib/useLayout'

const api = window.api

function progressText(p: ProgressEvent): string | null {
  switch (p.kind) {
    case 'prices':
      return p.done < p.total ? `Updating poe.ninja prices… ${p.done}/${p.total}` : null
    case 'tabs':
      return p.done < p.total ? `Fetching tabs ${p.done + 1}/${p.total}${p.tabName ? ` · ${p.tabName}` : ''}` : null
    case 'ratelimit':
      return `Waiting for GGG rate limit (${Math.ceil(p.waitMs / 1000)} s)…`
    default:
      return null
  }
}

export function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [leagues, setLeagues] = useState<string[]>([])
  const [latest, setLatest] = useState<SnapshotDetail | null>(null)
  const [history, setHistory] = useState<SnapshotSummary[]>([])
  const [progress, setProgress] = useState<ProgressEvent>({ kind: 'idle' })
  const [busy, setBusy] = useState<'login' | 'session' | 'demo' | 'snapshot' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<'tabs' | 'settings' | null>(null)
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' })
  const [vis, setVis] = useState<WindowVisibility>({ visible: true, overlay: false })
  const [, setTick] = useState(0)
  const autoOpened = useRef(false)
  const { layout, detected, pref: layoutPref, setPref: setLayoutPref } = useLayout()

  const fail = (e: unknown): void =>
    setError((e as Error)?.message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') ?? String(e))

  useEffect(() => {
    api.getState().then(setState).catch(fail)
    const offP = api.onProgress((p) => {
      setProgress(p)
      if (p.kind === 'error') setError(p.message)
    })
    const offS = api.onSnapshot((snap) => {
      setLatest(snap)
      const { items: _i, pricesUpdatedAt: _p, ...summary } = snap
      setHistory((h) => (h.some((x) => x.id === snap.id) ? h : [...h, summary]))
    })
    api.getUpdate().then(setUpdate).catch(() => undefined)
    const offU = api.onUpdate(setUpdate)
    const offV = api.onVisibility(setVis)
    const timer = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => {
      offP()
      offS()
      offU()
      offV()
      clearInterval(timer)
    }
  }, [])

  // Aberta por cima do jogo: Esc esconde e devolve o foco ao jogo (se não houver janela de diálogo aberta).
  useEffect(() => {
    if (!vis.overlay || modal) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) void api.hideWindow()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [vis.overlay, modal])

  const session = !!state && (state.demo || state.auth.loggedIn)
  const league = state?.settings.league ?? null
  // Mesma chave usada pelo processo principal (controller.selectionKey).
  const selPrefix = state?.demo ? 'demo:' : state?.auth.method === 'session' ? 'session:' : ''
  const selKey = state && league ? `${selPrefix}${league}` : ''
  const selected = state && selKey ? (state.settings.selectedTabs[selKey] ?? []) : []

  // Ligas disponíveis ao entrar na sessão.
  useEffect(() => {
    if (!session) return
    api
      .listLeagues()
      .then(async (ls) => {
        setLeagues(ls)
        if (ls.length && (!league || !ls.includes(league))) setState(await api.selectLeague(ls[0]))
      })
      .catch(fail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, state?.demo])

  // Histórico e último snapshot da liga escolhida.
  useEffect(() => {
    if (!session || !league) return
    Promise.all([api.getLatest(league), api.getSnapshots(league)])
      .then(([l, h]) => {
        setLatest(l)
        setHistory(h)
      })
      .catch(fail)
  }, [session, league, state?.demo])

  // Primeira vez numa liga sem abas escolhidas: abre o seletor.
  useEffect(() => {
    if (session && league && !selected.length && !autoOpened.current) {
      autoOpened.current = true
      setModal('tabs')
    }
  }, [session, league, selected.length])

  const run = useCallback(async (kind: 'login' | 'session' | 'demo' | 'snapshot', fn: () => Promise<void>): Promise<boolean> => {
    setBusy(kind)
    setError(null)
    try {
      await fn()
      return true
    } catch (e) {
      fail(e)
      // A sessão pode ter sido descartada (POESESSID recusado): sincroniza o estado.
      api.getState().then(setState).catch(() => undefined)
      return false
    } finally {
      setBusy(null)
      setProgress({ kind: 'idle' })
    }
  }, [])

  const snapshot = async (): Promise<void> => {
    await run('snapshot', async () => {
      await api.takeSnapshot()
    })
  }

  const saveSettings = async (patch: Partial<Settings>): Promise<void> => setState(await api.updateSettings(patch))

  if (!state) return null

  const modals = (
    <>
      {modal === 'settings' && (
        <SettingsModal
          state={state}
          update={update}
          layoutPref={layoutPref}
          detectedLayout={detected}
          onLayoutPref={setLayoutPref}
          onClose={() => setModal(null)}
          onSave={saveSettings}
          onClearHistory={
            session && league
              ? async () => {
                  await api.clearHistory(league)
                  setHistory([])
                  setLatest(null)
                }
              : null
          }
        />
      )}
      {modal === 'tabs' && league && (
        <TabPicker
          league={league}
          selected={selected}
          sessionMode={state.auth.method === 'session' && !state.demo}
          onClose={() => setModal(null)}
          onSave={async (ids) => {
            setModal(null)
            setState(await api.selectTabs(league, ids))
          }}
        />
      )}
    </>
  )

  // Escondida (bandeja / jogo), a contagem para reiniciar e atualizar fica pausada.
  const banner = <UpdateBanner update={update} busy={busy === 'snapshot'} hidden={!vis.visible} />
  const shell = (body: ReactNode) => (
    <div className="shell">
      <TitleBar overlayKey={state.settings.hotkeysEnabled ? state.settings.overlayKey : ''} />
      <div className="shell-body">{body}</div>
    </div>
  )

  if (!session) {
    return shell(
      <>
        {banner}
        <Welcome
          configured={state.configured}
          busy={busy === 'login' || busy === 'session' || busy === 'demo' ? busy : null}
          error={error}
          onLogin={() => void run('login', async () => setState(await api.login()))}
          onCancelLogin={() => void api.cancelLogin()}
          onSessionLogin={(account, sessid) => run('session', async () => setState(await api.loginSession(account, sessid)))}
          onDemo={() => void run('demo', async () => setState(await api.startDemo()))}
          onSettings={() => setModal('settings')}
        />
        {modals}
      </>
    )
  }

  const status = progressText(progress)

  return shell(
    <div className="app">
      {banner}
      <div className="topbar">
        <select
          className="select"
          aria-label="League"
          value={league ?? ''}
          onChange={async (e) => setState(await api.selectLeague(e.target.value))}
        >
          {!leagues.length && league && <option value={league}>{league}</option>}
          {leagues.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => setModal('tabs')}>
          Tabs ({selected.length})
        </button>
        <button className="btn primary" onClick={snapshot} disabled={busy === 'snapshot' || !selected.length}>
          {busy === 'snapshot' ? 'Refreshing…' : 'Refresh now'}
        </button>
        <span className="spacer" />
        {state.demo ? (
          <span className="pill demo">Demo mode</span>
        ) : (
          <span
            className="pill"
            title={state.auth.method === 'session' ? 'Connected via POESESSID (legacy website endpoint)' : 'Connected via official OAuth'}
          >
            {state.auth.username}
            {state.auth.method === 'session' ? ' · session' : ''}
          </span>
        )}
        <button className="btn ghost" onClick={() => setModal('settings')} aria-label="Settings">
          ⚙ Settings
        </button>
        <button
          className="btn ghost"
          onClick={async () => {
            setLatest(null)
            setHistory([])
            setState(state.demo ? await api.stopDemo() : await api.logout())
          }}
        >
          {state.demo ? 'Exit demo' : 'Log out'}
        </button>
      </div>
      <div className="statusbar" aria-live="polite">
        {status ? (
          <span className="progress">{status}</span>
        ) : (
          <span>
            {latest ? `Last snapshot ${ago(latest.takenAt)}` : 'No snapshots in this league'}
            {state.settings.autoSnapshotMinutes ? ` · auto every ${state.settings.autoSnapshotMinutes} min` : ''}
          </span>
        )}
      </div>
      <div className="content">
        <div className={`dash-wrap layout-${layout}`}>
          {error && (
            <div className="banner" role="alert">
              <span>{error}</span>
              <span className="spacer" />
              <button className="btn ghost" onClick={() => setError(null)}>
                Dismiss
              </button>
            </div>
          )}
          <Dashboard
            latest={latest}
            history={history}
            hideBelow={state.settings.hideBelowChaos}
            onHideBelowChange={(v) => void saveSettings({ hideBelowChaos: v })}
            layout={layout}
            sessionMode={state.auth.method === 'session' && !state.demo}
          />
        </div>
        <div className="disclaimer">This product isn't affiliated with or endorsed by Grinding Gear Games in any way. Prices: poe.ninja.</div>
      </div>
      {modals}
    </div>
  )
}
