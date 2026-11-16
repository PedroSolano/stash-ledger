import { useState } from 'react'
import type { AppState, Settings, UpdateState } from '../../../shared/types'
import { LAYOUT_LABEL, type Layout, type LayoutPref } from '../lib/useLayout'

function updateText(u: UpdateState): string {
  switch (u.status) {
    case 'disabled':
      return 'auto-update only works in the installed app'
    case 'checking':
      return 'checking for updates…'
    case 'latest':
      return 'up to date'
    case 'downloading':
      return `downloading ${u.version} (${u.percent}%)`
    case 'ready':
      return `${u.version} ready to install`
    case 'error':
      return 'could not check for updates'
    default:
      return ''
  }
}

interface Props {
  state: AppState
  update: UpdateState
  layoutPref: LayoutPref
  detectedLayout: Layout
  onLayoutPref: (p: LayoutPref) => void
  onClose: () => void
  onSave: (patch: Partial<Settings>) => Promise<void>
  onClearHistory: (() => Promise<void>) | null
}

export function SettingsModal({ state, update, layoutPref, detectedLayout, onLayoutPref, onClose, onSave, onClearHistory }: Props) {
  const [s, setS] = useState<Settings>(state.settings)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof Settings>(k: K, v: Settings[K]): void => setS((prev) => ({ ...prev, [k]: v }))

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await onSave({
        clientId: s.clientId,
        redirectUri: s.redirectUri,
        contact: s.contact,
        ninjaBaseUrl: s.ninjaBaseUrl,
        autoSnapshotMinutes: s.autoSnapshotMinutes,
        includeLowConfidence: s.includeLowConfidence,
        priceBaseTypes: s.priceBaseTypes,
        hideBelowChaos: s.hideBelowChaos,
        priceRefreshMinutes: s.priceRefreshMinutes,
        alertsEnabled: s.alertsEnabled,
        alertThresholdDiv: s.alertThresholdDiv,
        alertSound: s.alertSound
      })
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="frame modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header>
          <h2 id="settings-title">Settings</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="body">
          <div className="section-title">Display</div>
          <div className="field">
            <label htmlFor="layout">Layout</label>
            <select
              id="layout"
              className="select"
              value={layoutPref}
              onChange={(e) => onLayoutPref(e.target.value as LayoutPref)}
            >
              <option value="auto">Automatic (detected: {LAYOUT_LABEL[detectedLayout]})</option>
              {(Object.keys(LAYOUT_LABEL) as Layout[]).map((l) => (
                <option key={l} value={l}>
                  {LAYOUT_LABEL[l]}
                </option>
              ))}
            </select>
            <span className="hint">
              Automatic picks the layout from your window size and aspect ratio: ultrawide monitors (21:9, 32:9) get three
              columns. Applies right away.
            </span>
          </div>

          <div className="section-title">GGG sign-in (OAuth)</div>
          <div className="field">
            <label htmlFor="cid">Client ID</label>
            <input id="cid" className="input" value={s.clientId} onChange={(e) => set('clientId', e.target.value)} />
            <span className="hint">
              Your app's ID, registered with GGG as a public client. There is no secret: sign-in uses PKCE.{' '}
              <a href="https://www.pathofexile.com/developer/docs" target="_blank" rel="noreferrer">
                GGG developer docs
              </a>
            </span>
          </div>
          <div className="field">
            <label htmlFor="ruri">Redirect URI</label>
            <input id="ruri" className="input" value={s.redirectUri} onChange={(e) => set('redirectUri', e.target.value)} />
            <span className="hint">Must match the registered one exactly and be local, e.g. http://127.0.0.1:8080/callback</span>
          </div>
          <div className="field">
            <label htmlFor="contact">User-Agent contact</label>
            <input id="contact" className="input" value={s.contact} onChange={(e) => set('contact', e.target.value)} />
            <span className="hint">GGG requires a contact (email or URL) in the User-Agent of API requests.</span>
          </div>

          <div className="section-title">Pricing</div>
          <div className="field">
            <label htmlFor="refresh">Update prices</label>
            <select
              id="refresh"
              className="select"
              value={s.priceRefreshMinutes}
              onChange={(e) => set('priceRefreshMinutes', Number(e.target.value))}
            >
              <option value={15}>Every 15 minutes</option>
              <option value={30}>Every 30 minutes</option>
              <option value={60}>Every hour</option>
              <option value={120}>Every 2 hours</option>
            </select>
            <span className="hint">
              Prices are kept in a small compressed cache on your computer and only re-downloaded when poe.ninja has
              something new. poe.ninja itself updates about every 15 minutes.
            </span>
          </div>
          <label className="check">
            <input type="checkbox" checked={s.priceBaseTypes} onChange={(e) => set('priceBaseTypes', e.target.checked)} />
            <span>
              Price ilvl 82+ bases
              <div className="sub">Normal, magic and rare items get the poe.ninja base type price (including influence).</div>
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={s.includeLowConfidence}
              onChange={(e) => set('includeLowConfidence', e.target.checked)}
            />
            <span>
              Include low-confidence prices in totals
              <div className="sub">Items with fewer than 5 listings on poe.ninja show in the table but are left out of the total.</div>
            </span>
          </label>
          <div className="field">
            <label htmlFor="ninja">Price server</label>
            <input id="ninja" className="input" value={s.ninjaBaseUrl} onChange={(e) => set('ninjaBaseUrl', e.target.value)} />
            <span className="hint">
              Default: https://poe.ninja. poe.ninja recommends desktop apps go through a caching proxy; if you have one,
              put its address here.
            </span>
          </div>

          <div className="section-title">Snapshots</div>
          <div className="field">
            <label htmlFor="auto">Automatic snapshot</label>
            <select
              id="auto"
              className="select"
              value={s.autoSnapshotMinutes}
              onChange={(e) => set('autoSnapshotMinutes', Number(e.target.value))}
            >
              <option value={0}>Off</option>
              <option value={5}>Every 5 minutes</option>
              <option value={10}>Every 10 minutes</option>
              <option value={15}>Every 15 minutes</option>
              <option value={30}>Every 30 minutes</option>
              <option value={60}>Every hour</option>
            </select>
            <span className="hint">Respects GGG rate limits: if needed, it waits before fetching your tabs.</span>
          </div>

          <div className="section-title">Drop alerts</div>
          <label className="check">
            <input type="checkbox" checked={s.alertsEnabled} onChange={(e) => set('alertsEnabled', e.target.checked)} />
            <span>
              Siren on valuable drops
              <div className="sub">
                When a snapshot finds a new item worth at least the value below, a siren pops up in the top-left corner of
                your screen, over the game, with the item and its price.
              </div>
            </span>
          </label>
          <div className="field">
            <label htmlFor="alert-min">Minimum value (divine)</label>
            <input
              id="alert-min"
              className="input"
              type="number"
              min={0.05}
              step={0.1}
              value={s.alertThresholdDiv}
              disabled={!s.alertsEnabled}
              onChange={(e) => set('alertThresholdDiv', Number(e.target.value))}
            />
            <span className="hint">
              Per item, using the current divine price. Stacks count only what was added (2 new divines = 2 div). Items are
              detected on each snapshot, so pair this with an automatic snapshot (every 5 minutes is a good fit). Shows over
              windowed or borderless fullscreen, not exclusive fullscreen.
            </span>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={s.alertSound}
              disabled={!s.alertsEnabled}
              onChange={(e) => set('alertSound', e.target.checked)}
            />
            <span>Play siren sound</span>
          </label>
          <button
            className="btn"
            style={{ marginBottom: 6 }}
            onClick={() =>
              void window.api
                .updateSettings({ alertSound: s.alertSound })
                .then(() => window.api.testAlert())
                .catch((e: Error) => setError(e.message))
            }
          >
            Test alert
          </button>

          <div className="section-title">Maintenance</div>
          {onClearHistory && (
            <button
              className="btn"
              onClick={async () => {
                if (window.confirm("Delete all snapshot history for this league? This can't be undone.")) {
                  await onClearHistory()
                }
              }}
            >
              Clear this league's history
            </button>
          )}
          <button className="btn" style={{ marginLeft: onClearHistory ? 10 : 0 }} onClick={() => void window.api.openLog()}>
            Open error log
          </button>
          {!state.secureStorage && (
            <div className="banner" style={{ marginTop: 16 }}>
              Your system has no encrypted storage available: your sign-in won't be remembered between sessions.
            </div>
          )}
          {error && (
            <div className="banner" style={{ marginTop: 16 }}>
              {error}
            </div>
          )}
        </div>
        <footer>
          <span className="sub" title={update.status === 'error' ? update.message : undefined}>
            v{state.version}
            {updateText(update) ? ` · ${updateText(update)}` : ''}
          </span>
          {(update.status === 'latest' || update.status === 'error') && (
            <button className="btn ghost" onClick={() => void window.api.checkUpdate()}>
              Check for updates
            </button>
          )}
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={saving}>
            Save
          </button>
        </footer>
      </div>
    </div>
  )
}
