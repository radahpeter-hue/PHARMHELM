import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './contexts/AuthContext';
import { TenantProvider } from './contexts/TenantContext';
import { seedInitialData } from './services/seedService';
import { reportSystemCrash } from './utils/crashReporter';

// Global error telemetry listener for automated administrative email notifications
window.addEventListener('error', (event) => {
  const message = event.message || (event.error && event.error.message) || '';
  if (
    message.includes('WebSocket') || 
    message.includes('websocket') || 
    message.includes('vite') || 
    message.includes('HMR')
  ) {
    // Ignore benign development environment Vite HMR WebSocket errors
    return;
  }
  reportSystemCrash(event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  if (
    message.includes('WebSocket') || 
    message.includes('websocket') || 
    message.includes('vite') || 
    message.includes('HMR')
  ) {
    // Ignore benign development environment Vite HMR WebSocket errors
    return;
  }
  reportSystemCrash(event.reason || 'Unhandled Promise Rejection');
});

// Seed initial data for demo/preview purposes
seedInitialData();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TenantProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </TenantProvider>
  </StrictMode>,
);
