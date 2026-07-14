import { collection, addDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';

export interface CrashReport {
  id?: string;
  error: string;
  stack?: string;
  location: string;
  userEmail?: string;
  tenantId?: string;
  timestamp: string;
  emailDispatchedTo?: string;
}

/**
 * Capture and report a system crash or critical exception.
 * Stores historically in Firestore collection 'system_crashes' and invokes backend SMTP notifier.
 */
export async function reportSystemCrash(error: unknown, componentStack?: string) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : (componentStack || 'No stack trace recorded.');
  
  // Clean values from localStorage or Firebase Session
  const username = localStorage.getItem('auth_username') || auth.currentUser?.email || 'Anonymous Session';
  const tenantSlug = localStorage.getItem('tenant_slug') || 'HQ Platform';

  const payload: CrashReport = {
    error: errorMessage,
    stack: errorStack,
    location: window.location.pathname + window.location.search,
    userEmail: username,
    tenantId: tenantSlug,
    timestamp: new Date().toISOString(),
    emailDispatchedTo: 'peterssentongo61@gmail.com'
  };

  try {
    // 1. Record historically in Firestore
    await addDoc(collection(db, 'system_crashes'), payload);
    
    // 2. Post to backend proxy to trigger immediate console warning and simulated SMTP email alerts
    await fetch('/api/monitor/report-crash', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    console.warn(`[Sentinel Monitoring] Crash reported successfully. E-mail notification dispatched to peterssentongo61@gmail.com`);
  } catch (err) {
    console.error('Failed to dispatch crash report to Sentinel:', err);
  }
}
