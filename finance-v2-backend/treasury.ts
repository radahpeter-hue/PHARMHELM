import type {Auth} from 'firebase-admin/auth';
import type {Firestore} from 'firebase-admin/firestore';
import {planFinanceV2AccountRegistration,financeV2AccountDocumentId} from '../src/services/financeV2AccountRegistryPolicy';

export async function treasuryAccess(auth:Pick<Auth,'verifyIdToken'>,db:Firestore,token:string,tenantId:string){
 if(!/^[A-Za-z0-9_-]{1,150}$/.test(tenantId))throw new Error('Invalid tenant');
 const identity=await auth.verifyIdToken(token,true);
 const staff=(await db.doc(`staff/${identity.uid}`).get()).data();
 const roles=[staff?.role,...(Array.isArray(staff?.secondaryRoles)?staff.secondaryRoles:[])];
 if(!staff||staff.tenantId!==tenantId||staff.active!==true||staff.status!=='active'||!roles.some(r=>['Finance Head','Finance Officer','Accountant'].includes(r)))throw new Error('Finance access denied');
 const [controls,tenant]=await Promise.all([db.doc(`system_settings/${tenantId}`).get(),db.doc(`tenants/${tenantId}`).get()]);
 if(controls.data()?.financeV2TrustedTransfersEnabled!==true||!tenant.exists||tenant.data()?.status==='suspended')throw new Error('Finance V2 unavailable');
 const wide=roles.includes('Finance Head');
 const branches=[staff.branch_id,staff.default_branch_id,...(Array.isArray(staff.assigned_branches)?staff.assigned_branches:[])].filter(v=>typeof v==='string');
 return {uid:identity.uid,wide,branches,controls:controls.data()!,allows:(a:Record<string,any>)=>wide||(typeof a.branchId==='string'&&branches.includes(a.branchId))};
}
export async function readTreasury(auth:Pick<Auth,'verifyIdToken'>,db:Firestore,token:string,tenantId:string){
 const access=await treasuryAccess(auth,db,token,tenantId);
 const accountDocs=await db.collection('finance_payment_accounts').where('tenantId','==',tenantId).get();
 const accounts=accountDocs.docs.map(d=>d.data()).filter(access.allows).map(a=>({tenantId:a.tenantId,accountId:a.accountId,name:a.name,kind:a.kind,branchId:a.branchId??null,currency:a.currency,balanceUGX:a.balanceUGX,controlVersion:a.controlVersion,initialized:a.initialized,active:a.active,updatedAt:typeof a.updatedAt==='string'?a.updatedAt:null}));
 const ids=new Set(accounts.map(a=>a.accountId));
 const transfers=await db.collection('finance_v2_transfers').where('tenantId','==',tenantId).get();
 const history=transfers.docs.map(d=>({id:d.id,...d.data()} as Record<string,any>)).filter(t=>[t.sourceAccountId,t.destinationAccountId,t.chargePayerAccountId].every(id=>ids.has(id))).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,200);
 return {accounts,history,canRegister:access.wide&&access.controls.financeV2AccountRegistrationEnabled===true};
}
export async function registerTreasuryAccount(auth:Pick<Auth,'verifyIdToken'>,db:Firestore,token:string,input:any){
 const access=await treasuryAccess(auth,db,token,input.tenantId);
 if(!access.wide||access.controls.financeV2AccountRegistrationEnabled!==true)throw new Error('Registration disabled');
 const record=planFinanceV2AccountRegistration({...input,actorUid:access.uid,openingBalanceUGX:0});
 if(input.openingBalanceUGX!==0)throw new Error('Only zero opening accounts permitted');
 if(record.branchId){const branch=await db.doc(`branches/${record.branchId}`).get();if(branch.data()?.tenantId!==input.tenantId)throw new Error('Invalid branch');}
 const id=financeV2AccountDocumentId(record.tenantId,record.accountId);
 await db.doc(`finance_payment_accounts/${id}`).create({...record,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
 return {accountId:record.accountId};
}
