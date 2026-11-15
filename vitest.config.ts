import { defineConfig } from 'vitest/config'

// Testes do motor de preços e do controller (TypeScript). Os do backend rodam com `npm run test:rust`.
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] }
})
