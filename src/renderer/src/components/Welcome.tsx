import { useState, type FormEvent } from 'react'

type Busy = 'login' | 'session' | 'demo' | null

interface Props {
  configured: boolean
  busy: Busy
  error: string | null
  onLogin: () => void
  onCancelLogin: () => void
  onSessionLogin: (accountName: string, poesessid: string) => Promise<boolean>
  onDemo: () => void
  onSettings: () => void
}

function SessionForm({ busy, onSubmit, onBack }: { busy: boolean; onSubmit: Props['onSessionLogin']; onBack: () => void }) {
  const [account, setAccount] = useState('')
  const [sessid, setSessid] = useState('')
  const sessOk = /^[0-9a-f]{32}$/i.test(sessid.trim())
  const accOk = account.trim().length >= 2
  const noTag = accOk && !/#\d{4}$/.test(account.trim())

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!sessOk || !accOk) return
    const ok = await onSubmit(account.trim(), sessid.trim())
    // O cookie não fica na interface: some do campo assim que é enviado ao processo principal.
    if (ok) setSessid('')
  }

  return (
    <form className="session-form" onSubmit={submit} autoComplete="off">
      <div className="field">
        <label htmlFor="acc">Account name</label>
        <input
          id="acc"
          className="input"
          placeholder="YourName#1234"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          spellCheck={false}
          autoFocus
        />
        <span className="hint">
          {noTag
            ? 'Include the #1234 at the end, as shown on your pathofexile.com profile.'
            : 'Exactly as shown on your pathofexile.com profile, including the #1234.'}
        </span>
      </div>
      <div className="field">
        <label htmlFor="sess">POESESSID</label>
        <input
          id="sess"
          className="input"
          type="password"
          placeholder="32 hexadecimal characters"
          value={sessid}
          onChange={(e) => setSessid(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <span className="hint">
          In your browser, logged in to pathofexile.com: F12 → Application → Cookies → https://www.pathofexile.com → copy
          the value of <code>POESESSID</code>.
          {sessid && !sessOk ? ' The pasted value does not look right.' : ''}
        </span>
      </div>
      <div className="banner info">
        <div>
          <strong>Before you paste it:</strong>
          <ul>
            <li>
              Your POESESSID gives <strong>full</strong> access to your account on the website. Never share it. The app
              stores it encrypted on this computer and only sends it to www.pathofexile.com.
            </li>
            <li>To invalidate it at any time, sign out of the website.</li>
            <li>
              This mode uses a legacy website endpoint, outside the official API. GGG has tolerated tools like this for
              years, but it may change or block it without notice.
            </li>
          </ul>
        </div>
      </div>
      <div className="actions" style={{ marginTop: 16 }}>
        <button className="btn primary big" type="submit" disabled={!sessOk || !accOk || busy}>
          {busy ? 'Checking with GGG…' : 'Verify and sign in'}
        </button>
        <button className="btn ghost" type="button" onClick={onBack} disabled={busy}>
          Back
        </button>
      </div>
    </form>
  )
}

export function Welcome({ configured, busy, error, onLogin, onCancelLogin, onSessionLogin, onDemo, onSettings }: Props) {
  const [sessionMode, setSessionMode] = useState(false)

  return (
    <div className="welcome">
      <div className="frame welcome-card">
        <div className="brand-mark">
          <span>S</span>
        </div>
        <h1>Stash Ledger</h1>
        <div className="ornament" />
        <p className="lead">See what your stash is worth with poe.ninja prices. Everything runs on your computer, no server in between.</p>

        {sessionMode ? (
          <SessionForm busy={busy === 'session'} onSubmit={onSessionLogin} onBack={() => setSessionMode(false)} />
        ) : (
          <div className="actions">
            {busy === 'login' ? (
              <>
                <button className="btn primary big" disabled>
                  Waiting for authorization in your browser…
                </button>
                <button className="btn ghost" onClick={onCancelLogin}>
                  Cancel
                </button>
              </>
            ) : configured ? (
              <button className="btn primary big" onClick={onLogin} disabled={busy !== null}>
                Sign in with Path of Exile
              </button>
            ) : null}
            <button className={`btn big ${configured ? '' : 'primary'}`} onClick={() => setSessionMode(true)} disabled={busy !== null}>
              Sign in with POESESSID
            </button>
            <button className="btn big" onClick={onDemo} disabled={busy !== null}>
              {busy === 'demo' ? 'Loading prices…' : 'Try demo mode'}
            </button>
            <button className="btn ghost" onClick={onSettings}>
              Settings
            </button>
          </div>
        )}

        {error && (
          <div className="banner note" role="alert">
            {error}
          </div>
        )}

        {!configured && !sessionMode && (
          <div className="banner info note">
            <div>
              <strong>Official sign-in (OAuth) is not available yet.</strong> It requires an app registered with GGG, and
              GGG is currently not accepting new applications. Once you have a Client ID, add it in Settings and the
              official sign-in button will show up here. Until then, use POESESSID or demo mode.
            </div>
          </div>
        )}
      </div>
      <div className="disclaimer">This product isn't affiliated with or endorsed by Grinding Gear Games in any way. Prices: poe.ninja.</div>
    </div>
  )
}
