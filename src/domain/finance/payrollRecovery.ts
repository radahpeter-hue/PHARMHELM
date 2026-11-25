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
 return batches.find(b=>b.id!==ownId && !(b.status==='draft'&&b.coverageVersion===1&&b.revision===1&&b.nextIndex===0) && ['draft','pending_finance','returned','approved','partial','paid'].includes(b.status) && b.periodStart<=end && b.periodEnd>=start);
}
export const legacyRejectedPayroll = (expenses:any[]) => expenses.filter(e=>e.payrollVersion!==11 && e.source==='hr_salary' && String(e.status).toLowerCase()==='rejected');

/** Legacy paid labels are not proof of payment. Reserve known historical coverage
 * for reconciliation instead of silently treating it as either payable or unpaid. */
export function legacyPayrollOverlap(start:string,end:string,rows:any[]) {
 return rows.find(row=>{
  if(row.payrollVersion===11)return false;
  if(isBusinessDate(row.periodStart)&&isBusinessDate(row.periodEnd))return row.periodStart<=end&&row.periodEnd>=start;
  let month=String(row.month||'');
  const named=month.match(/^([a-z]+)\s+(\d{4})$/i);
  if(named){
   const index=['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(named[1].toLowerCase());
   if(index<0)return false;
   month=named[2]+'-'+String(index+1).padStart(2,'0');
  }
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return false;
  const last=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
  return month+'-01'<=end&&last>=start;
 });
}
