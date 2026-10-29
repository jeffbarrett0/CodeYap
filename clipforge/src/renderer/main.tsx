import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { getApi, requireApi } from './api'
import { useStore } from './store'
import './styles.css'

// Pencerenin herhangi bir yerine bırakılan dosya sayfayı yönlendirmesin; medya dosyaları içe aktarılır.
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => {
  e.preventDefault()
  const files = [...(e.dataTransfer?.files ?? [])]
  if (files.length === 0) return
  const api = requireApi()
  void useStore.getState().importPaths(files.map((f) => api.pathForFile(f)).filter(Boolean))
})

void getApi().then(() => {
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
})
