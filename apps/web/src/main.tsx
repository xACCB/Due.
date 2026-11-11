import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installGestureDebug } from './debugGestures'
import { initErrorReporting } from './lib/report'

// Error reports go to Sentry only when VITE_SENTRY_DSN is set, and never from
// emulator mode (src/lib/report.ts).
initErrorReporting(import.meta.env.VITE_FIREBASE_EMULATORS === '1' ? undefined : import.meta.env.VITE_SENTRY_DSN, __APP_VERSION__, import.meta.env.MODE)
installGestureDebug()
// Development only: the screen-comparison remote (src/devRemote.ts). Never in a build.
if (import.meta.env.DEV && import.meta.env.VITE_DEV_REMOTE === '1') import('./devRemote').then(m => m.startDevRemote())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
