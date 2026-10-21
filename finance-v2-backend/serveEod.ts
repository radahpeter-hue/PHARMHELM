/** Independent Finance V2 API. Firebase Hosting remains a static frontend. */
import {executeAuthenticatedFinanceV2Transfer} from './authenticatedTransfer.ts';
import {readTreasury, registerTreasuryAccount} from './treasury.ts';
import {startCashFundingWorker} from './cashFundingWorker.ts';
import {initializeApp, applicationDefault} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {getAuth} from 'firebase-admin/auth';
import {executeAuthenticatedFinanceV2Eod} from './authenticatedEod.ts';
import {createFinanceHttpService, type FinanceDispatcher} from './httpService.ts';
import {financeRuntimeConfig} from './runtimeConfig.ts';

const config = financeRuntimeConfig(process.env);
let dispatch: FinanceDispatcher = async () => { throw Error('API disabled'); };
if (config.enabled) {
  // External hosts supply ADC via a protected runtime secret file. Never copy
  // service-account material into this image or the frontend.
  const app = initializeApp({credential: applicationDefault(), projectId: config.projectId});
  const db = getFirestore(app, config.databaseId);
  const auth = getAuth(app);
  startCashFundingWorker(db);
  dispatch = (action, token, input) => action === 'accounts' ? readTreasury(auth, db, token, input.tenantId as string)
    : action === 'register' ? registerTreasuryAccount(auth, db, token, input)
    : action === 'transfers' ? executeAuthenticatedFinanceV2Transfer(auth, db, token, input as any, true)
    : executeAuthenticatedFinanceV2Eod(auth, db, token, input as any);
}
const server = createFinanceHttpService(config, dispatch).listen(config.port, '0.0.0.0');
process.once('SIGTERM', () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 20000).unref();
});
