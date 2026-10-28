/** Owner-authorised staff-number-only migration. Default is read-only. */
import { createRequire } from 'node:module';
import { executeStaffIdentityBackfill } from './staff-identity-backfill-execute.mjs';
const projectId='gen-lang-client-0911422817',databaseId='ai-studio-f7d8654b-e089-425a-a506-38159afe1e75',tenantId='zehqTDcKyrDAOHKK3stJ';
if(process.env.FIRESTORE_EMULATOR_HOST)throw new Error('Unexpected migration target.');
const require=createRequire(process.env.STAFF_BACKFILL_RUNTIME || '/tmp/staff-backfill-runtime/package.json');
const {initializeApp,applicationDefault,deleteApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const app=initializeApp({credential:applicationDefault(),projectId},'martin-staff-backfill');
try {
 const db=getFirestore(app,databaseId);
 if((await db.collection('tenants').doc(tenantId).get()).data()?.slug!=='mp')throw new Error('Martin Pharma tenant verification failed.');
 const apply=process.argv.includes('--apply');
 const summary=await executeStaffIdentityBackfill(db,tenantId,apply);
 console.log(JSON.stringify({mode:apply?'STAFF_IDENTITY_BACKFILL_APPLIED':'READ_ONLY_STAFF_IDENTITY_PLAN',...summary,financialCollectionsChanged:false,personalFieldsChanged:false,existingCodesChanged:false,internalIdsChanged:false}));
} catch(error) {console.error('Staff numbering stopped:',error.code||error.message);process.exitCode=1;}
finally {await deleteApp(app);}
