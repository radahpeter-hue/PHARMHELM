import {createHash} from 'node:crypto';
import {FieldPath,Timestamp,type Firestore,type Transaction} from 'firebase-admin/firestore';
import {canonicalPosCash,planPosCashBalance,wholeUgx} from '../src/services/financeV2PosCashPolicy';

export const branchCashAccountId=(branchId:string)=>'branch_cash_'+createHash('sha256').update(branchId).digest('hex').slice(0,32);
const validId=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,240}$/.test(v);
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const BATCH_SIZE=150; // Cursor pages are bounded; incomplete pages never authorise a transfer.

export async function assertBranchCashFundingAccount(db:Firestore,tx:Transaction,account:Record<string,any>){
 const {tenantId,branchId,accountId}=account;
 if(!validId(tenantId)||!validId(branchId)||accountId!==branchCashAccountId(branchId)||account.controlVersion!==2||account.initialized!==true||account.active!==true||account.currency!=='UGX')throw new Error('Unbound Branch Cash Sales account');
 const from=account.posCashFundingFrom;
 if(typeof from!=='string'||!Number.isFinite(Date.parse(from))||new Date(from).toISOString()!==from||from!==account.createdAt||account.openingBalanceUGX!==0)throw new Error('Branch cash prospective funding boundary is not initialized');
 const [settings,tenant,branch]=await Promise.all([tx.get(db.doc('system_settings/'+tenantId)),tx.get(db.doc('tenants/'+tenantId)),tx.get(db.doc('branches/'+branchId))]);
 if(settings.data()?.financeV2PosCashFundingEnabled!==true||settings.data()?.financeV2TrustedTransfersEnabled!==true||!tenant.exists||tenant.data()?.status==='suspended'||branch.data()?.tenantId!==tenantId)throw new Error('Branch cash funding is disabled or outside tenant');
 wholeUgx(account.posCashFundedUGX);
 if(account.posCashCursorAt&&(typeof account.posCashCursorAt.toMillis!=='function'||account.posCashCursorAt.toMillis()<Date.parse(from)||account.posCashCursorAt.valueOf()>settings.readTime.valueOf()))throw new Error('Invalid POS cash processing cursor');
 if(account.posCashCursorId!=null&&(!validId(account.posCashCursorId)||!account.posCashCursorAt))throw new Error('Invalid POS cash processing cursor');
 return from;
}

/** Reads and stages prospective cash changes. flush must follow ALL transaction reads.
 * Receipt journals track each original sale chain, not income or EOD totals. */
export async function prepareBranchCashFunding(db:Firestore,tx:Transaction,account:Record<string,any>,actorUid:string,allowPartial=false){
 if(account.kind!=='BRANCH_CASH_SALES')return {account,hasMore:false,flush:()=>{}};
 const from=await assertBranchCashFundingAccount(db,tx,account);
 const {tenantId,branchId,accountId}=account;
 let query=db.collection('sales').where('tenantId','==',tenantId).where('branchId','==',branchId)
  .where('updatedAt','>=',account.posCashCursorAt??Timestamp.fromDate(new Date(from)))
  .orderBy('updatedAt').orderBy(FieldPath.documentId());
 if(account.posCashCursorAt&&account.posCashCursorId)query=query.startAfter(account.posCashCursorAt,account.posCashCursorId);
 const rows=await tx.get(query.limit(BATCH_SIZE+1)),hasMore=rows.size>BATCH_SIZE;
 if(hasMore&&!allowPartial)throw new Error('POS cash funding has a backlog; refresh accounts before banking');
 const page=rows.docs.slice(0,BATCH_SIZE);
 if(!page.length)return {account,hasMore:false,flush:()=>{}};
 const cache=new Map<string,Record<string,any>>(page.map(d=>[d.id,{...d.data(),id:d.id}]));
 const getSale=async(saleId:string)=>{
  if(!validId(saleId))throw new Error('Invalid cash source identity');
  if(!cache.has(saleId)){const snap=await tx.get(db.doc('sales/'+saleId));if(!snap.exists)throw new Error('Receipt lineage is incomplete');cache.set(saleId,{...snap.data(),id:saleId});}
  const s=cache.get(saleId)!;if(s.tenantId!==tenantId||s.branchId!==branchId||s.engineVersion!==2)throw new Error('Receipt lineage crosses financial scope');return s;
 };
 const roots=new Map<string,{root:Record<string,any>;current:Record<string,any>}>();
 for(const doc of page){
  const updatedAt=doc.data().updatedAt;
  if(typeof updatedAt?.valueOf!=='function'||typeof updatedAt?.toMillis!=='function'||updatedAt.valueOf()>rows.readTime.valueOf())throw new Error('POS update timestamp is not a valid committed source');
  let root=await getSale(doc.id),current=root;const ancestors=new Set([root.id]);
  while(root.revisionOfSaleId){
   if(ancestors.has(root.revisionOfSaleId)||ancestors.size>20)throw new Error('Receipt lineage cycle or excessive depth');ancestors.add(root.revisionOfSaleId);
   const parent=await getSale(root.revisionOfSaleId);
   if(parent.supersededBySaleId!==root.id||parent.revisionLifecycle!=='COMPLETED'||root.isRevisionReplacement!==true)throw new Error('Receipt lineage is not completed');root=parent;
  }
  if(typeof root.createdAt?.toMillis!=='function'||root.createdAt.valueOf()>rows.readTime.valueOf())throw new Error('Receipt has no trusted creation timestamp');
  if(root.createdAt.toMillis()<Date.parse(from))continue; // Edits to historical receipts are never opening balances.
  current=root;const descendants=new Set([root.id]);
  while(current.supersededBySaleId){
   if(descendants.has(current.supersededBySaleId)||descendants.size>20)throw new Error('Receipt lineage cycle or excessive depth');descendants.add(current.supersededBySaleId);
   const replacement=await getSale(current.supersededBySaleId);
   if(replacement.revisionOfSaleId!==current.id||replacement.isRevisionReplacement!==true||current.revisionLifecycle!=='COMPLETED')throw new Error('Invalid replacement receipt linkage');current=replacement;
  }
  if(current.revisionLifecycle&&current.revisionLifecycle!=='COMPLETED')throw new Error('Receipt correction is pending; retry cash funding after completion');
  if(current.revisionLocked===true&&!current.isRevisionReplacement)throw new Error('Receipt is locked without a completed replacement');
  if(!['completed','active'].includes(current.status)||current.voided||current.isVoided||current.isDeleted)throw new Error('Unsupported receipt cancellation requires explicit cash reconciliation');
  roots.set(root.id,{root,current});
 }
 const changes:Array<Record<string,any>>=[];let delta=0;
 for(const [rootSaleId,{current}] of [...roots].sort(([a],[b])=>a.localeCompare(b))){
  if(!validId(current.canonicalPaymentId)||!validId(current.transactionOutboxEventId))throw new Error('Canonical payment linkage missing');
  const journalId=hash([tenantId,accountId,rootSaleId]),ref=db.doc('finance_v2_pos_cash_sources/'+journalId);
  const [payment,event,journal]=await Promise.all([tx.get(db.doc('pos_payments/'+current.canonicalPaymentId)),tx.get(db.doc('pos_transaction_outbox/'+current.transactionOutboxEventId)),tx.get(ref)]);
  if(!payment.exists||!event.exists)throw new Error('Canonical POS payment or outbox missing');
  const cashUGX=canonicalPosCash(current,payment.data()!,event.data()!);
  const previous=journal.data();
  if(previous&&(previous.tenantId!==tenantId||previous.accountId!==accountId||previous.rootSaleId!==rootSaleId||previous.branchId!==branchId))throw new Error('POS cash journal scope mismatch');
  const previousCashUGX=wholeUgx(previous?.cashUGX??0);
  if(previous?.currentSaleId===current.id&&previousCashUGX===cashUGX)continue;
  const change={rootSaleId,saleId:current.id,paymentId:current.canonicalPaymentId,cashUGX,previousCashUGX,previousSaleId:previous?.currentSaleId??null,sourceOperatorUid:payment.data()!.operatorUid??null,journalId};
  delta+=cashUGX-previousCashUGX;if(!Number.isSafeInteger(delta))throw new Error('Cash delta overflow');changes.push(change);
 }
 const totalCashUGX=wholeUgx(account.posCashFundedUGX)+delta;
 const planned=planPosCashBalance(account.balanceUGX,account.posCashFundedUGX,totalCashUGX);
 const postedAt=new Date().toISOString();
 // A full page advances to an exact timestamp/document cursor. A drained query
 // advances to its server snapshot time. Equal timestamps are safely retried.
 const last=page[page.length-1];
 const cursorPatch=hasMore?{posCashCursorAt:last.data().updatedAt,posCashCursorId:last.id}:{posCashCursorAt:rows.readTime,posCashCursorId:null};
 const eventId='pos_cash_'+hash([tenantId,accountId,account.posCashLastEventId??null,changes]);
 if(changes.length&&(await tx.get(db.doc('finance_v2_events/'+eventId))).exists)throw new Error('Conflicting cash funding audit state');
 const patch={...cursorPatch,balanceUGX:planned.closingUGX,posCashFundedUGX:planned.totalCashUGX,posCashCheckedAt:postedAt,...(changes.length?{posCashLastEventId:eventId,lastPostingId:eventId,updatedAt:postedAt}:{})};
 return {account:{...account,...patch},hasMore,flush:()=>{
  tx.update(db.doc(`finance_payment_accounts/${tenantId}_${accountId}`),patch);
  if(!changes.length)return;
  for(const c of changes)tx.set(db.doc('finance_v2_pos_cash_sources/'+c.journalId),{tenantId,branchId,accountId,rootSaleId:c.rootSaleId,currentSaleId:c.saleId,paymentId:c.paymentId,cashUGX:c.cashUGX,lastEventId:eventId,updatedAt:postedAt});
  tx.create(db.doc('finance_v2_events/'+eventId),{tenantId,branchId,accountId,eventKind:'POS_CASH_LOCATION_POSTING',sourceType:'POS_CANONICAL_PAYMENTS',currency:'UGX',deltaUGX:planned.deltaUGX,beforeUGX:account.balanceUGX,afterUGX:planned.closingUGX,previousCashUGX:account.posCashFundedUGX,totalCashUGX:planned.totalCashUGX,previousEventId:account.posCashLastEventId??null,sources:changes,recognizesRevenue:false,recognizesExpense:false,actorUid,createdAt:postedAt});
  if(planned.deltaUGX!==0)tx.create(db.doc('finance_v2_account_movements/'+eventId),{tenantId,branchId,accountId,eventId,deltaUGX:planned.deltaUGX,purpose:'POS_CASH_LOCATION',beforeUGX:account.balanceUGX,afterUGX:planned.closingUGX,actorUid,createdAt:postedAt});
 }};
}
export async function refreshBranchCash(db:Firestore,documentId:string,actorUid:string){
 for(let page=0;page<20;page++){
  const result=await db.runTransaction(async tx=>{const ref=db.doc('finance_payment_accounts/'+documentId),snap=await tx.get(ref);if(!snap.exists)throw new Error('Cash account missing');const prepared=await prepareBranchCashFunding(db,tx,snap.data()!,actorUid,true);prepared.flush();return {account:prepared.account,hasMore:prepared.hasMore};});
  if(!result.hasMore)return result.account;
 }
 throw new Error('Cash backlog is being processed; refresh again before banking');
}
