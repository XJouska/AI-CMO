import { createRoot } from 'react-dom/client'
import App from './App.tsx'

document.documentElement.setAttribute('data-theme', localStorage.getItem('theme') || 'light');

createRoot(document.getElementById('root')!).render(<App />)
