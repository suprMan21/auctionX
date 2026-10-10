// Entry for the public site build (`vite build --mode public`); vite.config.ts
// swaps it in for main.tsx. Keep app imports out of this file.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { PublicSite } from './PublicSite'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PublicSite />
  </StrictMode>,
)
