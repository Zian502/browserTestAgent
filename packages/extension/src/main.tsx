import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Panel } from './panel/Panel'
import "./normalize.css";

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Panel />
  </StrictMode>,
)
