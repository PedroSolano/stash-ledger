import type { AuthStatus } from '../../shared/types'
import { normalizeAccountName, normalizePoesessid, type LegacyCreds } from '../poe/legacyApi'
import { SecureFile } from './secureFile'

/**
 * Guarda o POESESSID + nome da conta. O cookie dá acesso total à conta no site, então:
 * fica só no processo principal, criptografado em disco (ou só na memória, sem criptografia),
 * nunca vai para a interface e só é enviado para www.pathofexile.com.
 */
export class SessionAuth {
  private creds: LegacyCreds | null = null
  private readonly store: SecureFile

  constructor(file: string) {
    this.store = new SecureFile(file)
  }

  async load(): Promise<void> {
    const saved = await this.store.read()
    if (!saved) return
    try {
      const raw = JSON.parse(saved.text) as LegacyCreds
      this.creds = { poesessid: normalizePoesessid(raw.poesessid), accountName: normalizeAccountName(raw.accountName) }
      if (saved.reencrypt) await this.store.write(JSON.stringify(this.creds))
    } catch {
      this.creds = null
      await this.store.remove()
    }
  }

  status(): AuthStatus {
    return this.creds ? { loggedIn: true, method: 'session', username: this.creds.accountName } : { loggedIn: false }
  }

  get(): LegacyCreds | null {
    return this.creds
  }

  /** Chamar só depois de validar as credenciais com uma requisição bem-sucedida. */
  async set(creds: LegacyCreds): Promise<void> {
    this.creds = creds
    await this.store.write(JSON.stringify(creds))
  }

  async clear(): Promise<void> {
    this.creds = null
    await this.store.remove()
  }
}
