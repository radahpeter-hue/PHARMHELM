import {collection,doc,getDocs,query,runTransaction,where,type Firestore} from 'firebase/firestore';
import {db} from '../../firebase';
import {managementAccountDocumentId,stageManagementCashEntry} from '../../services/managementCashPosting';
import {planEodPortfolioRouting} from './eodPortfolioRouting';

/** Finance-authorized atomic posting of a previously submitted EOD. */
export async function settleReconciledEod(input:{
 tenantId:string;branchId:string;reconciliationId:string;actorId:string
},database:Firestore=db):Promise<{replayed:boolean;postings:number}>{
 const {tenantId,branchId,reconciliationId,actorId}=input;
 if(!tenantId||!branchId||!reconciliationId||!actorId)throw Error('EOD settlement identity required.');
 const auditRef=doc(database,'eod_reconciliations',reconciliationId);
 const rows=await getDocs(query(collection(database,'eod_reconciliations'),
  where('tenantId','==',tenantId),where('branch_id','==',branchId)));
 const auditSnapshot=rows.docs.find(d=>d.id===reconciliationId);
 if(!auditSnapshot)throw Error('Submitted EOD not found.');
 const branchRef=doc(database,'branches',branchId);
 const branchSnapshot=await getDocs(query(collection(database,'branches'),where('tenantId','==',tenantId)));
 const branch=branchSnapshot.docs.find(d=>d.id===branchId);
 if(!branch)throw Error('Branch not found.');
 const initial=auditSnapshot.data();
 const bankId=branch.data().cardSettlement?.bankPortfolioId as string|undefined;
 const plan=planEodPortfolioRouting({tenantId,branchId,reconciliationId,cardBankPortfolioId:bankId,
  actual:{cash:initial.cash_actual,momo:initial.momo_actual,airtel:initial.airtel_actual,card:initial.card_actual}});
 const ids=await Promise.all(plan.map(async p=>{
  if(!globalThis.crypto?.subtle)throw Error('Secure settlement IDs unavailable.');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(tenantId+'|'+reconciliationId+'|'+p.channel));
  return 'eod_'+Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,'0')).join('');
 }));
 return runTransaction(database,async tx=>{
  const [audit,liveBranch,...accounts]=await Promise.all([tx.get(auditRef),tx.get(branchRef),
   ...plan.map(p=>tx.get(doc(database,'finance_payment_accounts',managementAccountDocumentId(tenantId,p.accountId))))]);
  if(!audit.exists()||audit.data().tenantId!==tenantId||audit.data().branch_id!==branchId||
   audit.data().status!=='submitted'||audit.data().audit_only!==true||audit.data().financial_posting!=='none')
   throw Error('EOD is not a submitted audit-only reconciliation.');
  for(const channel of ['cash','momo','airtel','card']){
   if(audit.data()[channel+'_actual']!==initial[channel+'_actual'])throw Error('EOD was corrected. Restart settlement.');
  }
  if(!liveBranch.exists()||liveBranch.data().tenantId!==tenantId||
   liveBranch.data().cardSettlement?.bankPortfolioId!==bankId)throw Error('Branch routing changed.');
  const ledgerRefs=plan.map((p,i)=>doc(database,accounts[i]?.data()?.kind==='bank'?'banking_records':'petty_cash_ledger',ids[i]));
  const previous=await Promise.all(ledgerRefs.map(ref=>tx.get(ref)));
  const existing=previous.filter(x=>x.exists()).length;
  if(existing){
   if(existing!==plan.length)throw Error('Partial EOD posting detected.');
   plan.forEach((p,i)=>{const row=previous[i].data()!;
    if(row.tenantId!==tenantId||row.accountDocumentId!==managementAccountDocumentId(tenantId,p.accountId)||
      row.amount!==p.amountUGX||row.eodReconciliationId!==reconciliationId||row.eodChannel!==p.channel)
     throw Error('EOD posting reference conflict.');
   });
   return {replayed:true,postings:0};
  }
  plan.forEach((p,i)=>{
   const account=accounts[i];
   if(!account.exists()||account.data().tenantId!==tenantId||account.data().accountId!==p.accountId||
    account.data().initialized!==true||account.data().currency!=='UGX')throw Error('Destination account is not reconciled.');
   if(p.channel==='card'&&account.data().portfolioClassification!=='bank')throw Error('Invalid card bank.');
   stageManagementCashEntry(tx,ids[i],{tenantId,amount:p.amountUGX,type:'incoming',
    source:'EOD '+p.channel,reference_number:p.externalReference,branchId,
    eodReconciliationId:reconciliationId,eodChannel:p.channel},database,p.accountId,actorId);
  });
  return {replayed:false,postings:plan.length};
 });
}
