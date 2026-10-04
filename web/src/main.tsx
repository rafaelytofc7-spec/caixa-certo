import { createRoot } from 'react-dom/client';
import '@fontsource/dm-sans/300.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import './styles.css';
import { App } from './App';
import { AppProvider } from './ctx';
import { initPwa } from './pwa';

// antes do React: o Chrome pode disparar "beforeinstallprompt" logo no carregamento
initPwa();
createRoot(document.getElementById('root')!).render(<AppProvider><App /></AppProvider>);
