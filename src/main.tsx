import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { consumeSharedDesign, windowNavigation } from '@/store/sharedDesign.ts'

// Before the first render, so a shared link opens on its own design rather
// than painting the default building and swapping it a frame later.
consumeSharedDesign(windowNavigation())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
