/** Read-only pilot deployment inventory. Never enables APIs, billing or posting. */
import {applicationDefault,initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {writeFileSync} from 'node:fs';
const project='gen-lang-client-0911422817',database='ai-studio-f7d8654b-e089-425a-a506-38159afe1e75';
const credential=applicationDefault();
const token=(await credential.getAccessToken()).access_token;
async function request(url:string,body?:unknown){
 const response=await fetch(url,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 const data=await response.json().catch(()=>({}));return {ok:response.ok,status:response.status,data};
}
const app=initializeApp({credential,projectId:project});
try{
 const [billing,dbInfo,...services]=await Promise.all([
  request(`https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`),
  request(`https://firestore.googleapis.com/v1/projects/${project}/databases/${database}`),
  ...['run.googleapis.com','artifactregistry.googleapis.com','cloudbuild.googleapis.com','iam.googleapis.com'].map(s=>request(`https://serviceusage.googleapis.com/v1/projects/${project}/services/${s}`))
 ]);
 const permissions=await request(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}:testIamPermissions`,{permissions:['run.services.create','run.services.update','run.services.get','run.services.setIamPolicy','iam.serviceAccounts.create','iam.serviceAccounts.actAs','resourcemanager.projects.setIamPolicy','artifactregistry.repositories.create','artifactregistry.repositories.uploadArtifacts']});
 const db=getFirestore(app,database);
 const tenantRows=await db.collection('tenants').where('slug','==','mp').get();
 let tenant:any={resolved:false};
 if(tenantRows.size===1){
  const t=tenantRows.docs[0],controls=(await db.doc('system_settings/'+t.id).get()).data()??{};
  const branches=await db.collection('branches').where('tenantId','==',t.id).get();
  tenant={resolved:true,id:t.id,status:t.data().status,masakaBranches:branches.docs.filter(b=>String(b.data().name??'').toLowerCase().includes('masaka')).map(b=>({id:b.id,status:b.data().status})),financeControls:Object.fromEntries(['financeV2TrustedTransfersEnabled','financeV2AccountRegistrationEnabled','financeV2TrustedEodEnabled','financeV2PosCashFundingEnabled'].map(k=>[k,controls[k]===true]))};
 }
 const region=dbInfo.data.locationId?.startsWith('eur')?'europe-west1':dbInfo.data.locationId?.startsWith('nam')?'us-central1':dbInfo.data.locationId||'us-central1';
 const run=await request(`https://run.googleapis.com/v2/projects/${project}/locations/${region}/services`);
 const report={mode:'READ_ONLY_FINANCE_V2_DEPLOYMENT_PREFLIGHT',project,database,billing:{readable:billing.ok,httpStatus:billing.status,enabled:billing.ok?billing.data.billingEnabled===true:null},databaseAccess:{readable:dbInfo.ok,httpStatus:dbInfo.status,location:dbInfo.data.locationId??null},tenant,services:Object.fromEntries(['run.googleapis.com','artifactregistry.googleapis.com','cloudbuild.googleapis.com','iam.googleapis.com'].map((name,i)=>[name,{readable:services[i].ok,httpStatus:services[i].status,state:services[i].data.state??null}])),permissions:{readable:permissions.ok,granted:permissions.data.permissions??[]},region,existingRuntimeServices:run.ok?(run.data.services??[]).map((s:any)=>({name:s.name,uri:s.uri})):[],runtimeInspectionStatus:run.status,mutationsPerformed:false};
 writeFileSync('finance-v2-deployment-preflight.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await deleteApp(app);}
