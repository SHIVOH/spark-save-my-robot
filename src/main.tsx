import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'

// No StrictMode: it double-runs canvas effects (see react-dev guide).
// Basename follows where the app is served: '/' locally and on the preview,
// '/spark-save-my-robot' on GitHub Pages — derived from the page URL so one
// build works everywhere.
const basename = new URL(document.baseURI).pathname.replace(/\/$/, '') || '/'
createRoot(document.getElementById('root')!).render(
  <BrowserRouter basename={basename}>
    <App />
  </BrowserRouter>,
)
