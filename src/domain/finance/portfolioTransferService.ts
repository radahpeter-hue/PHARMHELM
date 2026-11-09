import {doc,getDocFromServer,runTransaction,serverTimestamp,type Firestore} from 'firebase/firestore';
import {kampalaBusinessDate} from '../../utils/eodBusinessDate';
import {db} from '../../firebase';
import {definePortfolioTransfer,portfolioTransferIdentity,type PortfolioTransfer,type TransferEndpoint} from './portfolioTransfer';
import type {FinancialPortfolio} from './financialPortfolio';
import type {ManagementPaymentAccount} from '../../services/managementCashPosting';
import {managementAccountDocumentId} from '../../services/managementCashPosting';

export interface SubmitPortfolioTransfer {
  tenantId:string;sourceAccountId:string;destinationAccountId:string;
  principalUGX:number;chargeUGX?:number;reference:string;actorId:string;
}
const registered = (id: string) => /^(bank_[a-f0-9]{64}|custom_[A-Za-z0-9_-]+)$/.test(id);

export function resolveTransferEndpoint(account: ManagementPaymentAccount, portfolio: FinancialPortfolio | undefined, tenantId: string, outgoing: boolean): TransferEndpoint {
  const key = account.accountId;
  const branchId = account.scope?.kind === 'branch' ? account.scope.branchId : '';
  if (account.tenantId !== tenantId || account.portfolioId !== key || !account.initialized || account.currency !== 'UGX')
    throw new Error('Select an active, reconciled UGX account in this tenant.');
  let portfolioId = key;
  if (registered(key)) {
    if (!portfolio || portfolio.id !== key || portfolio.tenantId !== tenantId || portfolio.currency !== 'UGX'
        || portfolio.status !== 'active' || (portfolio.scope.kind === 'branch' ? portfolio.scope.branchId : '') !== branchId)
      throw new Error('Select an active, reconciled registered portfolio.');
    if (key.startsWith('bank_')) {
      if (portfolio.bankParentId !== 'system_bank' || portfolio.classification !== 'bank' || account.kind !== 'bank' || branchId)
        throw new Error('Select an individual Bank account.');
      portfolioId = 'system_bank';
    } else if (portfolio.origin !== 'custom' || !(outgoing ? portfolio.allowsTransfersOut : portfolio.allowsTransfersIn)) {
      throw new Error('This custom portfolio does not allow transfers in the selected direction.');
    }
  } else {
    const mobileMoney = ['system_mtn_mobile_money', 'system_airtel_mobile_money'].includes(key);
    const branchAccount = branchId && ['system_branch_cash_sales_' + branchId, 'system_petty_cash_' + branchId].includes(key);
    if (!(mobileMoney && !branchId && account.kind === 'bank') && !(branchAccount && account.kind === 'petty_cash'))
      throw new Error('Select an individual Bank account or another eligible reconciled portfolio.');
  }
  return {tenantId, portfolioId, accountId: key, accountDocumentId: managementAccountDocumentId(tenantId, key),
    name: account.name, branchId, kind: account.kind};
}

export function allowsPortfolioTransfer(source: TransferEndpoint, destination: TransferEndpoint): boolean {
  if (source.tenantId !== destination.tenantId || source.accountDocumentId === destination.accountDocumentId
      || (source.branchId && destination.branchId && source.branchId !== destination.branchId)) return false;
  const cashSales = !!source.branchId && source.accountId === 'system_branch_cash_sales_' + source.branchId;
  const bank = source.portfolioId === 'system_bank';
  const toBank = destination.portfolioId === 'system_bank';
  const toPetty = !!destination.branchId && destination.accountId === 'system_petty_cash_' + destination.branchId;
  return source.accountId.startsWith('custom_') || destination.accountId.startsWith('custom_')
    || (toBank && (cashSales || bank || ['system_mtn_mobile_money', 'system_airtel_mobile_money'].includes(source.accountId)))
    || (toPetty && (cashSales || bank));
}
/** Change 060: one transaction owns the immutable record, both movements and balances. */
export async function submitPortfolioTransfer(input:SubmitPortfolioTransfer,database:Firestore=db):Promise<{record:PortfolioTransfer;replayed:boolean}> {
  const id=await portfolioTransferIdentity(input.tenantId,input.reference);
  if(input.sourceAccountId===input.destinationAccountId)throw new Error('Select different source and destination accounts.');
  const charge = input.chargeUGX ?? 0;
  if (!Number.isSafeInteger(charge) || charge < 0 || !Number.isSafeInteger(input.principalUGX + charge))
    throw new Error('Enter a valid whole UGX transfer charge.');
  if(!Number.isSafeInteger(input.principalUGX)||input.principalUGX<=0||!input.actorId)
    throw new Error('A positive whole UGX principal and authenticated actor are required.');
  const transferRef=doc(database,'finance_transfers_v1',id);
  const matches=(record:PortfolioTransfer)=>record.id===id&&record.tenantId===input.tenantId
    &&record.source.accountId===input.sourceAccountId&&record.destination.accountId===input.destinationAccountId
    &&record.principalUGX===input.principalUGX&&record.chargeUGX===charge&&record.initiatedBy===input.actorId
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
    const [source, destination, sourcePortfolio, destinationPortfolio] = await Promise.all([
      tx.get(sourceRef), tx.get(destinationRef),
      registered(input.sourceAccountId) ? tx.get(registry(input.sourceAccountId)) : undefined,
      registered(input.destinationAccountId) ? tx.get(registry(input.destinationAccountId)) : undefined
    ]);
    if (!source.exists() || !destination.exists()) throw new Error('Both accounts must exist and have verified openings.');
    const from = source.data() as ManagementPaymentAccount;
    const to = destination.data() as ManagementPaymentAccount;
    if (from.accountId !== input.sourceAccountId || to.accountId !== input.destinationAccountId)
      throw new Error('Funding account identity mismatch.');
    const fromEndpoint = resolveTransferEndpoint(from, sourcePortfolio?.data() as FinancialPortfolio | undefined, input.tenantId, true);
    const toEndpoint = resolveTransferEndpoint(to, destinationPortfolio?.data() as FinancialPortfolio | undefined, input.tenantId, false);
    if (!allowsPortfolioTransfer(fromEndpoint, toEndpoint)) throw new Error('This transfer route is unavailable.');
    const record=definePortfolioTransfer({id,tenantId:input.tenantId,source:fromEndpoint,destination:toEndpoint,
      principalUGX:input.principalUGX,chargeUGX:charge,reference:input.reference,
      initiatedBy:input.actorId,initiatedAt:new Date().toISOString()});
    const remaining=from.balanceUGX-record.principalUGX-record.chargeUGX,received=to.balanceUGX+record.principalUGX;
    if(!Number.isSafeInteger(from.balanceUGX)||!Number.isSafeInteger(to.balanceUGX)||remaining<0
      ||!Number.isSafeInteger(remaining)||!Number.isSafeInteger(received))throw new Error('Insufficient source funds or balance overflow.');
    const now=serverTimestamp();
    const date = kampalaBusinessDate(new Date(record.initiatedAt));
    for(const [endpoint,sign,entry] of [[record.source,-1,record.sourceMovement],[record.destination,1,record.destinationMovement]] as const){
      tx.set(doc(database,entry.collection,entry.id),{
        tenantId:record.tenantId,accountDocumentId:endpoint.accountDocumentId,portfolioTransferId:record.id,
        amount:record.principalUGX,accountDeltaUGX:sign*record.principalUGX,
        type:sign<0?'outgoing':'incoming',movementClass:sign<0?'transfer_out':'transfer_in',
        source:sign<0?'Transfer to '+record.destination.name:'Transfer from '+record.source.name,
        reference_number:record.reference,postedBy:input.actorId,date,branchId:endpoint.branchId,createdAt:now,updatedAt:now
      });
    }
    if (record.chargeMovement) {
      tx.set(doc(database, record.chargeMovement.collection, record.chargeMovement.id), {
        tenantId: record.tenantId, accountDocumentId: record.source.accountDocumentId,
        portfolioTransferId: record.id, amount: record.chargeUGX, accountDeltaUGX: -record.chargeUGX,
        type: 'outgoing', movementClass: 'transfer_charge', source: 'Transfer charge',
        reference_number: record.reference, postedBy: input.actorId, date, branchId: record.source.branchId, createdAt: now, updatedAt: now
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
