import { StrictMode, Component } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Catches any uncaught error anywhere below it (render, lifecycle, and effects)
// and shows a recoverable fallback instead of leaving the page blank -- without
// this, any single uncaught error (e.g. a bad sync payload) tears down the
// whole React root with no way back short of a manual refresh.
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(error: unknown) {
    console.error(error)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, fontFamily: 'sans-serif', textAlign: 'center', background: '#0F0F1A', color: '#EEE8D5' }}>
          <div style={{ fontSize: 18 }}>Something went wrong.</div>
          <div style={{ fontSize: 13, color: '#888' }}>Your data is safe -- reloading should fix it.</div>
          <button onClick={() => window.location.reload()} style={{ background: '#F0A500', color: '#000', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, cursor: 'pointer' }}>
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
