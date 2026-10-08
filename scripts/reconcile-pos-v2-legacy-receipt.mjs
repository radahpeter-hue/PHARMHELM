import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { reconcileLegacyReceipt } from './pos-v2-legacy-receipt-repair-core.mjs';
const app = initializeApp({ credential: applicationDefault(), projectId: 'gen-lang-client-0911422817' });
const db = getFirestore(app, 'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75');
const actor = `github-actions-legacy-reconciliation-${process.env.GITHUB_RUN_ID || 'manual'}`;
console.log(JSON.stringify(await reconcileLegacyReceipt({ db, FieldValue, actor }), null, 2));
if (process.argv.includes('--apply')) {
  console.log(JSON.stringify(await reconcileLegacyReceipt({ db, FieldValue, actor, apply: true }), null, 2));
  console.log(JSON.stringify(await reconcileLegacyReceipt({ db, FieldValue, actor, apply: true }), null, 2));
}
