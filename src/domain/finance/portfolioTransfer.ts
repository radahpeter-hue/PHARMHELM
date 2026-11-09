/** Level 5 / Change 059. Pure transfer contract; no financial writes. */
export type TransferLedger = 'banking_records' | 'petty_cash_ledger';
export interface TransferEndpoint {
  tenantId:string;
  portfolioId:string;
  accountId:string;
  accountDocumentId:string;
  name:string;
  branchId:string;
  kind:'bank'|'petty_cash';
}
export interface PortfolioTransfer {
  id:string;
  tenantId:string;
  transferClass:'intra_portfolio'|'inter_portfolio';
  source:TransferEndpoint;
  destination:TransferEndpoint;
  principalUGX:number;
  chargeUGX:number;
  currency:'UGX';
  reference:string;
  idempotencyKey:string;
  initiatedBy:string;
  initiatedAt:string;
  status:'completed';
  sourceMovement:{collection:TransferLedger;id:string};
  destinationMovement:{collection:TransferLedger;id:string};
  chargeMovement:{collection:TransferLedger;id:string}|null;
  auditVersion:1;
  reversalOf:string|null;
}

const identifier={test:(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,150}$/.test(value)};
const ledger=(endpoint:TransferEndpoint):TransferLedger=>endpoint.kind==='bank'?'banking_records':'petty_cash_ledger';
export function normalizeTransferReference(value:string):string {
  if(typeof value!=='string'||value.trim().length<5||value.trim().length>100)
    throw new Error('Enter a transfer reference of 5 to 100 characters.');
  return value.trim().toUpperCase();
}
/** One tenant/business reference is one intent, including after a lost acknowledgement. */
export async function portfolioTransferIdentity(tenantId:string,reference:string):Promise<string> {
  if(!identifier.test(tenantId)||!globalThis.crypto?.subtle)throw new Error('Secure tenant transfer identity required.');
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([tenantId,normalizeTransferReference(reference)])));
  return 'pt_'+Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
}
export function definePortfolioTransfer(input:Pick<PortfolioTransfer,
  'id'|'tenantId'|'source'|'destination'|'principalUGX'|'chargeUGX'|'reference'|'initiatedBy'|'initiatedAt'>):PortfolioTransfer {
  if(!/^pt_[a-f0-9]{64}$/.test(input.id)||!identifier.test(input.tenantId)||!identifier.test(input.initiatedBy))
    throw new Error('Valid transfer, tenant and actor identities required.');
  for(const endpoint of [input.source,input.destination]){
    if(!endpoint||endpoint.tenantId!==input.tenantId||!identifier.test(endpoint.accountId)||!identifier.test(endpoint.portfolioId)
      ||endpoint.accountDocumentId!==input.tenantId+'_'+endpoint.accountId
      ||!['bank','petty_cash'].includes(endpoint.kind)||typeof endpoint.name!=='string'||!endpoint.name.trim()
      ||typeof endpoint.branchId!=='string'||(endpoint.branchId!==''&&!identifier.test(endpoint.branchId)))
      throw new Error('Transfer endpoint identity or tenant mismatch.');
  }
  if(input.source.accountDocumentId===input.destination.accountDocumentId)throw new Error('Select different source and destination accounts.');
  if(!Number.isSafeInteger(input.principalUGX)||input.principalUGX<=0||!Number.isSafeInteger(input.chargeUGX)||input.chargeUGX<0
    ||!Number.isSafeInteger(input.principalUGX+input.chargeUGX))throw new Error('Principal and charge must be valid whole UGX amounts.');
  if(typeof input.initiatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(input.initiatedAt)||!Number.isFinite(Date.parse(input.initiatedAt)))
    throw new Error('Transfer initiation timestamp required.');
  return {...input,reference:normalizeTransferReference(input.reference),
    source:{...input.source},destination:{...input.destination},
    transferClass:input.source.portfolioId===input.destination.portfolioId?'intra_portfolio':'inter_portfolio',
    currency:'UGX',idempotencyKey:input.id,status:'completed',auditVersion:1,reversalOf:null,
    sourceMovement:{collection:ledger(input.source),id:input.id+'_out'},
    destinationMovement:{collection:ledger(input.destination),id:input.id+'_in'},
    chargeMovement:input.chargeUGX?{collection:ledger(input.source),id:input.id+'_fee'}:null};
}
