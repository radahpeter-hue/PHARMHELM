import {doc,getDoc,runTransaction,type Firestore} from 'firebase/firestore';
import {db} from '../../firebase';
import type {FinancialPortfolio} from './financialPortfolio';

/** Branch-specific card routing only. No EOD or ledger postings occur here. */
export interface BranchCardSettlement {
 tenantId:string;branchId:string;bankPortfolioId:string;
 updatedBy:string;updatedAt:string;
}
export function validateCardSettlementTarget(branchId:string,tenantId:string,bank:FinancialPortfolio):void {
 if(!branchId||!tenantId||bank.tenantId!==tenantId||bank.origin!=='custom'
  ||bank.classification!=='bank'||bank.bankParentId!=='system_bank'
  ||bank.status!=='active'||bank.scope.kind!=='organisation')
  throw new Error('Select an active registered bank account belonging to this tenant.');
}
export async function readBranchCardSettlement(
 tenantId:string,branchId:string,database:Firestore=db
):Promise<BranchCardSettlement|null>{
 if(!tenantId||!branchId)throw new Error('Branch and tenant required.');
 const branch=await getDoc(doc(database,'branches',branchId));
 if(!branch.exists()||branch.data().tenantId!==tenantId)throw new Error('Branch not found in tenant.');
 const value=branch.data().cardSettlement;
 if(!value)return null;
 if(typeof value.bankPortfolioId!=='string'||value.tenantId!==tenantId||value.branchId!==branchId)
  throw new Error('Invalid card settlement configuration.');
 return value as BranchCardSettlement;
}
export async function saveBranchCardSettlement(input:{
 tenantId:string;branchId:string;bank:FinancialPortfolio;actorId:string
},database:Firestore=db):Promise<void>{
 const {tenantId,branchId,bank,actorId}=input;
 validateCardSettlementTarget(branchId,tenantId,bank);
 if(!actorId)throw new Error('CEO identity required.');
 const branchRef=doc(database,'branches',branchId);
 const bankRef=doc(database,'finance_portfolios_v1',tenantId+'__'+bank.id);
 await runTransaction(database,async tx=>{
  const [branch,liveBank]=await Promise.all([tx.get(branchRef),tx.get(bankRef)]);
  if(!branch.exists()||branch.data().tenantId!==tenantId)throw new Error('Branch does not belong to tenant.');
  if(!liveBank.exists())throw new Error('Bank account not registered.');
  validateCardSettlementTarget(branchId,tenantId,liveBank.data() as FinancialPortfolio);
  tx.update(branchRef,{cardSettlement:{tenantId,branchId,bankPortfolioId:bank.id,
   updatedBy:actorId,updatedAt:new Date().toISOString()}});
 });
}
