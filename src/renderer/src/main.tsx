import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fontes livres (OFL), empacotadas no app: Cinzel para títulos, Alegreya SC (versalete) para a UI,
// Alegreya Sans para texto corrido e números. Só o subconjunto latino (cobre o português).
import '@fontsource/cinzel/latin-600.css'
import '@fontsource/cinzel/latin-700.css'
import '@fontsource/alegreya-sc/latin-400.css'
import '@fontsource/alegreya-sc/latin-500.css'
import '@fontsource/alegreya-sc/latin-700.css'
import '@fontsource/alegreya-sans/latin-400.css'
import '@fontsource/alegreya-sans/latin-500.css'
import '@fontsource/alegreya-sans/latin-700.css'
import { App } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
