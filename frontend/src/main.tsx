import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, browserStorage, readTheme } from './lib/theme';
import './styles/global.css';

// Before the first render, so a stored theme never flashes the system one.
applyTheme(document.documentElement, readTheme(browserStorage()));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
