import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * Em produção a CSP do index.html é estrita. No `dev`, o Vite precisa de script inline
 * (preâmbulo do React Refresh) e de WebSocket para o HMR, então afrouxamos só nesse modo.
 */
function devCsp(): Plugin {
  return {
    name: 'stash-ledger-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
        .replace("connect-src 'none'", "connect-src 'self' ws: http://localhost:*")
    }
  }
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), devCsp()]
  }
})
