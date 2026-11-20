type RecordData = Record<string, any>;
const dayMs = 86400000;
const dayNumber = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? Date.parse(date + 'T00:00:00Z') / dayMs : NaN;
const clockMinute = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time || '') ? Number(time.slice(0,2)) * 60 + Number(time.slice(3)) : NaN;
/** Approved clock intervals are unioned, including overlaps and duplicate imports. */
export function payableAttendance(records: RecordData[], leaves: RecordData[], start: string, end: string, hoursPerDay: number) {
  const first = dayNumber(start), last = dayNumber(end);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first > last || last - first > 366 || hoursPerDay <= 0 || hoursPerDay > 24) throw new Error('Payroll periods must be valid and no longer than 367 days.');
  const previousDay=new Date((first-1)*dayMs).toISOString().slice(0,10);
  const inPeriod = records.filter(r => r.date >= previousDay && r.date <= end);
  const verified = inPeriod.filter(r => r.verificationStatus === 'approved' && r.verifiedBy);
  const intervals: [number, number, number][] = [];
  const unclocked = new Map<number, number[]>();
  const warnings: string[] = [];
  for (const record of verified) {
    const day = dayNumber(record.date);
    if (record.status !== 'present' || !Number.isFinite(day)) continue;
    const from = clockMinute(record.check_in_time), to = clockMinute(record.check_out_time);
    if (Number.isFinite(from) && Number.isFinite(to) && from !== to) {
      const duration=to-from+(to<from?1440:0);
      const approvedHours=Number(record.hours_worked);
      if(!Number.isFinite(approvedHours)||approvedHours<0||approvedHours>duration/60+0.01){warnings.push('Invalid verified hours excluded; correct the attendance record.');continue;}
      const begin=Math.max(first*1440,day*1440+from),finish=Math.min((last+1)*1440,day*1440+from+duration);
      if(finish>begin)intervals.push([begin,finish,Math.min(1,approvedHours*60/duration)]);
    } else if (day>=first && Number.isFinite(record.hours_worked) && record.hours_worked >= 0 && record.hours_worked <= 24) {
      unclocked.set(day, [...(unclocked.get(day) || []), record.hours_worked]);
    }
  }
  // At each instant, overlapping imports contribute at most one payable interval.
  // Density preserves verified break-adjusted hours without inventing a break time.
  const points=[...new Set(intervals.flatMap(([from,to])=>[from,to]))].sort((a,b)=>a-b);
  const byDay = new Map<number, number>();
  for(let i=1;i<points.length;i++){
    const from=points[i-1],to=points[i];
    const density=Math.max(0,...intervals.filter(r=>r[0]<to&&r[1]>from).map(r=>r[2]));
    if(!density)continue;
    for(let day=Math.floor(from/1440);day<=Math.floor((to-1)/1440);day++){
      byDay.set(day,(byDay.get(day)||0)+(Math.min(to,(day+1)*1440)-Math.max(from,day*1440))*density/60);
    }
  }
  for (const [day,values] of unclocked) {
    if (values.length === 1 && !byDay.has(day)) byDay.set(day,values[0]);
    else warnings.push('Ambiguous duplicate attendance without clock times excluded; correct attendance before submission.');
  }
  // An approved leave entitlement is bounded by its explicit total days and actual date overlap.
  const paidLeave = new Map<number, number>();
  const unpaidDays = new Set<number>();
  for (const leave of leaves.filter(l => String(l.status).toLowerCase() === 'approved')) {
    const from = dayNumber(leave.start_date || leave.startDate), to = dayNumber(leave.end_date || leave.endDate);
    const days = Number(leave.total_days ?? leave.totalDays);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || !Number.isFinite(days) || days <= 0) continue;
    const leaveType=String(leave.leave_type || leave.leaveType).toLowerCase().replace(/ leave$/,'');
    const unpaid = leaveType.includes('unpaid') || leave.is_paid === false;
    if(!unpaid && leave.is_paid!==true && !['annual','sick','study','maternity','paternity','compassionate'].includes(leaveType)){warnings.push('Approved leave has no explicit payable classification; HR must verify the entitlement.');continue;}
    const daily = Math.min(hoursPerDay, days * hoursPerDay / (to - from + 1));
    for (let day = Math.max(first,from); day <= Math.min(last,to); day++) {
      if (unpaid) unpaidDays.add(day);
      else paidLeave.set(day, Math.max(paidLeave.get(day) || 0, daily));
    }
  }
  const workedHours = [...byDay.values()].reduce((a,b) => a+b,0);
  const paidLeaveHours = [...paidLeave].reduce((sum,[day,hours]) => sum + (unpaidDays.has(day) ? 0 : Math.max(0,hours - (byDay.get(day) || 0))),0);
  if (!inPeriod.length) warnings.push('No attendance records for this period.');
  else if (!verified.length) warnings.push('Attendance exists but has not been verified.');
  else if (!workedHours) warnings.push('Verified attendance has zero payable worked hours.');
  return {workedHours,paidLeaveHours,payableHours:workedHours+paidLeaveHours, attendanceState: !inPeriod.length ? 'missing' : !verified.length ? 'unverified' : workedHours ? 'verified' : 'verified_zero', warnings:[...new Set(warnings)]};
}
