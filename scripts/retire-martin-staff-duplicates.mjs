import {createRequire} from 'node:module';
import {retireStaffDuplicates} from './retire-staff-duplicates-core.mjs';
const require=createRequire('/tmp/staff-backfill-runtime/package.json');
const {initializeApp,applicationDefault,deleteApp}=require('firebase-admin/app');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');const {getAuth}=require('firebase-admin/auth');
if(process.env.FIRESTORE_EMULATOR_HOST)throw new Error('Unexpected release target.');
const app=initializeApp({credential:applicationDefault(),projectId:'gen-lang-client-0911422817'},'retire-martin-staff');
try{const db=getFirestore(app,'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75'),tenantId='zehqTDcKyrDAOHKK3stJ';
 if((await db.collection('tenants').doc(tenantId).get()).data()?.slug!=='mp')throw new Error('Unexpected tenant');
 console.log(JSON.stringify(await retireStaffDuplicates(db,getAuth(app),tenantId,{apply:process.argv.includes('--apply'),deleteField:()=>FieldValue.delete()})));
}finally{await deleteApp(app);}
