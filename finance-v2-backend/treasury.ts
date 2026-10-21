import {branchCashAccountId,refreshBranchCash} from './posCashFunding';
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
 const scoped=accountDocs.docs.filter(d=>access.allows(d.data()));
 const refreshed=await Promise.all(scoped.map(async d=>{const a=d.data();if(a.kind!=='BRANCH_CASH_SALES'||a.controlVersion!==2)return a;try{return {...await refreshBranchCash(db,d.id,access.uid),cashFundingStatus:'current',balanceAvailable:true};}catch(e){return {...a,balanceAvailable:false,cashFundingStatus:'blocked',cashFundingError:e instanceof Error?e.message:'Cash verification failed'};}}));
 const accounts=refreshed.map(a=>({balanceAvailable:a.balanceAvailable!==false,cashFundingStatus:a.cashFundingStatus??null,cashFundingError:a.cashFundingError??null,posCashCheckedAt:a.posCashCheckedAt??null,tenantId:a.tenantId,accountId:a.accountId,name:a.name,kind:a.kind,branchId:a.branchId??null,currency:a.currency,balanceUGX:a.balanceUGX,controlVersion:a.controlVersion,initialized:a.initialized,active:a.active,updatedAt:typeof a.updatedAt==='string'?a.updatedAt:null}));
 const ids=new Set(accounts.map(a=>a.accountId));
 const transfers=await db.collection('finance_v2_transfers').where('tenantId','==',tenantId).get();
 const history=transfers.docs.map(d=>({id:d.id,...d.data()} as Record<string,any>)).filter(t=>[t.sourceAccountId,t.destinationAccountId,t.chargePayerAccountId].every(id=>ids.has(id))).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,200);
 const cashEvents=await db.collection('finance_v2_events').where('tenantId','==',tenantId).where('eventKind','==','POS_CASH_LOCATION_POSTING').get();
 const fundingHistory=cashEvents.docs.map(d=>({id:d.id,...d.data()} as Record<string,any>)).filter(e=>ids.has(e.accountId)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,100);
 return {accounts,history,fundingHistory,canRegister:access.wide&&access.controls.financeV2AccountRegistrationEnabled===true};
}
export async function registerTreasuryAccount(auth:Pick<Auth,'verifyIdToken'>,db:Firestore,token:string,input:any){
 const access=await treasuryAccess(auth,db,token,input.tenantId);
 if(!access.wide||access.controls.financeV2AccountRegistrationEnabled!==true)throw new Error('Registration disabled');
 let record=planFinanceV2AccountRegistration({...input,actorUid:access.uid,openingBalanceUGX:0});
 if(input.openingBalanceUGX!==0)throw new Error('Only zero opening accounts permitted');
 if(record.branchId){const branch=await db.doc(`branches/${record.branchId}`).get();if(branch.data()?.tenantId!==input.tenantId)throw new Error('Invalid branch');}
 if(record.kind==='BRANCH_CASH_SALES')record={...record,accountId:branchCashAccountId(record.branchId!)};
 const id=financeV2AccountDocumentId(record.tenantId,record.accountId);
 const createdAt=new Date().toISOString();
 await db.doc(`finance_payment_accounts/${id}`).create({...record,createdAt,updatedAt:createdAt,...(record.kind==='BRANCH_CASH_SALES'?{posCashFundingFrom:createdAt,posCashFundedUGX:0,posCashLastEventId:null}:{})});
 return {accountId:record.accountId};
}
