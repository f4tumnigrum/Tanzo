import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { systemClient } from './platform/electron/system-client'
import App from './App'

const root = document.documentElement
const platformInfo = systemClient.platformInfo()
const platform = platformInfo?.platform ?? 'unknown'
const effect = platformInfo?.effect ?? null

root.classList.add('electron', `platform-${platform}`)
if (effect) root.dataset.windowEffect = effect

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
