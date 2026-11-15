import { safeStorage } from 'electron'
import { readFile, rm, writeFile } from 'node:fs/promises'

/**
 * Arquivo criptografado com a API do sistema (DPAPI no Windows, Keychain no macOS,
 * libsecret no Linux) via safeStorage. Sem criptografia de verdade disponível, nada é gravado.
 */
export class SecureFile {
  private ok: boolean | null = null

  constructor(private readonly file: string) {}

  async available(): Promise<boolean> {
    if (this.ok === null) {
      let ok = await safeStorage.isAsyncEncryptionAvailable().catch(() => false)
      // No Linux sem chaveiro o Electron cai para 'basic_text', que não protege nada.
      if (ok && process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') ok = false
      this.ok = ok
    }
    return this.ok
  }

  get isAvailable(): boolean {
    return this.ok === true
  }

  async read(): Promise<{ text: string; reencrypt: boolean } | null> {
    if (!(await this.available())) return null
    try {
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(await readFile(this.file))
      return { text: result, reencrypt: shouldReEncrypt }
    } catch {
      return null
    }
  }

  async write(text: string): Promise<boolean> {
    if (!(await this.available())) return false
    await writeFile(this.file, await safeStorage.encryptStringAsync(text), { mode: 0o600 })
    return true
  }

  async remove(): Promise<void> {
    await rm(this.file, { force: true })
  }
}
