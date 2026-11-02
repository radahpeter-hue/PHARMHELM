import {eodAmountNumber} from '../../utils/eodMoney';
import {builtInPortfolioId} from './builtInPortfolios';

export type EodPostingChannel='cash'|'momo'|'airtel'|'card';
export interface EodRoutingPlanEntry {
 channel:EodPostingChannel;
 accountId:string;
 amountUGX:number;
 externalReference:string;
 branchId:string;
 reconciliationId:string;
}
export interface EodRoutingInput {
 tenantId:string;
 branchId:string;
 reconciliationId:string;
 actual:Record<EodPostingChannel,number>;
 cardBankPortfolioId?:string|null;
}
/**
 * Deterministic plan for future atomic EOD posting. Produces no writes.
 * Every posting must be committed under Finance authorization, paired with
 * an immutable ledger entry and the authoritative account balance update.
 */
export function planEodPortfolioRouting(input:EodRoutingInput):EodRoutingPlanEntry[] {
 const {tenantId,branchId,reconciliationId,actual,cardBankPortfolioId}=input;
 if(!tenantId||!branchId||!reconciliationId||!/^[-A-Za-z0-9_]+$/.test(reconciliationId))
  throw new Error('Tenant, branch and stable EOD identity are required.');
 const destinations:Record<EodPostingChannel,string|undefined>={
  cash:builtInPortfolioId('branch_cash_sales',branchId),
  momo:builtInPortfolioId('mtn_mobile_money'),
  airtel:builtInPortfolioId('airtel_mobile_money'),
  card:cardBankPortfolioId||undefined
 };
 const result:EodRoutingPlanEntry[]=[];
 for(const channel of ['cash','momo','airtel','card'] as const) {
  const amountUGX=eodAmountNumber(actual[channel]);
  if(!Number.isSafeInteger(amountUGX)||amountUGX<0)throw new Error('Authoritative EOD posting requires nonnegative whole UGX; fractional amounts must be reconciled separately.');
  if(amountUGX===0)continue;
  const accountId=destinations[channel];
  if(!accountId)throw new Error('Card sales have no configured branch settlement bank account.');
  if(!/^[-A-Za-z0-9_]+$/.test(accountId))throw new Error('Invalid destination identity.');
  result.push({channel,accountId,amountUGX,branchId,reconciliationId,
   externalReference:'eod_'+reconciliationId+'_'+channel});
 }
 return result;
}
