/** Only independently approved hours are evidence of remuneration. Paid leave also
 * requires an approved leave covering that date; request creation date is irrelevant. */
export function approvedPayableHours(staffId: string, from: string, to: string, attendance: any[], leaves: any[]): number {
  const dates = new Set<string>();
  let hours = 0;
  for (const row of attendance) {
    if (row.staffId !== staffId || row.date < from || row.date > to || row.approval_status !== 'Approved') continue;
    const paidLeave = row.status === 'on-leave' && leaves.some(leave =>
      (leave.staffId === staffId || leave.staff_id === staffId) && leave.status === 'Approved'
      && leave.leave_type !== 'Unpaid' && (leave.startDate || leave.start_date) <= row.date
      && (leave.endDate || leave.end_date) >= row.date);
    if (row.status !== 'present' && !paidLeave) continue;
    if (dates.has(row.date) || !Number.isFinite(row.hours_worked) || row.hours_worked < 0 || row.hours_worked > 24)
      throw new Error('Duplicate or invalid approved timesheet. HR reconciliation is required.');
    dates.add(row.date);
    hours += row.hours_worked;
  }
  return hours;
}
