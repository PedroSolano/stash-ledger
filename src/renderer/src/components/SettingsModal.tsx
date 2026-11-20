import { useState } from 'react'
import type { ChatCommand } from '../../../shared/hotkeys'
import type { AlertCurrency, AppState, Settings, UpdateState } from '../../../shared/types'
import { LAYOUT_LABEL, type Layout, type LayoutPref } from '../lib/useLayout'
import { HotkeyInput } from './HotkeyInput'

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

function ChatRow(props: {
  cmd: ChatCommand
  disabled: boolean
  conflict: boolean
  onKey: (key: string) => void
  onCommand: (command: string) => void
  onRemove: () => void
}) {
  const { cmd, disabled, conflict } = props
  return (
    <>
      <HotkeyInput value={cmd.key} disabled={disabled} invalid={conflict} onChange={props.onKey} />
      <input
        className="input"
        value={cmd.command}
        maxLength={120}
        disabled={disabled}
        placeholder="/hideout"
        aria-label="Chat command"
        title={conflict ? 'This key is already used above' : undefined}
        onChange={(e) => props.onCommand(e.target.value)}
      />
      <button className="btn ghost" disabled={disabled} onClick={props.onRemove} aria-label="Remove command">
        ✕
      </button>
    </>
  )
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
  const setCmd = (i: number, patch: Partial<ChatCommand>): void =>
    set(
      'chatCommands',
      s.chatCommands.map((c, j) => (j === i ? { ...c, ...patch } : c))
    )
  // Atalho repetido (entre comandos ou com o do overlay): o segundo seria ignorado ao salvar.
  const usedBefore = (i: number): string[] => [s.overlayKey, s.priceCheckKey, ...s.chatCommands.slice(0, i).map((c) => c.key)]
  const priceClash = !!s.priceCheckKey && s.priceCheckKey === s.overlayKey
  const conflict = (i: number): boolean => !!s.chatCommands[i].key && usedBefore(i).includes(s.chatCommands[i].key)

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
        alertThreshold: s.alertThreshold,
        alertCurrency: s.alertCurrency,
        alertSound: s.alertSound,
        hotkeysEnabled: s.hotkeysEnabled,
        overlayKey: s.overlayKey,
        priceCheckKey: s.priceCheckKey,
        chatCommands: s.chatCommands.filter((c) => c.command.trim())
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

          <div className="section-title">In-game overlay &amp; hotkeys</div>
          <label className="check">
            <input type="checkbox" checked={s.hotkeysEnabled} onChange={(e) => set('hotkeysEnabled', e.target.checked)} />
            <span>
              Hotkeys in game
              <div className="sub">
                Only active while Path of Exile is the focused window; every other key goes straight to the game. Works in
                windowed and windowed fullscreen, not exclusive fullscreen.
              </div>
            </span>
          </label>
          <div className="field">
            <label htmlFor="overlay-key">Show / hide Exile's Companion over the game</label>
            <HotkeyInput id="overlay-key" value={s.overlayKey} disabled={!s.hotkeysEnabled} onChange={(v) => set('overlayKey', v)} />
            <span className="hint">
              Press it in game to open this window on top of the game; press it again, press Esc or click the game to hide
              it. Closing the window keeps Exile's Companion running in the tray (alerts and auto snapshots stay on); quit from the
              tray icon.
            </span>
          </div>
          <div className="field">
            <label htmlFor="price-key">Price check</label>
            <HotkeyInput
              id="price-key"
              value={s.priceCheckKey}
              disabled={!s.hotkeysEnabled}
              invalid={priceClash}
              onChange={(v) => set('priceCheckKey', v)}
            />
            <span className="hint">
              {priceClash
                ? 'Same key as the overlay: pick another one.'
                : 'Hover an item in game and press it: the poe.ninja price shows next to the cursor, and goes away when you move the mouse. Uniques, currency, gems, maps, cards, cluster jewels, ilvl 82+ bases and more. Rares need a trade search (coming later).'}
            </span>
          </div>
          <div className="field">
            <label>Chat commands</label>
            {s.chatCommands.length > 0 && (
              <div className="cmd-table">
                <span className="head">Key</span>
                <span className="head">Command</span>
                <span />
                {s.chatCommands.map((c, i) => (
                  <ChatRow
                    key={i}
                    cmd={c}
                    disabled={!s.hotkeysEnabled}
                    conflict={conflict(i)}
                    onKey={(key) => setCmd(i, { key })}
                    onCommand={(command) => setCmd(i, { command })}
                    onRemove={() =>
                      set(
                        'chatCommands',
                        s.chatCommands.filter((_, j) => j !== i)
                      )
                    }
                  />
                ))}
              </div>
            )}
            <div>
              <button
                className="btn"
                disabled={!s.hotkeysEnabled || s.chatCommands.length >= 30}
                onClick={() => set('chatCommands', [...s.chatCommands, { key: '', command: '/' }])}
              >
                + Add command
              </button>
            </div>
            <span className="hint">
              Each key opens the chat, types the command and sends it: one action per key press, as GGG's rules for
              third-party tools require. It borrows the clipboard for a moment and then puts your text back. Examples:
              /hideout, /kingsmarch, /menagerie, /delve, /exit (back to character select). Assumes chat opens with Enter (the
              default).
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
              <div className="sub">Items with fewer than 10 listings on poe.ninja, and exchange items (cards, currency…) with fewer than 5 traded in the last 24 h, show in the table but are left out of the total.</div>
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
            <label htmlFor="alert-min">Minimum value</label>
            <div className="amount">
              <input
                id="alert-min"
                className="input"
                type="number"
                min={0.01}
                step={s.alertCurrency === 'chaos' ? 1 : 0.1}
                value={s.alertThreshold}
                disabled={!s.alertsEnabled}
                onChange={(e) => set('alertThreshold', Number(e.target.value))}
              />
              <select
                className="select"
                aria-label="Currency"
                value={s.alertCurrency}
                disabled={!s.alertsEnabled}
                onChange={(e) => set('alertCurrency', e.target.value as AlertCurrency)}
              >
                <option value="chaos">Chaos Orb</option>
                <option value="exalted">Exalted Orb</option>
                <option value="divine">Divine Orb</option>
              </select>
            </div>
            <span className="hint">
              Per item, converted with the current poe.ninja price. Stacks count only what was added (2 new divines = 2 div).
              Items are detected on each snapshot, so pair this with an automatic snapshot (every 5 minutes is a good fit).
              Shows over windowed or borderless fullscreen, not exclusive fullscreen.
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
          <button className="btn" style={{ marginLeft: 10 }} onClick={() => void window.api.quit()}>
            Quit Exile's Companion
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
