import {timestampBusinessDate} from '../../utils/eodBusinessDate';
import {collection,getDocs,query,where,type Firestore} from 'firebase/firestore';
import {db} from '../../firebase';
import type {FinancialLedgerQuery} from './portfolioLedger';
import type {EodChannel} from './portfolioEodEvidence';

/** V2 POS settled payment components: immutable receipt evidence, NOT account deposits. */
export type PosChannelEvidence={
 id:string;tenantId:string;branchId:string;businessDate:string;
 paymentId:string;saleId:string;receiptNumber:string;channel:EodChannel;
 settledUGX:number;source:'pos_payments';fundingPosted:false;
};
const methods:Record<EodChannel,readonly string[]>={
 cash:['cash'],momo:['mtn_momo','momo'],airtel:['airtel_money','airtel']
};
export function projectPosChannelEvidence(
 id:string,raw:Record<string,unknown>,tenantId:string,branchId:string,channel:EodChannel
):PosChannelEvidence|null{
 if(raw.tenantId!==tenantId||raw.branchId!==branchId)throw new Error('POS payment scope mismatch.');
 if(raw.source!=='POS'||raw.engineVersion!==2||raw.paymentId!==id||raw.currency!=='UGX'
  ||typeof raw.saleId!=='string'||typeof raw.receiptNumber!=='string'
  ||!Array.isArray(raw.components))
  throw new Error('Invalid canonical POS payment.');
 const components=raw.components as Array<Record<string,unknown>>;
 let total=0,settled=0;
 for(const c of components){
  if(typeof c.amount!=='number'||typeof c.settledAmount!=='number'||typeof c.outstandingAmount!=='number'
   ||![c.amount,c.settledAmount,c.outstandingAmount].every(Number.isSafeInteger)
   ||c.amount<0||c.settledAmount<0||c.outstandingAmount<0
   ||c.amount!==c.settledAmount+c.outstandingAmount)
    throw new Error('POS payment component does not reconcile.');
  total+=c.amount;settled+=c.settledAmount;
 }
 if(total!==raw.amount||settled!==raw.settledAmount||!Number.isSafeInteger(total))
  throw new Error('POS payment does not reconcile to its components.');
 const amount=components.filter(c=>methods[channel].includes(String(c.method))).reduce((v,c)=>v+(c.settledAmount as number),0);
 if(amount===0)return null;
 const stamp=raw.createdAt;
 const createdAt=stamp&&typeof stamp==='object'&&'toDate' in stamp&&typeof stamp.toDate==='function'
  ?stamp.toDate().toISOString():typeof stamp==='string'?stamp:'';
 if(!/^\d{4}-\d{2}-\d{2}T/.test(createdAt))throw new Error('POS payment timestamp missing.');
 return {id,tenantId,branchId,businessDate,paymentId:id,saleId:raw.saleId,
  receiptNumber:raw.receiptNumber,channel,settledUGX:amount,source:'pos_payments',fundingPosted:false};
}
export async function loadPosChannelEvidence(input:{
 tenantId:string;branchId:string;channel:EodChannel;period:FinancialLedgerQuery
},database:Firestore=db):Promise<PosChannelEvidence[]>{
 const {tenantId,branchId,channel,period}=input;
 if(!tenantId||!branchId||period.from>period.to)throw new Error('Invalid POS evidence scope.');
 const snapshot=await getDocs(query(collection(database,'pos_payments'),where('tenantId','==',tenantId),
  where('branchId','==',branchId)));
 const rows=snapshot.docs.map(d=>projectPosChannelEvidence(d.id,d.data(),tenantId,branchId,channel))
  .filter((v):v is PosChannelEvidence=>v!==null&&v.businessDate>=period.from&&v.businessDate<=period.to);
 const ids=new Set(rows.map(v=>v.paymentId));
 if(ids.size!==rows.length)throw new Error('Duplicate POS payment evidence.');
 return rows.sort((a,b)=>a.businessDate.localeCompare(b.businessDate)||a.id.localeCompare(b.id));
}
