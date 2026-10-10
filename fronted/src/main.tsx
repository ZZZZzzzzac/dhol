import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import DesktopApp from './desktop/DesktopApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DesktopApp />
  </StrictMode>,
)
