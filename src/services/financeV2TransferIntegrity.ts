import {planFinanceV2Transfer, type FinanceV2TransferInput, type FinanceV2AccountSnapshot} from './financeV2TransferPolicy';

export type FinanceV2TransferAudit = {
  accountDeltas: ReadonlyArray<{accountId:string;beforeUGX:number;deltaUGX:number;afterUGX:number}>;
  movements: ReadonlyArray<{accountId:string;deltaUGX:number;purpose:'PRINCIPAL'|'CHARGE'}>;
  externalChargeExpenseUGX:number;
};

/**
 * Independently verifies the full financial proof before an authorised backend
 * is permitted to commit it. It does NOT grant client Firestore write access.
 */
export function verifyFinanceV2TransferAudit(
 input:FinanceV2TransferInput, accounts:readonly FinanceV2AccountSnapshot[], audit:FinanceV2TransferAudit
):void {
 const canonical=planFinanceV2Transfer(input,accounts);
 const byId=new Map(accounts.map(a=>[a.accountId,a]));
 if (audit.accountDeltas.length!==canonical.accountDeltas.length ||
     audit.movements.length!==canonical.movements.length ||
     audit.externalChargeExpenseUGX!==canonical.externalChargeExpenseUGX) throw new Error('Transfer proof does not match canonical plan');
 for(let i=0;i<canonical.movements.length;i++){
  const actual=audit.movements[i],expected=canonical.movements[i];
  if(!actual||actual.accountId!==expected.accountId||actual.deltaUGX!==expected.deltaUGX||actual.purpose!==expected.purpose)
   throw new Error('Transfer movement mismatch');
 }
 for(let i=0;i<canonical.accountDeltas.length;i++){
  const expected=canonical.accountDeltas[i],actual=audit.accountDeltas[i];
  const before=byId.get(expected.accountId)?.balanceUGX;
  if(!actual||actual.accountId!==expected.accountId||actual.beforeUGX!==before||
     actual.deltaUGX!==expected.deltaUGX||actual.afterUGX!==before+expected.deltaUGX||
     !Number.isSafeInteger(actual.afterUGX)||actual.afterUGX<0)
   throw new Error('Transfer balance audit mismatch');
 }
 const net=audit.accountDeltas.reduce((sum,x)=>sum+x.deltaUGX,0);
 if(!Number.isSafeInteger(net)||net!==-input.chargeUGX)
  throw new Error('Principal conservation or external charge mismatch');
}
