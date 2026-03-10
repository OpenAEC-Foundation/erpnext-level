import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initInstances, loadInstancesFromBackend } from './lib/instances'

// Load instance list from localStorage cache for instant render
initInstances()

// Then load from backend and re-render
loadInstancesFromBackend().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
