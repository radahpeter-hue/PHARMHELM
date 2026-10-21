import type {Firestore} from 'firebase-admin/firestore';
import {refreshBranchCash} from './posCashFunding';
/** Optional prospective posting loop. No browser authority, migration or EOD funding. */
export function startCashFundingWorker(db:Firestore){
 if(process.env.FINANCE_V2_CASH_POLL_ENABLED!=='true')return;
 const tenants=(process.env.FINANCE_V2_CASH_PILOT_TENANTS||'').split(',').filter(Boolean);
 if(!tenants.length||tenants.some(t=>!/^[A-Za-z0-9_-]{1,150}$/.test(t)))throw new Error('Cash funding worker requires an explicit tenant allowlist');
 let running=false;
 const tick=async()=>{if(running)return;running=true;try{for(const tenantId of tenants){
  const settings=await db.doc('system_settings/'+tenantId).get();
  if(settings.data()?.financeV2PosCashFundingEnabled!==true||settings.data()?.financeV2TrustedTransfersEnabled!==true)continue;
  const accounts=await db.collection('finance_payment_accounts').where('tenantId','==',tenantId).where('kind','==','BRANCH_CASH_SALES').get();
  for(const account of accounts.docs)try{await refreshBranchCash(db,account.id,'finance-v2-cash-worker');}catch{console.error('POS cash funding blocked',tenantId,account.id);}
 }}finally{running=false;}};
 const timer=setInterval(()=>void tick().catch(()=>console.error('Cash worker tick failed')),15000);timer.unref();void tick().catch(()=>console.error('Cash worker startup tick failed'));
}
