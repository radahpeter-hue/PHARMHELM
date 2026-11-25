import {isBusinessDate,kampalaBusinessDate} from '../../utils/eodBusinessDate';

export const payrollMonthStart = (now = new Date()) => kampalaBusinessDate(now).slice(0,7)+'-01';
export const payrollMonthEnd = (now = new Date()) => {
 const start=payrollMonthStart(now);
 return new Date(Date.UTC(Number(start.slice(0,4)),Number(start.slice(5,7)),0)).toISOString().slice(0,10);
};
export function validatePayrollPeriod(start:string,end:string) {
 if(!isBusinessDate(start)||!isBusinessDate(end)||start>end||(Date.parse(end)-Date.parse(start))/86400000>366)throw Error('Select a valid payroll period of no more than 367 days.');
}
export function payrollSummary(batches:any[],legacy:any[]) {
 const total=(statuses:string[],value:(b:any)=>number)=>batches.filter(b=>statuses.includes(b.status)).reduce((sum,b)=>sum+value(b),0);
 return {
  pending:total(['pending_finance'],b=>b.totals.net),
  returned:total(['returned'],b=>b.totals.net),
  outstanding:total(['approved','partial'],b=>Math.max(0,b.totals.net-b.paidUGX)),
  paid:total(['approved','partial','paid'],b=>b.paidUGX),
  legacy:legacy.filter(p=>p.payrollVersion!==11).reduce((sum,p)=>sum+Number(p.net_salary||0),0)
 };
}
export function payrollOverlap(start:string,end:string,batches:any[],ownId?:string) {
 return batches.find(b=>b.id!==ownId && ['draft','pending_finance','returned','approved','partial','paid'].includes(b.status) && b.periodStart<=end && b.periodEnd>=start);
}
export const legacyRejectedPayroll = (expenses:any[]) => expenses.filter(e=>e.payrollVersion!==11 && e.source==='hr_salary' && String(e.status).toLowerCase()==='rejected');
