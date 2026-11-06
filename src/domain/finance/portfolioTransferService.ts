import {doc,getDocFromServer,runTransaction,serverTimestamp,type Firestore} from 'firebase/firestore';
import {db} from '../../firebase';
import {definePortfolioTransfer,portfolioTransferIdentity,type PortfolioTransfer,type TransferEndpoint} from './portfolioTransfer';
import type {FinancialPortfolio} from './financialPortfolio';
import type {ManagementPaymentAccount} from '../../services/managementCashPosting';
import {managementAccountDocumentId} from '../../services/managementCashPosting';

export interface SubmitPortfolioTransfer {
  tenantId:string;sourceAccountId:string;destinationAccountId:string;
  principalUGX:number;chargeUGX?:number;reference:string;actorId:string;
}
function bankEndpoint(account:ManagementPaymentAccount,portfolio:FinancialPortfolio,tenantId:string):TransferEndpoint {
  if(account.tenantId!==tenantId||portfolio.tenantId!==tenantId||account.accountId!==portfolio.id
    ||account.portfolioId!==portfolio.id||!account.initialized||account.currency!=='UGX'
    ||account.kind!=='bank'||account.portfolioClassification!=='bank'
    ||portfolio.currency!=='UGX'||portfolio.classification!=='bank'||portfolio.bankParentId!=='system_bank'
    ||portfolio.status!=='active'||portfolio.scope.kind!=='organisation')
    throw new Error('Select an active, reconciled individual Bank account in this tenant.');
  return {tenantId,portfolioId:'system_bank',accountId:account.accountId,
    accountDocumentId:managementAccountDocumentId(tenantId,account.accountId),
    name:account.name,branchId:'',kind:'bank'};
}
/** Change 060: one transaction owns the immutable record, both movements and balances. */
export async function submitPortfolioTransfer(input:SubmitPortfolioTransfer,database:Firestore=db):Promise<{record:PortfolioTransfer;replayed:boolean}> {
  const id=await portfolioTransferIdentity(input.tenantId,input.reference);
  // Validate the supported route before opening a write transaction.
  if(!/^bank_[a-f0-9]{64}$/.test(input.sourceAccountId)||!/^bank_[a-f0-9]{64}$/.test(input.destinationAccountId))
    throw new Error('This checkpoint supports individual Bank-to-Bank transfers only.');
  if(input.sourceAccountId===input.destinationAccountId)throw new Error('Select different source and destination accounts.');
  if((input.chargeUGX??0)!==0)throw new Error('Transfer charges are not enabled at the Bank principal checkpoint.');
  if(!Number.isSafeInteger(input.principalUGX)||input.principalUGX<=0||!input.actorId)
    throw new Error('A positive whole UGX principal and authenticated actor are required.');
  const transferRef=doc(database,'finance_transfers_v1',id);
  const matches=(record:PortfolioTransfer)=>record.id===id&&record.tenantId===input.tenantId
    &&record.source.accountId===input.sourceAccountId&&record.destination.accountId===input.destinationAccountId
    &&record.principalUGX===input.principalUGX&&record.chargeUGX===0&&record.initiatedBy===input.actorId
    &&record.status==='completed'&&record.currency==='UGX';
  try{return await runTransaction(database,async tx=>{
    const prior=await tx.get(transferRef);
    if(prior.exists()){
      const record=prior.data() as PortfolioTransfer;
      if(!matches(record))
        throw new Error('Transfer reference already belongs to a different transaction.');
      return {record,replayed:true};
    }
    const sourceRef=doc(database,'finance_payment_accounts',managementAccountDocumentId(input.tenantId,input.sourceAccountId));
    const destinationRef=doc(database,'finance_payment_accounts',managementAccountDocumentId(input.tenantId,input.destinationAccountId));
    const registry=(accountId:string)=>doc(database,'finance_portfolios_v1',input.tenantId+'__'+accountId);
    const [source,destination,sourcePortfolio,destinationPortfolio]=await Promise.all([
      tx.get(sourceRef),tx.get(destinationRef),tx.get(registry(input.sourceAccountId)),tx.get(registry(input.destinationAccountId))]);
    if(!source.exists()||!destination.exists()||!sourcePortfolio.exists()||!destinationPortfolio.exists())
      throw new Error('Both individual Bank accounts must exist and have verified openings.');
    if(sourcePortfolio.data().id!==input.sourceAccountId||destinationPortfolio.data().id!==input.destinationAccountId)
      throw new Error('Bank registry identity mismatch.');
    const from=source.data() as ManagementPaymentAccount,to=destination.data() as ManagementPaymentAccount;
    const record=definePortfolioTransfer({id,tenantId:input.tenantId,
      source:bankEndpoint(from,sourcePortfolio.data() as FinancialPortfolio,input.tenantId),
      destination:bankEndpoint(to,destinationPortfolio.data() as FinancialPortfolio,input.tenantId),
      principalUGX:input.principalUGX,chargeUGX:0,reference:input.reference,
      initiatedBy:input.actorId,initiatedAt:new Date().toISOString()});
    const remaining=from.balanceUGX-record.principalUGX,received=to.balanceUGX+record.principalUGX;
    if(!Number.isSafeInteger(from.balanceUGX)||!Number.isSafeInteger(to.balanceUGX)||remaining<0
      ||!Number.isSafeInteger(remaining)||!Number.isSafeInteger(received))throw new Error('Insufficient source funds or balance overflow.');
    const now=serverTimestamp();
    for(const [endpoint,sign,entry] of [[record.source,-1,record.sourceMovement],[record.destination,1,record.destinationMovement]] as const){
      tx.set(doc(database,entry.collection,entry.id),{
        tenantId:record.tenantId,accountDocumentId:endpoint.accountDocumentId,portfolioTransferId:record.id,
        amount:record.principalUGX,accountDeltaUGX:sign*record.principalUGX,
        type:sign<0?'outgoing':'incoming',movementClass:sign<0?'transfer_out':'transfer_in',
        source:sign<0?'Transfer to '+record.destination.name:'Transfer from '+record.source.name,
        reference_number:record.reference,postedBy:input.actorId,createdAt:now,updatedAt:now
      });
    }
    tx.update(sourceRef,{balanceUGX:remaining,lastPostingId:record.sourceMovement.id,updatedAt:now});
    tx.update(destinationRef,{balanceUGX:received,lastPostingId:record.destinationMovement.id,updatedAt:now});
    tx.set(transferRef,{...record,postedAt:now});
    return {record,replayed:false};
  });}catch(error){
    // Rules can reject a concurrent writer as an immutable UPDATE before the
    // SDK retries its transaction. Verify the committed winner, never resubmit
    // balances blindly after a denied write or a lost acknowledgement.
    try{
      const winner=await getDocFromServer(transferRef);
      if(winner.exists()&&matches(winner.data() as PortfolioTransfer))return {record:winner.data() as PortfolioTransfer,replayed:true};
    }catch{}
    throw error;
  }
}
