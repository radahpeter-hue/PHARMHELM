import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedPayableHours} from '../src/services/hrPayrollAttendancePolicy';
const present={staffId:'staff',date:'2026-10-01',status:'present',hours_worked:8,approval_status:'Approved'};
const leave={staffId:'staff',status:'Approved',hr_approval_status:'Approved',ceo_approval_status:'Approved',hr_reviewed_by:'hr',ceo_reviewed_by:'ceo',leave_type:'Annual',startDate:'2026-10-02',endDate:'2026-10-03'};
test('approved work and evidenced paid leave both contribute payable hours',()=>{
 assert.equal(approvedPayableHours('staff','2026-10-01','2026-10-31',[present,{...present,date:'2026-10-02',status:'on-leave'}],[leave]),16);
});
test('submitted work, absent work and unpaid or unevidenced leave do not inflate salary',()=>{
 const rows=[{...present,approval_status:'Submitted'},{...present,status:'absent'},{...present,date:'2026-10-02',status:'on-leave'}];
 assert.equal(approvedPayableHours('staff','2026-10-01','2026-10-31',rows,[{...leave,leave_type:'Unpaid'}]),0);
 assert.equal(approvedPayableHours('staff','2026-10-01','2026-10-31',rows,[]),0);
 assert.equal(approvedPayableHours('staff','2026-10-01','2026-10-31',rows,[{...leave,hr_reviewed_by:'',ceo_reviewed_by:''}]),0);
 assert.equal(approvedPayableHours('staff','2026-10-01','2026-10-31',rows,[{...leave,hr_reviewed_by:'ceo'}]),0);
});
test('duplicate or corrupt approved hours require reconciliation',()=>{
 assert.throws(()=>approvedPayableHours('staff','2026-10-01','2026-10-31',[present,present],[]));
 assert.throws(()=>approvedPayableHours('staff','2026-10-01','2026-10-31',[{...present,hours_worked:25}],[]));
});
