import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Código portado do Awakened PoE Trade importa como '@/parser', '@/assets/data'… */
export const APT_ALIAS = { '@': fileURLToPath(new URL('./src/trade/apt', import.meta.url)) }

// Frontend do Tauri: servido em 127.0.0.1:5173 no dev e gerado em dist-web no build.
export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  clearScreen: false,
  envPrefix: ['VITE_'],
  resolve: { alias: APT_ALIAS },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: {
    outDir: '../../dist-web',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    // Três páginas: o app, o overlay de alerta e o price check (janelas separadas).
    rollupOptions: {
      // Relativo à pasta do projeto (os scripts npm e o Tauri rodam o build a partir dela).
      input: {
        main: 'src/renderer/index.html',
        overlay: 'src/renderer/overlay.html',
        pricecheck: 'src/renderer/pricecheck.html'
      }
    }
  }
})
