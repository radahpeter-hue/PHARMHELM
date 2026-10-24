import { doc, runTransaction, Timestamp, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';

export function attendanceDocumentId(tenantId: string, staffId: string, dateISO: string): string {
  if (!/^[a-zA-Z0-9_-]{1,150}$/.test(tenantId) || !/^[a-zA-Z0-9_-]{1,150}$/.test(staffId)
    || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateISO)
    || Number.isNaN(Date.parse(dateISO))) throw new Error('Invalid attendance tenant, staff or date');
  return tenantId + '_' + staffId + '_' + dateISO;
}

export async function submitAttendanceRecord(input: {
  tenantId: string; staffId: string; date: string; staff_name: string;
  branch_id: string; status: 'present' | 'absent' | 'on-leave';
  check_in_time: string | null; check_out_time: string | null;
  hours_worked: number; loggedByUid: string;
}, connection: Firestore = db): Promise<string> {
  const id = attendanceDocumentId(input.tenantId, input.staffId, input.date);
  if (!input.loggedByUid || !Number.isFinite(input.hours_worked) || input.hours_worked < 0 || input.hours_worked > 24) {
    throw new Error('Invalid attendance hours or actor');
  }
  if (input.status !== 'present' && input.hours_worked !== 0) throw new Error('Only present attendance can record worked hours');
  const ref = doc(connection, 'attendance', id);
  await runTransaction(connection, async tx => {
    const existing = await tx.get(ref);
    if (existing.exists()) throw new Error('Attendance for this staff member and day already exists. Review the existing record.');
    const now = Timestamp.now();
    tx.set(ref, { ...input, approval_status: 'Submitted', createdAt: now, updatedAt: now });
  });
  return id;
}
