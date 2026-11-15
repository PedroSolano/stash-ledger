import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Frontend do Tauri: servido em 127.0.0.1:5173 no dev e gerado em dist-web no build.
export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  clearScreen: false,
  envPrefix: ['VITE_'],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: '../../dist-web', emptyOutDir: true, target: 'es2022', sourcemap: false }
})
