/** Level 12: whole-UGX reservation arithmetic. Historical limits never mint funds. */
export const WELFARE_ACCOUNT = 'system_welfare_fund';
export const WELFARE_RECORDS = 'finance_welfare_v1';
export const WELFARE_SOURCE = 'welfare_funding_v12';
export type WelfareEmployee = {kind:'employee';tenantId:string;staffId:string;branchId:string;allocatedUGX:number;utilizedUGX:number;recalledUGX:number;committedUGX:number;balanceUGX:number;lastEventId:string};
export type WelfareEvent = {kind:'event';id:string;tenantId:string;staffId:string;branchId:string;type:'allocation'|'recall'|'utilization';amountUGX:number;reason:string;reference:string;originalAllocationId:string;actorId:string;date:string;paymentReference:string;balanceBeforeUGX:number;balanceAfterUGX:number;employeeBeforeUGX:number;employeeAfterUGX:number};
export const welfareEmployeeId=(tenant:string,staffId:string)=>tenant+'__employee__'+staffId;
export function wholeUGX(value:number,positive=false){if(!Number.isSafeInteger(value)||value<(positive?1:0))throw Error('A valid whole UGX amount is required.');return value;}
export function reserveWelfare(fund:{balanceUGX:number;reservedUGX:number},employee:WelfareEmployee,type:WelfareEvent['type'],amount:number){
 wholeUGX(amount,true);wholeUGX(fund.balanceUGX);wholeUGX(fund.reservedUGX);
 for(const value of [employee.allocatedUGX,employee.utilizedUGX,employee.recalledUGX,employee.committedUGX,employee.balanceUGX])wholeUGX(value);
 if(employee.balanceUGX!==employee.allocatedUGX-employee.utilizedUGX-employee.recalledUGX||employee.committedUGX>employee.balanceUGX||fund.reservedUGX>fund.balanceUGX)throw Error('Welfare reconciliation is required.');
 if(type==='allocation'&&amount>fund.balanceUGX-fund.reservedUGX)throw Error('Insufficient unallocated welfare funds.');
 if(type!=='allocation'&&amount>employee.balanceUGX-employee.committedUGX)throw Error('Amount exceeds the available, uncommitted employee balance.');
 const next={...employee,allocatedUGX:employee.allocatedUGX+(type==='allocation'?amount:0),utilizedUGX:employee.utilizedUGX+(type==='utilization'?amount:0),recalledUGX:employee.recalledUGX+(type==='recall'?amount:0),balanceUGX:employee.balanceUGX+(type==='allocation'?amount:-amount)};
 const balanceUGX=fund.balanceUGX-(type==='utilization'?amount:0),reservedUGX=fund.reservedUGX+(type==='allocation'?amount:-amount);
 wholeUGX(balanceUGX);wholeUGX(reservedUGX);wholeUGX(next.allocatedUGX);
 if(reservedUGX>balanceUGX)throw Error('Reserved welfare funds exceed the fund balance.');
 return {employee:next,balanceUGX,reservedUGX,unallocatedUGX:balanceUGX-reservedUGX};
}
