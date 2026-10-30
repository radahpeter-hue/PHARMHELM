import {collection,getDocs,query,where,type Firestore} from 'firebase/firestore';
import {db} from '../../firebase';
import {eodIdentity} from '../../utils/eodShifts';
import type {FinancialLedgerQuery} from './portfolioLedger';
export type EodChannel='cash'|'momo'|'airtel';
export type ReconciliationEvidence={
 id:string;tenantId:string;branchId:string;businessDate:string;shiftId:string;
 channel:EodChannel;declaredUGX:number;expectedUGX:number;varianceUGX:number;
 source:'eod_reconciliations';fundingPosted:false;
};
/** Verified source amounts are audit evidence, NEVER independently deposited money. */
export function projectEodChannelEvidence(
 id:string,raw:Record<string,unknown>,tenantId:string,branchId:string,channel:EodChannel
):ReconciliationEvidence{
 if(raw.tenantId!==tenantId||raw.branch_id!==branchId)throw new Error('EOD tenant or branch mismatch.');
 const day=raw.reconciliation_date,shift=raw.shift_id;
 if(typeof day!=='string'||typeof shift!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)
   ||eodIdentity(tenantId,branchId,day,shift)!==id)
  throw new Error('Invalid EOD reconciliation identity.');
 if(raw.audit_only!==true||raw.financial_posting!=='none')throw new Error('EOD must not be counted as a financial posting.');
 const actual=raw[channel+'_actual'],expected=raw[channel+'_expected'],variance=raw[channel+'_variance'];
 if(typeof actual!=='number'||typeof expected!=='number'||typeof variance!=='number'
  ||![actual,expected,variance].every(Number.isSafeInteger)||actual<0||expected<0||actual-expected!==variance)
  throw new Error('Invalid EOD reconciliation totals.');
 return {id,tenantId,branchId,businessDate:day,shiftId:shift,channel,
  declaredUGX:actual,expectedUGX:expected,varianceUGX:variance,
  source:'eod_reconciliations',fundingPosted:false};
}
export async function loadEodChannelEvidence(input:{
 tenantId:string;branchId:string;channel:EodChannel;period:FinancialLedgerQuery
},database:Firestore=db):Promise<ReconciliationEvidence[]>{
 const {tenantId,branchId,channel,period}=input;
 if(!tenantId||!branchId||period.from>period.to)throw new Error('Invalid EOD evidence scope.');
 const snapshot=await getDocs(query(collection(database,'eod_reconciliations'),where('tenantId','==',tenantId),
  where('branch_id','==',branchId)));
 const result=snapshot.docs.map(d=>projectEodChannelEvidence(d.id,d.data(),tenantId,branchId,channel))
  .filter(e=>e.businessDate>=period.from&&e.businessDate<=period.to)
  .sort((a,b)=>a.businessDate.localeCompare(b.businessDate)||a.id.localeCompare(b.id));
 return result;
}
