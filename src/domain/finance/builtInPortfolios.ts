import {
  defineFinancialPortfolio, type FinancialPortfolio, type FinancialPortfolioClassification,
  type FinancialPortfolioScope
} from './financialPortfolio';

/** Change 033: canonical system identities; never manufacture balances or post money. */
export const BUILT_IN_PORTFOLIO_KEYS = [
  'branch_cash_sales', 'bank', 'mtn_mobile_money', 'airtel_mobile_money', 'petty_cash'
] as const;
export type BuiltInPortfolioKey = typeof BUILT_IN_PORTFOLIO_KEYS[number];

const config: Record<BuiltInPortfolioKey, {
  name:string; classification:FinancialPortfolioClassification;
  scope:'organisation'|'branch'; supportsChildAccounts:boolean;
}> = {
  branch_cash_sales:{name:'Branch Cash Sales',classification:'cash_equivalent',scope:'branch',supportsChildAccounts:false},
  bank:{name:'Bank',classification:'bank',scope:'organisation',supportsChildAccounts:true},
  mtn_mobile_money:{name:'MTN Mobile Money',classification:'mobile_money',scope:'organisation',supportsChildAccounts:false},
  airtel_mobile_money:{name:'Airtel Mobile Money',classification:'mobile_money',scope:'organisation',supportsChildAccounts:false},
  petty_cash:{name:'Petty Cash',classification:'petty_cash',scope:'branch',supportsChildAccounts:false}
};
export function builtInPortfolioId(key:BuiltInPortfolioKey, branchId?:string):string {
  if(config[key].scope==='branch' && !branchId)throw new Error('Branch ID required.');
  if(config[key].scope==='organisation' && branchId)throw new Error('Organisation portfolio cannot carry a branch.');
  return config[key].scope==='branch' ? `system_${key}_${branchId}` : `system_${key}`;
}
export function defineBuiltInPortfolio(input:{
  tenantId:string;key:BuiltInPortfolioKey;branchId?:string;
  createdBy:string;createdAt:string
}):FinancialPortfolio {
  const entry=config[input.key];
  const scope:FinancialPortfolioScope=entry.scope==='branch'
    ? {kind:'branch',branchId:input.branchId||''}
    : {kind:'organisation'};
  return defineFinancialPortfolio({
    id:builtInPortfolioId(input.key,input.branchId),
    tenantId:input.tenantId,
    name:entry.name,
    description:'System financial portfolio',
    classification:entry.classification,
    scope,currency:'UGX',origin:'system',
    supportsChildAccounts:entry.supportsChildAccounts,
    allowsTransfersIn:true,allowsTransfersOut:true,
    createdBy:input.createdBy,createdAt:input.createdAt
  });
}
