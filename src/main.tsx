import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/orbitron/wght.css';
import '@fontsource/chakra-petch/latin-500.css';
import '@fontsource/chakra-petch/latin-600.css';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
