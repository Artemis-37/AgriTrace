import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><AuthProvider><App /></AuthProvider></BrowserRouter></StrictMode>,
);

try { const t = localStorage.getItem('agritrace.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'doux'); document.documentElement.dataset.theme = t; } catch { /* thème par défaut */ }
