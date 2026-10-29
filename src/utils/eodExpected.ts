import type { Sale } from '../types';
import { isActiveSale } from './activeSales';
import { eodAmountNumber, sumEodAmounts } from './eodMoney';
import { isBusinessDate, timestampBusinessDate } from './eodBusinessDate';
export const EOD_PAYMENT_CHANNELS = ['cash', 'momo', 'airtel', 'card', 'insurance', 'institutional_credit', 'staff_welfare'] as const;
export function expectedEodSales(sales: Sale[], tenantId: string, branchId: string, businessDate: string, shiftId: string, shiftWindow?: {startTime:string;endTime:string}) {
  const nextDate = isBusinessDate(businessDate) ? new Date(Date.parse(`${businessDate}T12:00:00Z`) + 86400000).toISOString().slice(0,10) : '';
  const scoped = sales.filter(s => s.tenantId === tenantId && s.branchId === branchId && isActiveSale(s) && ['completed', 'active'].includes(s.status));
  const filtered = scoped.filter(s => s.eodShift?.version === 1 && s.eodShift.timeZone === 'Africa/Kampala' && s.eodShift.businessDate === businessDate && s.eodShift.shiftId === shiftId);
  const values = Object.fromEntries(EOD_PAYMENT_CHANNELS.map(c => [c, [] as number[]])) as Record<typeof EOD_PAYMENT_CHANNELS[number], number[]>;
  const channel = (method: string | undefined) => ({ cash: 'cash', mtn_momo: 'momo', airtel_money: 'airtel', card: 'card', insurance: 'insurance', institutional_credit: 'institutional_credit', credit: 'institutional_credit', staff_welfare: 'staff_welfare' } as const)[method || ''];
  const add = (method: string | undefined, amount: unknown) => { const c = channel(method); if (c) values[c].push(eodAmountNumber(amount)); };
  for (const sale of filtered) {
    const total = eodAmountNumber(sale.totalAmount ?? sale.total ?? 0);
    if (sale.paymentMethod === 'staff_welfare' && sale.secondaryPaymentMethod) {
      const welfare = eodAmountNumber(sale.welfareAmount ?? 0);
      add('staff_welfare', welfare);
      add(sale.secondaryPaymentMethod, sale.secondaryAmount ?? total - welfare);
    } else add(sale.paymentMethod, total);
  }
  const totals = Object.fromEntries(EOD_PAYMENT_CHANNELS.map(c => [c, sumEodAmounts(values[c])])) as Record<typeof EOD_PAYMENT_CHANNELS[number], number>;
  const unattributedSales = scoped.filter(s => {
    if(s.eodShift)return false;
    const day=timestampBusinessDate(s.timestamp);
    if(day===businessDate)return true;
    if(day!==nextDate || !shiftWindow || shiftWindow.startTime<=shiftWindow.endTime)return false;
    const localTime=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Kampala',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(s.timestamp));
    return localTime<shiftWindow.endTime;
  });
  return { computedExpected: { ...totals, total: sumEodAmounts(Object.values(totals)) }, relevantSalesCount: filtered.length,
    unattributedSales, unattributedSalesCount: unattributedSales.length };
}
