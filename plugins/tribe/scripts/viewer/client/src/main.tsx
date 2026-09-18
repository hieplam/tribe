// client/src/main.tsx — the Vite entry (spec §3.1). Mounts the React app onto index.html's
// `#root`, after the one stylesheet that imports the owner's design tokens (D18).
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles/index.css';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root element is missing from index.html');
}

createRoot(container).render(<App />);
