import { defineConfig } from 'vitest/config'
import { APT_ALIAS } from './vite.config'

// Testes do motor de preços, do controller e do price check (TypeScript).
// Os do backend rodam com `npm run test:rust`.
export default defineConfig({
  resolve: { alias: APT_ALIAS },
  test: { include: ['tests/**/*.test.ts'] }
})
