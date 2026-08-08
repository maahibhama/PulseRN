import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

if (!window.pulseRN) {
  const { createWebPulseRNClient } = await import('./web-client.js');
  window.pulseRN = createWebPulseRNClient();
  window.pulseRNRuntime = 'web';
} else {
  window.pulseRNRuntime = 'electron';
}

const root = document.getElementById('root');
if (!root) throw new Error('Renderer root element is missing.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
