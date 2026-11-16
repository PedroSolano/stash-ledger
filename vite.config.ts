import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Frontend do Tauri: servido em 127.0.0.1:5173 no dev e gerado em dist-web no build.
export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  clearScreen: false,
  envPrefix: ['VITE_'],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: {
    outDir: '../../dist-web',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    // Duas páginas: o app e o overlay de alerta (janela separada, criada só quando há alerta).
    rollupOptions: {
      // Relativo à pasta do projeto (os scripts npm e o Tauri rodam o build a partir dela).
      input: { main: 'src/renderer/index.html', overlay: 'src/renderer/overlay.html' }
    }
  }
})
