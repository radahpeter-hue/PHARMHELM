// Centralized environment and domain configuration for PharmHelm Pro ERP
import firebaseConfig from '../firebase-applet-config.json';

// Detect if running in production or development/staging
export const IS_PRODUCTION = (import.meta as any).env.PROD;
export const IS_STAGING = !IS_PRODUCTION;

// Production domain definitions
export const TMC_DOMAIN = 'pharmhelm.com';

// Firebase configuration parameters
export const FIREBASE_APP_CONFIG = firebaseConfig;

// Lockout policy limits
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
