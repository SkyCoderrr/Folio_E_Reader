import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';
async function start() {
  if (import.meta.env.DEV && !('__TAURI_INTERNALS__' in window)) {
    const { installMocks } = await import('./ipc/mocks');
    installMocks();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void start();
