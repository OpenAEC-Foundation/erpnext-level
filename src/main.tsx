import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initInstances, loadFromVault } from './lib/instances'

// Ensure active instance credentials are loaded
initInstances()

// Load encrypted credentials from vault (async, non-blocking)
loadFromVault()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
