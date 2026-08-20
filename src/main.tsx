import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './index.css'
import App from './App.tsx'
import { Portao, ProvedorAcesso } from './ui/Acesso.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProvedorAcesso>
      <Portao>
        <App />
      </Portao>
    </ProvedorAcesso>
  </StrictMode>,
)
