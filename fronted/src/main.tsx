import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { retireLegacyBrowserStorage } from './legacy-session-cleanup'

try { retireLegacyBrowserStorage(window.localStorage) } catch { /* storage may be unavailable */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
