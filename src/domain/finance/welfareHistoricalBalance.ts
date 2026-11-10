import {eodAmountNumber,sumEodAmounts} from '../../utils/eodMoney';

export type WelfareHistory={id:string;source:string;reference:string;date:string;amount:number|null;type:string;status:string};
export function recordedAmount(value:unknown){
 try {
  const amount=eodAmountNumber(value);
  return amount>=0&&amount<=Number.MAX_SAFE_INTEGER?amount:null;
 } catch {return null;}
}

export function welfareHistoricalBalance(rows:WelfareHistory[]|null,funding:WelfareHistory[]|null){
 const benefits=rows?.filter(row=>row.source==='welfare'&&['approved','completed'].includes(row.status));
 const withdrawals=funding?.filter(row=>row.status==='withdrawal');
 // Prefer cash movements when both sources may represent the same funding.
 const useAllocations=withdrawals?.length===0;
 const inflows=useAllocations?rows?.filter(row=>row.source==='welfareAllocations'):withdrawals;
 const outflows=[...(funding?.filter(row=>row.status==='incoming')??[]),...(benefits??[])];
 const historicalNet=benefits&&inflows?.length&&[...inflows,...outflows].every(row=>row.amount!==null)
  ?sumEodAmounts([...inflows.map(row=>row.amount!),...outflows.map(row=>-row.amount!)])
  :null;
 return {historicalNet,useAllocations};
}
