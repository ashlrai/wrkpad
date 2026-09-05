import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import CompactDeckApp from './CompactDeckApp'
import './CompactDeck.css'

createRoot(document.getElementById('compact-root')!).render(
  <StrictMode>
    <CompactDeckApp />
  </StrictMode>,
)
