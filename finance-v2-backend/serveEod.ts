/**
 * Dedicated Finance V2 EOD API server, deployed independently of Firebase Hosting.
 * Requires FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID, ALLOWED_ORIGIN,
 * FINANCE_V2_EOD_API_ENABLED=true and service-account/ADC credentials.
 * Calls are still gated per tenant inside executeAuthenticatedFinanceV2Eod.
 */
import { createServer } from 'node:http';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { executeAuthenticatedFinanceV2Eod } from './authenticatedEod.ts';

const port = Number(process.env.PORT || 8080);
const origin = process.env.ALLOWED_ORIGIN;
const projectId = process.env.FIREBASE_PROJECT_ID;
const databaseId = process.env.FIRESTORE_DATABASE_ID;
if (process.env.FINANCE_V2_EOD_API_ENABLED !== 'true' || !origin || !projectId || !databaseId)
  throw new Error('Trusted EOD service must have explicit release configuration');
if (!Number.isInteger(port) || port <= 0) throw new Error('Invalid PORT');
const app = initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore(app, databaseId);
const auth = getAuth(app);

createServer(async (req, res) => {
  const requestOrigin = req.headers.origin;
  if (requestOrigin && requestOrigin !== origin) {
    res.writeHead(403); res.end(); return;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.url !== '/api/finance-v2/eod' || req.method !== 'POST') {
    res.writeHead(404); res.end(); return;
  }
  const bearer = req.headers.authorization || '';
  if (!bearer.startsWith('Bearer ') || bearer.length > 8192) {
    res.writeHead(401); res.end(); return;
  }
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8192) throw new Error('Payload exceeds maximum size');
      chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const result = await executeAuthenticatedFinanceV2Eod(auth, db, bearer.slice(7), input);
    res.writeHead(result.replayed ? 200 : 201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (error) {
    console.error('EOD request rejected:', error instanceof Error ? error.message : 'Unknown');
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'EOD submission rejected' }));
  }
}).listen(port, '0.0.0.0');
