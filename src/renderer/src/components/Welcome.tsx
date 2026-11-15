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
        <label htmlFor="acc">Nome da conta</label>
        <input
          id="acc"
          className="input"
          placeholder="SeuNome#1234"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          spellCheck={false}
          autoFocus
        />
        <span className="hint">
          {noTag
            ? 'Inclua o #1234 do final do nome, como aparece no seu perfil em pathofexile.com.'
            : 'Exatamente como aparece no seu perfil em pathofexile.com, com o #1234.'}
        </span>
      </div>
      <div className="field">
        <label htmlFor="sess">POESESSID</label>
        <input
          id="sess"
          className="input"
          type="password"
          placeholder="32 caracteres hexadecimais"
          value={sessid}
          onChange={(e) => setSessid(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <span className="hint">
          No navegador, logado em pathofexile.com: F12 → Aplicativo (Application) → Cookies → https://www.pathofexile.com →
          copie o valor de <code>POESESSID</code>.
          {sessid && !sessOk ? ' O valor colado não tem o formato esperado.' : ''}
        </span>
      </div>
      <div className="banner info">
        <div>
          <strong>Antes de colar, saiba:</strong>
          <ul>
            <li>
              O POESESSID dá acesso <strong>total</strong> à sua conta no site. Nunca compartilhe. O app guarda ele
              criptografado neste computador e só o envia para www.pathofexile.com.
            </li>
            <li>Para invalidar o cookie a qualquer momento, saia da conta no site ("Sign Out").</li>
            <li>
              Este modo usa um endpoint antigo do site, fora da API oficial. A GGG tolera ferramentas assim há anos, mas
              pode mudá-lo ou bloqueá-lo sem aviso.
            </li>
          </ul>
        </div>
      </div>
      <div className="actions" style={{ marginTop: 16 }}>
        <button className="btn primary big" type="submit" disabled={!sessOk || !accOk || busy}>
          {busy ? 'Validando com a GGG…' : 'Validar e entrar'}
        </button>
        <button className="btn ghost" type="button" onClick={onBack} disabled={busy}>
          Voltar
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
        <p className="lead">
          Quanto vale a sua stash, com os preços do poe.ninja. Tudo roda no seu computador, sem servidor no meio.
        </p>

        {sessionMode ? (
          <SessionForm busy={busy === 'session'} onSubmit={onSessionLogin} onBack={() => setSessionMode(false)} />
        ) : (
          <div className="actions">
            {busy === 'login' ? (
              <>
                <button className="btn primary big" disabled>
                  Aguardando autorização no navegador…
                </button>
                <button className="btn ghost" onClick={onCancelLogin}>
                  Cancelar
                </button>
              </>
            ) : configured ? (
              <button className="btn primary big" onClick={onLogin} disabled={busy !== null}>
                Entrar com a conta do Path of Exile
              </button>
            ) : null}
            <button
              className={`btn big ${configured ? '' : 'primary'}`}
              onClick={() => setSessionMode(true)}
              disabled={busy !== null}
            >
              Entrar com POESESSID
            </button>
            <button className="btn big" onClick={onDemo} disabled={busy !== null}>
              {busy === 'demo' ? 'Carregando preços…' : 'Explorar no modo demonstração'}
            </button>
            <button className="btn ghost" onClick={onSettings}>
              Configurações
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
              <strong>Login oficial (OAuth) indisponível por enquanto.</strong> Ele exige um app registrado na GGG, que no
              momento não está aceitando novos registros. Quando tiver um Client ID, coloque-o em Configurações e o botão
              de login oficial aparece aqui. Até lá, use o POESESSID ou o modo demonstração.
            </div>
          </div>
        )}
      </div>
      <div className="disclaimer">
        Este produto não é afiliado nem endossado pela Grinding Gear Games. Preços: poe.ninja.
      </div>
    </div>
  )
}
