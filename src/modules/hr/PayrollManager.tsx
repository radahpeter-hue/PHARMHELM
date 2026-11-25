import {payrollMonthStart,payrollMonthEnd,payrollSummary,legacyRejectedPayroll,validatePayrollPeriod,payrollOverlap,legacyPayrollOverlap} from '../../domain/finance/payrollRecovery';
import {kampalaBusinessDate} from '../../utils/eodBusinessDate';
import {payrollStatutory} from '../../domain/finance/payrollStatutory';
import {payableAttendance} from '../../domain/finance/payrollAttendance';
import {employeePayrollStatus,payrollStatusLabels,finalizePayrollLine,type PayrollLine} from '../../domain/finance/payroll';
import {submitPayroll,getPayrollRevision,type PayrollBatch} from '../../services/payrollFinanceService';
import {usePayrollBatchState} from '../../hooks/usePayrollBatches';
import { staffMatchesId } from '../../utils/operationalStaff';
import React, { useState, useEffect, useRef } from 'react';
import { 
  DollarSign, Calculator, Download, Search, CheckCircle2, Clock, 
  User, Calendar, ArrowUpRight, Save, Trash2, Edit2, X, Plus, AlertCircle, FileText,
  ShieldCheck
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { firestoreService } from '../../services/firestore';
import { Staff, AdvanceRequest, TrafficFineLog, Payslip } from '../../types';
import { toast } from 'sonner';
import { cn } from '../../utils/cn';
import { operationalStaff } from '../../utils/operationalStaff';

interface DraftPayrollRecord extends PayrollLine {
  staffId: string;
  staffName: string;
  role: string;
  employeeId: string;
  remunerationType: string;
  loggedHours: number;
  baseSalary: number;
  expectedPay: number;
  bonuses: number;
  bonusNotes: string;
  deductions: number;
  advanceDeduction: number;
  fineDeduction: number;
  nssfEmployee: number;
  nssfEmployer: number;
  paye: number;
  netSalary: number;
  reviewed: boolean;
  profileBaseSalary?: number;
  expectedHoursInMonth?: number;
  hourlyRate?: number;
  expectedHoursPerDay?: number;
  expectedDaysPerMonth?: number;
  unpaidLeaveDeduction?: number;
  approvedLeavesDesc?: string;
  rejectedLeavesDesc?: string;
  advancesDesc?: string;
}

export const PayrollManager: React.FC = () => {
  const { profile } = useAuth();
  const { tenant } = useTenant();
  const {rows:batches,loading:batchesLoading,error:batchesError} = usePayrollBatchState(profile?.tenantId);
  const submissionLock=useRef(false);
  const [recoveryConfirmed,setRecoveryConfirmed]=useState(false);
  const [confirmSubmission,setConfirmSubmission] = useState(false);
  const [legacyExpenses,setLegacyExpenses] = useState<any[]>([]);
  const [recoverySource,setRecoverySource] = useState<any>();
  const [correctionBatchId,setCorrectionBatchId] = useState<string>();
  const [restartIncomplete,setRestartIncomplete] = useState(false);
  // Payroll tax processing is controlled by tenant settings, not subscription tier.
  const [staff, setStaff] = useState<Staff[]>([]);
  const [payroll, setPayroll] = useState<any[]>([]);
  const [advances, setAdvances] = useState<AdvanceRequest[]>([]);
  const [fines, setFines] = useState<TrafficFineLog[]>([]);
  const [inputsLoaded,setInputsLoaded]=useState(false);
  const [staffLoaded,setStaffLoaded]=useState(false);
  const [payrollLoaded,setPayrollLoaded]=useState(false);
  const [attendanceLoaded,setAttendanceLoaded]=useState(false);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Date range selectors for payment period
  const [fromDate, setFromDate] = useState(()=>payrollMonthStart());
  const [toDate, setToDate] = useState(()=>kampalaBusinessDate());
  const [reportStartDate, setReportStartDate] = useState(()=>payrollMonthStart());
  const [reportEndDate, setReportEndDate] = useState(()=>payrollMonthEnd());

  // Drafts State
  const [draftPayroll, setDraftPayroll] = useState<DraftPayrollRecord[]>([]);
  const [isDraftMode, setIsDraftMode] = useState(false);
  const [cmeSessions, setCmeSessions] = useState<any[]>([]);
  const [systemSettings, setSystemSettings] = useState<any>(null);

  // Reviewing specific staff modal
  const [reviewingRecord, setReviewingRecord] = useState<DraftPayrollRecord | null>(null);

  // Form states inside review modal
  const [editBonus, setEditBonus] = useState(0);
  const [editBonusNotes, setEditBonusNotes] = useState('');
  const [editAdvanceDeduction, setEditAdvanceDeduction] = useState(0);
  const [editFineDeduction, setEditFineDeduction] = useState(0);
  const [editPAYE, setEditPAYE] = useState(0);
  const [editNSSFEmployee, setEditNSSFEmployee] = useState(0);
  const [editCustomDeduction, setEditCustomDeduction] = useState(0);

  useEffect(() => {
    setStaff([]);setAttendance([]);setPayroll([]);setLegacyExpenses([]);setAdvances([]);setFines([]);setCmeSessions([]);setLeaveRequests([]);setSystemSettings(null);
    setInputsLoaded(false);setStaffLoaded(false);setAttendanceLoaded(false);setPayrollLoaded(false);
    setDraftPayroll([]);setIsDraftMode(false);setConfirmSubmission(false);setRecoverySource(undefined);setCorrectionBatchId(undefined);
    if(!profile?.tenantId)return;
    const tenantId=profile.tenantId;
    const ready=new Set<string>();let active=true;
    const subscribe=<T,>(name:string,callback:(data:T[])=>void)=>firestoreService.subscribeToCollection<T>(name,tenantId,data=>{
      if(!active)return;callback(data);ready.add(name);if(ready.size===9)setInputsLoaded(true);
    });
    const stops=[
      subscribe<Staff>('staff',data=>{setStaff(data);setStaffLoaded(true);}),
      subscribe<AdvanceRequest>('advance_requests',setAdvances),
      subscribe<TrafficFineLog>('traffic_fine_logs',setFines),
      subscribe<any>('management_expenses',setLegacyExpenses),
      subscribe<any>('attendance',data=>{setAttendance(data);setAttendanceLoaded(true);}),
      subscribe<any>('cme_sessions',setCmeSessions),
      subscribe<any>('leave_requests',setLeaveRequests),
      subscribe<any>('system_settings',data=>setSystemSettings(data[0]||null)),
      subscribe<any>('payroll',data=>{setPayroll([...data].sort((a,b)=>(b.month||'').localeCompare(a.month||'')));setPayrollLoaded(true);})
    ];
    return ()=>{active=false;stops.forEach(stop=>stop?.());};
  }, [profile?.tenantId]);

  const canonicalStaff = operationalStaff(staff);

  // Dynamic CME point retriever matching either fullName or full_name (case-insensitive) for YTD performance check
  const getStaffCmePoints = (targetStaffId: string) => {
    const staffMember = staff.find(s => staffMatchesId(s, targetStaffId));
    if (!staffMember) return 0;
    
    const namesToMatch = [
      staffMember.fullName,
      staffMember.full_name,
      staffMember.displayName
    ].filter(Boolean).map(n => n!.toLowerCase());

    const staffSessions = cmeSessions.filter(session => {
      const isPresenter = session.presenter && namesToMatch.some(n => session.presenter!.toLowerCase().includes(n));
      const isAttendee = session.attendees && session.attendees.some(att => namesToMatch.some(n => att.toLowerCase().includes(n)));
      return isPresenter || isAttendee;
    });

    return staffSessions.reduce((sum, session) => {
      const isPresenter = session.presenter && namesToMatch.some(n => session.presenter!.toLowerCase().includes(n));
      if (isPresenter) {
        return sum + (session.presenterPoints || 10.0);
      }
      if (session.attendeeScores) {
        const scoreRecord = session.attendeeScores.find((score: any) => 
          score.staffId === targetStaffId || namesToMatch.some(n => score.staffName.toLowerCase().includes(n))
        );
        if (scoreRecord) {
          return sum + (scoreRecord.totalPoints || 0);
        }
      }
      return sum + (session.attendancePoints || 5.0);
    }, 0);
  };

  // Draft calculation logic based on period and configuration
  const handleGeneratePayrollDraft = () => {
    if (canonicalStaff.length === 0) {
      toast.error('No staff records loaded.');
      return;
    }

    try {validatePayrollPeriod(fromDate,toDate);} catch(error) {toast.error((error as Error).message);return;}
    const resumable=batches.find(b=>b.periodStart===fromDate&&b.periodEnd===toDate&&b.status==='draft');
    const overlap=payrollOverlap(fromDate,toDate,batches,correctionBatchId||resumable?.id);
    if(overlap){toast.error(`Dates overlap locked payroll ${overlap.reference}. Open that payroll instead.`);return;}
    if(!inputsLoaded||!attendanceLoaded||!staffLoaded||!payrollLoaded||batchesLoading||batchesError){toast.error(batchesError||'Staff, attendance and payroll history must finish loading before calculation.');return;}
    if(!recoverySource&&!batches.some(b=>b.id===correctionBatchId&&b.legacySourceId)&&legacyPayrollOverlap(fromDate,toDate,payroll)){toast.error('Legacy payroll exists for these dates. Recover the rejected Finance request, or ask Finance to reconcile historical payment evidence before generating another payroll.');return;}
    const draftRecords: DraftPayrollRecord[] = [];

    canonicalStaff.forEach(member => {
      if (member.status !== 'active') return;

      // 1. Calculate Expected Work Hours & Hourly Rate based on Profile expected figures
      const expectedHoursPerDay = member.expected_work_hours_per_day || 8;
      const expectedDaysPerMonth = member.expected_days_per_month || 26;
      const expectedHoursInMonth = expectedHoursPerDay * expectedDaysPerMonth;
      const salaryBase = member.salary_base || member.remunerationRate || 0;
      
      // Expected Remunerations Per Hour: Base Salary divided by expected work hours of the month
      const hourlyRate = expectedHoursInMonth > 0 ? (salaryBase / expectedHoursInMonth) : 0;

      const attendanceResult = payableAttendance(
        attendance.filter(a => staffMatchesId(member,a.staffId)),
        leaveRequests.filter(l => staffMatchesId(member,l.staffId || l.staff_id)),
        fromDate,toDate,expectedHoursPerDay);
      const loggedHours = attendanceResult.workedHours;
      const paidLeaveHours = attendanceResult.paidLeaveHours;
      const basePay = attendanceResult.payableHours * hourlyRate;

      // 4. Compute normal salary advance deductions in date range
      let advanceDeduction = 0;
      const activeAdvances = advances.filter(a => 
        staffMatchesId(member, a.staff_id) &&
        a.status === 'Disbursed' &&
        a.created_at && a.created_at.split('T')[0] >= fromDate && a.created_at.split('T')[0] <= toDate
      );
      activeAdvances.forEach(adv => {
        const monthlyRepayment = adv.amount_requested / (adv.repayment_period_months || 1);
        advanceDeduction += monthlyRepayment;
      });

      const advancesDesc = activeAdvances.map(a => `UGX ${(a.amount_requested / (a.repayment_period_months || 1)).toLocaleString()} repayment of UGX ${a.amount_requested.toLocaleString()}`).join('; ') || 'None';

      // 4b. Fetch Leave requests during this period to capture approved/rejected outcomes
      const periodLeaves = leaveRequests.filter(l => 
        (staffMatchesId(member, l.staffId) || staffMatchesId(member, l.staff_id)) &&
        (l.status === 'Approved' || l.status === 'Rejected') &&
        (l.start_date || l.startDate) <= toDate && (l.end_date || l.endDate) >= fromDate
      );

      const approvedPeriodLeaves = periodLeaves.filter(l => l.status === 'Approved');
      const rejectedPeriodLeaves = periodLeaves.filter(l => l.status === 'Rejected');

      const approvedLeavesDesc = approvedPeriodLeaves.map(l => `${l.leave_type} (${l.total_days} Days)`).join(', ') || 'None';
      const rejectedLeavesDesc = rejectedPeriodLeaves.map(l => `${l.leave_type} (${l.total_days} Days)`).join(', ') || 'None';

      // Unworked unpaid-leave hours already earn no attendance pay. Do not deduct them twice.
      const unpaidLeaveDeduction = 0;

      // 5. Compute deductible Traffic Fine Logs in the selected range
      let fineDeduction = 0;
      const deductibleFines = fines.filter(f => 
        f.driver_id === member.id && 
        f.status === 'deductible' &&
        f.is_deductible === true &&
        f.date >= fromDate && f.date <= toDate
      );
      deductibleFines.forEach(fine => {
        fineDeduction += fine.fine_amount_ugx;
      });

      // 6. Tax Engine: PAYE and NSSF (Conditional based on process_tax_deductibles toggle)
      const taxEnabled = systemSettings ? systemSettings.process_tax_deductibles !== false : true;
      const empType = (member as any).employmentType || 'Full-Time';
      const {nssfEmployee,nssfEmployer,paye}=payrollStatutory(basePay,empType,taxEnabled,member.nssfEligible!==false);
      const totalDeductions = advanceDeduction + fineDeduction + nssfEmployee + paye + unpaidLeaveDeduction;

      draftRecords.push({
        staffId: member.id,
        staffName: member.full_name,
        role: member.role || member.jobTitle || 'Staff',
        employeeId: member.staff_code || member.employee_id || member.id.slice(0, 8),
        remunerationType: member.remunerationType || 'Salary',
        loggedHours,
        paidLeaveHours,
        branchId: member.branch_id || 'HQ',
        customDeduction: 0,
        recordedHours: attendance.filter(a=>staffMatchesId(member,a.staffId)&&a.date>=fromDate&&a.date<=toDate&&a.status==='present').reduce((sum,a)=>sum+Number(a.hours_worked||0),0),
        attendanceState: attendanceResult.attendanceState,
        attendanceWarnings: attendanceResult.warnings,
        unroundedBaseSalary:basePay,
        baseSalary: basePay, // Saved as computed gross pay so existing UI/downstream works
        expectedPay: basePay,
        bonuses: 0,
        bonusNotes: '',
        deductions: totalDeductions,
        advanceDeduction,
        fineDeduction,
        nssfEmployee,
        nssfEmployer,
        paye,
        netSalary: basePay - totalDeductions,
        reviewed: false,
        profileBaseSalary: salaryBase,
        expectedHoursInMonth,
        hourlyRate,
        expectedHoursPerDay,
        expectedDaysPerMonth,
        unpaidLeaveDeduction,
        approvedLeavesDesc,
        rejectedLeavesDesc,
        advancesDesc
      });
    });

    setDraftPayroll(draftRecords.map(line => {
      try { return {...finalizePayrollLine({...line,reviewed:true}),reviewed:false}; }
      catch { return line; }
    }));
    setIsDraftMode(true);
    toast.success(`Generated payroll drafts for period ${fromDate} to ${toDate}`);
  };

  // Open detailing editor modal for each individual draft payslip
  const handleOpenReview = (record: DraftPayrollRecord) => {
    setReviewingRecord(record);
    setEditBonus(record.bonuses);
    setEditBonusNotes(record.bonusNotes);
    setEditAdvanceDeduction(record.advanceDeduction);
    setEditFineDeduction(record.fineDeduction);
    setEditPAYE(record.paye);
    setEditNSSFEmployee(record.nssfEmployee);
    setEditCustomDeduction(record.deductions - (record.advanceDeduction + record.fineDeduction + record.nssfEmployee + record.paye));
  };

  const handleSaveReviewModal = () => {
    if (!reviewingRecord) return;

    const customDeductionsSum = editAdvanceDeduction + editFineDeduction + editNSSFEmployee + editPAYE + editCustomDeduction;
    const computedNet = reviewingRecord.baseSalary + editBonus - customDeductionsSum;

    if ([editBonus,editAdvanceDeduction,editFineDeduction,editNSSFEmployee,editPAYE,editCustomDeduction].some(x => !Number.isFinite(x) || x < 0) || computedNet < 0) { toast.error('Review deductions: salary cannot be negative.'); return; }
    if (editBonus > 0 && !editBonusNotes.trim()) { toast.error('Enter a reason for the bonus or allowance.'); return; }
    const updatedDraft = draftPayroll.map(item => {
      if (item.staffId === reviewingRecord.staffId) {
        return {
          ...item,
          bonuses: editBonus,
          bonusNotes: editBonusNotes,
          advanceDeduction: editAdvanceDeduction,
          fineDeduction: editFineDeduction,
          paye: editPAYE,
          nssfEmployee: editNSSFEmployee,
          customDeduction: editCustomDeduction,
          deductions: customDeductionsSum,
          netSalary: computedNet,
          reviewed: true
        };
      }
      return item;
    });

    setDraftPayroll(updatedDraft);
    setReviewingRecord(null);
    toast.success(`Payslip evaluated for ${reviewingRecord.staffName}`);
  };

  const handleFinalizeAndCommit = async () => {
    if (!profile?.tenantId || isGenerating || submissionLock.current) return;
    if(recoverySource&&!recoveryConfirmed){toast.error('Confirm the legacy payment review before recovery.');return;}
    if (draftPayroll.some(line => !line.reviewed)) { toast.error('Review every employee, including attendance exceptions, before submission.'); return; }
    submissionLock.current=true;
    setIsGenerating(true);
    try {
      const result = await submitPayroll({tenantId:profile.tenantId,actorId:profile.uid,
        actorName:profile.fullName || profile.email || profile.uid,periodStart:fromDate,periodEnd:toDate,
        lines:draftPayroll,batchId:correctionBatchId,restartIncomplete,legacySourceId:recoverySource?.id});
      toast.success(result.replayed?'This payroll already exists. No duplicate submission or payment was created.':`Payroll revision ${result.revision} submitted to Finance. No salary has been paid.`);
      setIsDraftMode(false);setDraftPayroll([]);setCorrectionBatchId(undefined);setRestartIncomplete(false);setRecoverySource(undefined);setRecoveryConfirmed(false);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Payroll submission failed. Retry to resume.'); }
    finally {submissionLock.current=false;setIsGenerating(false);}
  };

  const openReturnedPayroll = async (batch:PayrollBatch) => {
    try {
      const rows = await getPayrollRevision(batch);
      setFromDate(batch.periodStart);setToDate(batch.periodEnd);setCorrectionBatchId(batch.id);
      setDraftPayroll(rows.map(row=>({...row.line,reviewed:false})) as DraftPayrollRecord[]);setIsDraftMode(true);
    } catch {toast.error('Unable to open the returned payroll.');}
  };

  const handleExportCSV = (recordsToExport: any[], isDraft: boolean) => {
    if (recordsToExport.length === 0) {
      toast.error('No payroll logs available.');
      return;
    }

    const headers = [
      'Staff Name', 
      'Designation', 
      'Period/Month', 
      'Gross Base Pay', 
      'Assigned Bonuses', 
      'PAYE Tax Deduct.', 
      'NSSF Employee', 
      'Advances Repayment', 
      'Fines Recoveries', 
      'Total Deductions', 
      'Net Payable'
    ];

    const rows = recordsToExport.map(r => {
      if (isDraft) {
        return [
          r.staffName,
          r.role,
          `${fromDate} to ${toDate}`,
          r.baseSalary,
          r.bonuses,
          r.paye,
          r.nssfEmployee,
          r.advanceDeduction,
          r.fineDeduction,
          r.deductions,
          r.netSalary
        ];
      } else {
        const member = staff.find(s => staffMatchesId(s, r.staffId));
        return [
          r.staff_name || member?.full_name || 'N/A',
          member?.role || 'N/A',
          r.month,
          r.base_salary,
          r.allowances,
          r.paye,
          r.nssf_employee,
          r.advance_deduction,
          r.fine_deduction,
          r.deductions,
          r.net_salary
        ];
      }
    });

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(e => e.map(val => `"${val}"`).join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", isDraft ? `payroll_draft_${fromDate}_${toDate}.csv` : `payroll_report.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportStatutoryPAYEReport = () => {
    if (payroll.length === 0) {
      toast.error("No historical payroll records are present to generate reports.");
      return;
    }

    // Filter payroll records in period
    const matchedRecords = payroll.filter(p => {
      if (p.payrollVersion===11) return ['approved','partial','paid'].includes(batches.find(b=>b.id===p.batchId)?.status || '') && p.periodEnd>=reportStartDate && p.periodEnd<=reportEndDate;
      // Check date range
      if (p.paid_date && p.paid_date >= reportStartDate && p.paid_date <= reportEndDate) {
        return true;
      }
      // Or check month string (e.g. "2026-06")
      if (p.month && p.month.length === 7 && p.month >= reportStartDate.slice(0, 7) && p.month <= reportEndDate.slice(0, 7)) {
        return true;
      }
      return false;
    });

    if (matchedRecords.length === 0) {
      toast.error(`No completed payroll records found between ${reportStartDate} and ${reportEndDate}.`);
      return;
    }

    // Group and aggregate by employee
    const aggregates: Record<string, {
      staffId: string;
      staffName: string;
      role: string;
      employeeId: string;
      employmentType: string;
      totalGross: number;
      totalBasePay: number;
      totalAllowances: number;
      totalTaxable: number;
      totalPAYE: number;
      totalNssfEmployee: number;
      totalNssfEmployer: number;
      totalNet: number;
      runsCount: number;
    }> = {};

    matchedRecords.forEach(p => {
      const sId = p.staffId || 'Unknown';
      const staffMember = staff.find(s => staffMatchesId(s, sId));
      const empType = staffMember?.employmentType || 'Full-Time';
      const employeeId = staffMember?.staff_code || p.employee_id || staffMember?.employee_id || 'n/a';
      
      const grossIncome = (p.base_salary || 0) + (p.allowances || 0);
      const nssfEmployee = p.nssf_employee || 0;
      
      // Calculate taxable income according to the payroll engine: Gross base - employee NSSF
      const isRegular = empType === 'Full-Time' || empType === 'Part-Time';
      const taxableIncome = isRegular ? ((p.base_salary || 0) - nssfEmployee) : (p.base_salary || 0);

      if (!aggregates[sId]) {
        aggregates[sId] = {
          staffId: sId,
          staffName: p.staff_name || staffMember?.full_name || 'Anonymous Staff',
          role: staffMember?.role || 'Unspecified',
          employeeId: employeeId,
          employmentType: empType,
          totalGross: 0,
          totalBasePay: 0,
          totalAllowances: 0,
          totalTaxable: 0,
          totalPAYE: 0,
          totalNssfEmployee: 0,
          totalNssfEmployer: 0,
          totalNet: 0,
          runsCount: 0
        };
      }

      const agg = aggregates[sId];
      agg.totalGross += grossIncome;
      agg.totalBasePay += (p.base_salary || 0);
      agg.totalAllowances += (p.allowances || 0);
      agg.totalTaxable += taxableIncome;
      agg.totalPAYE += (p.paye || 0);
      agg.totalNssfEmployee += nssfEmployee;
      agg.totalNssfEmployer += (p.nssf_employer || 0);
      agg.totalNet += (p.net_salary || 0);
      agg.runsCount += 1;
    });

    const headers = [
      'Employee ID',
      'Employee Full Name',
      'Designation / Role',
      'Employment Type',
      'Total Base Salary (UGX)',
      'Total Allowances & Bonuses (UGX)',
      'Total Gross Income (UGX)',
      'Total Taxable Income (UGX)',
      'PAYE Tax Deductions (UGX)',
      'NSSF Employee contribution (5%) (UGX)',
      'NSSF Employer contribution (10%) (UGX)',
      'Total NSSF statutory fund (15%) (UGX)',
      'Net Remuneration Payable (UGX)',
      'Aggregated Payroll Runs'
    ];

    const rows = Object.values(aggregates).map(agg => [
      agg.employeeId,
      agg.staffName,
      agg.role,
      agg.employmentType,
      agg.totalBasePay,
      agg.totalAllowances,
      agg.totalGross,
      agg.totalTaxable,
      agg.totalPAYE,
      agg.totalNssfEmployee,
      agg.totalNssfEmployer,
      agg.totalNssfEmployee + agg.totalNssfEmployer,
      agg.totalNet,
      `${agg.runsCount} Run(s)`
    ]);

    // Format as CSV
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" 
      + [headers.join(','), ...rows.map(e => e.map(val => `"${val}"`).join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `PAYE_Statutory_Report_${reportStartDate}_to_${reportEndDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast.success(`Statutory PAYE report downloaded: ${Object.keys(aggregates).length} staff members aggregated.`);
  };

  const summary = payrollSummary(batches,payroll);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <p>Pending Finance: UGX {summary.pending.toLocaleString()}</p><p>Returned: UGX {summary.returned.toLocaleString()}</p>
        <p>Verified payments: UGX {summary.paid.toLocaleString()}</p><p>Legacy records (payment unconfirmed): UGX {Math.round(summary.legacy).toLocaleString()}</p>
      </div>
      {legacyRejectedPayroll(legacyExpenses).filter(expense=>!batches.some(b=>b.legacySourceId===expense.id)).map(expense=><div key={expense.id} className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
        <p className="font-bold">Legacy payroll rejected by Finance</p><p>{expense.description}</p>
        <p>UGX {Math.round(Number(expense.amount_ugx??expense.amount??0)).toLocaleString()} · Historical record, excluded from approved salary outstanding.</p>
        <p>Verify attendance and confirm that no payment was made before preparing a replacement linked to this request.</p>
        <button type="button" disabled={isGenerating} className="mt-3 min-h-11 rounded-lg bg-slate-900 px-4 text-white" onClick={()=>{setRecoverySource(expense);setRecoveryConfirmed(false);setIsDraftMode(false);setDraftPayroll([]);setCorrectionBatchId(undefined);}}>Prepare correction for this legacy request</button>
      </div>)}
      {recoverySource&&<div role="status" className="rounded-xl bg-amber-50 p-4 text-amber-950">Recovering rejected request: {recoverySource.description}. Select its original dates, verify attendance, then prepare the corrected draft. <label className="mt-3 flex gap-2"><input type="checkbox" disabled={isGenerating} checked={recoveryConfirmed} onChange={e=>setRecoveryConfirmed(e.target.checked)}/>I reviewed the original request and payment evidence. These salaries were not paid, and the selected dates are correct.</label> <button type="button" disabled={isGenerating} onClick={()=>{setRecoverySource(undefined);setDraftPayroll([]);setIsDraftMode(false);setConfirmSubmission(false);}}>Cancel recovery</button></div>}
      {batchesError&&<p role="alert" className="rounded-xl bg-amber-50 p-3 text-amber-950">{batchesError}</p>}
      {(!inputsLoaded||!attendanceLoaded||!staffLoaded||!payrollLoaded||batchesLoading)&&<p role="status" className="text-sm text-slate-700">Loading staff, attendance and payroll history before payroll can be prepared…</p>}
      {/* Financial Info Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-900 p-6 rounded-[32px] text-white shadow-xl shadow-slate-200 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
            <DollarSign size={100} />
          </div>
          <div className="relative z-10 space-y-4">
            <div className="h-10 w-10 bg-white/10 rounded-xl flex items-center justify-center">
              <DollarSign size={20} />
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Approved Salary Outstanding</p>
              <h3 className="text-3xl font-black tracking-tight">UGX {summary.outstanding.toLocaleString()}</h3>
            </div>
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
              <ArrowUpRight size={14} />
              <span>Approved obligations awaiting settlement</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-[32px] border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="h-10 w-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
              <Calculator size={18} />
            </div>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Headcount</span>
          </div>
          <div className="mt-4">
            <h4 className="text-2xl font-black text-slate-900">{canonicalStaff.filter(s => s.status === 'active').length} Staff</h4>
            <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">Eligible for period payslip generation</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-[32px] border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="h-10 w-10 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center">
              <Clock size={18} />
            </div>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Period Coverage</span>
          </div>
          <div className="mt-4">
            <h4 className="text-xl font-bold text-slate-900 truncate">{fromDate} to {toDate}</h4>
            <p className="text-[10px] text-slate-400 font-black uppercase mt-0.5">Editable accounting period</p>
          </div>
        </div>
      </div>

      {/* Dynamic Tax Control Toggle Banner */}
      <div className="bg-slate-50 border border-slate-200/60 p-5 rounded-[24px] flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={cn(
              "h-10 w-10 rounded-xl flex items-center justify-center transition-colors",
              (systemSettings?.process_tax_deductibles !== false) ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : "bg-zinc-100 text-zinc-500 border border-zinc-200"
            )}>
              <ShieldCheck size={20} />
            </div>
            <div>
              <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">Audit Alert: System Tax Processing Engine</h4>
              <p className="text-[11px] text-slate-500 font-medium">
                {(systemSettings?.process_tax_deductibles !== false) 
                  ? "ACTIVE — Automatic progressive PAYE & NSSF calculations are enforced on salary baselines." 
                  : "INACTIVE (OFF-SYSTEM OPERATIONAL ROUTINE) — Salary baseline will generate basic Gross remuneration payouts."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Tax Deductibles Engine</span>
            <button
              onClick={async () => {
                if (!profile?.tenantId || !systemSettings) return;
                const nextVal = systemSettings.process_tax_deductibles === false ? true : false;
                await firestoreService.updateDocument('system_settings', systemSettings.id, {
                  process_tax_deductibles: nextVal
                });
                toast.success(`Tax Deductibles processing switched ${nextVal ? 'ON' : 'OFF'}`);
              }}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                (systemSettings?.process_tax_deductibles !== false) ? "bg-emerald-600" : "bg-slate-300"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out",
                  (systemSettings?.process_tax_deductibles !== false) ? "translate-x-5" : "translate-x-0"
                )}
              />
            </button>
          </div>
      </div>

      {/* Date Select & Generator Panel */}
      <div className="bg-white p-6 rounded-[32px] border border-zinc-200 shadow-sm flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Period From Date</label>
            <div className="relative">
              <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="date"
                disabled={isDraftMode||!!correctionBatchId}
                required
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none"
                value={fromDate}
                onChange={(e) => {setFromDate(e.target.value);setRecoveryConfirmed(false);}}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Period To Date</label>
            <div className="relative">
              <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="date"
                disabled={isDraftMode||!!correctionBatchId}
                required
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none"
                value={toDate}
                onChange={(e) => {setToDate(e.target.value);setRecoveryConfirmed(false);}}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2 shrink-0">
          {isDraftMode ? (
            <button
              disabled={isGenerating}
              onClick={() => {
                setDraftPayroll([]);
                setIsDraftMode(false);
              }}
              className="px-5 py-2.5 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors uppercase tracking-wider"
            >
              Reset Draft
            </button>
          ) : (
            <button 
              disabled={!inputsLoaded||!attendanceLoaded||!staffLoaded||!payrollLoaded||batchesLoading||!!batchesError}
              onClick={handleGeneratePayrollDraft}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-lg shadow-indigo-100 uppercase tracking-wider"
            >
              <Calculator size={16} />
              Prepare Payroll Draft
            </button>
          )}
        </div>
      </div>

      {batches.length>0 && <div className="space-y-3">{batches.map(batch=><div key={batch.id} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="font-bold break-words">{batch.reference} · Revision {batch.revision} · {payrollStatusLabels[batch.status]}</p>
        {batch.status==='returned' && <button type="button" onClick={()=>openReturnedPayroll(batch)} className="min-h-11 rounded-xl bg-indigo-600 px-4 text-white">Correct and resubmit</button>}</div>
        <p>{batch.periodStart} to {batch.periodEnd} · {batch.employeeCount} employees · Net: UGX {batch.totals.net.toLocaleString()} · Paid: UGX {batch.paidUGX.toLocaleString()} · Outstanding: UGX {(batch.totals.net-batch.paidUGX).toLocaleString()}</p>
        {batch.legacySourceId&&<p>Recovered legacy request: {legacyExpenses.find(e=>e.id===batch.legacySourceId)?.description||'Historical rejected payroll'}</p>}
        {batch.returnReason && <p className="mt-2 text-amber-800">Finance correction reason: {batch.returnReason}</p>}
        {batch.status==='draft' && <p className="text-amber-800">Submission incomplete ({batch.nextIndex}/{batch.employeeCount}). Retry the same reviewed payroll to resume.</p>}
      </div>)}</div>}
      {/* Main Draft Ledger Operations Area */}
      {isDraftMode ? (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-[9px] font-black text-indigo-600 uppercase tracking-widest animate-pulse">Needs Review Before Publishing</p>
              <h3 className="text-lg font-black text-slate-900 mt-1 uppercase tracking-tight">Active Payroll Draft Period: {fromDate} to {toDate}</h3>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => handleExportCSV(draftPayroll, true)}
                className="bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded-xl text-xs font-bold uppercase transition-colors hover:bg-slate-50 flex items-center gap-1.5"
              >
                <Download size={14} /> Export Draft CSV
              </button>

            </div>
          </div>

          {batches.some(b=>b.periodStart===fromDate&&b.periodEnd===toDate&&b.status==='draft')&&<label className="flex items-center gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950"><input type="checkbox" checked={restartIncomplete} onChange={e=>setRestartIncomplete(e.target.checked)}/>Replace incomplete staging with this reviewed draft. The payroll ID is retained and the restart is audited.</label>}
          <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100 bg-slate-50/50">
                    <th className="px-6 py-4">Employee</th>
                    <th className="px-6 py-4">Remuneration Log</th>
                    <th className="px-6 py-4 text-right">Bonuses</th>
                    <th className="px-6 py-4 text-right">Total Deduct.</th>
                    <th className="px-6 py-4 text-right">Expected Net</th>
                    <th className="px-6 py-4 text-center">Status</th>
                    <th className="px-6 py-4 text-right">Receipt Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {draftPayroll.map((item) => (
                    <tr key={item.staffId} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <p className="font-bold text-slate-900 text-sm">{item.staffName}</p>
                        <p className="text-[9px] text-slate-400 font-semibold tracking-widest uppercase">ID: {item.employeeId} • {item.role}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs font-bold text-slate-800 block">UGX {item.baseSalary.toLocaleString()}</span>
                        <p className="text-[9px] text-slate-400 font-semibold uppercase mt-0.5">
                          {item.loggedHours.toFixed(1)} verified hrs @ UGX {Math.round(item.hourlyRate || 0).toLocaleString()}/hr
                        </p>
                        <p className="text-xs text-amber-800">{item.attendanceState as string} · {Number(item.recordedHours??item.loggedHours).toFixed(1)} recorded hrs</p>
                        {Array.isArray(item.attendanceWarnings)&&item.attendanceWarnings.map((warning:string)=><p key={warning} className="max-w-xs whitespace-normal text-xs text-amber-800">{warning}</p>)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-xs font-bold text-emerald-600">+UGX {item.bonuses.toLocaleString()}</span>
                        {item.bonusNotes && <p className="text-[9px] text-slate-400 truncate max-w-[120px] font-medium">{item.bonusNotes}</p>}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-xs font-bold text-rose-500">-UGX {item.deductions.toLocaleString()}</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-sm font-black text-indigo-700">UGX {item.netSalary.toLocaleString()}</span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={cn(
                          "px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border",
                          item.reviewed ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-amber-50 text-amber-700 border-amber-100"
                        )}>
                          {item.reviewed ? 'Reviewed' : 'Pending-Edit'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          onClick={() => handleOpenReview(item)}
                          className="px-3 py-1 bg-slate-100 text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-1 ml-auto"
                        >
                          <Edit2 size={12} />
                          Review & Adjust
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rounded-xl border bg-white p-4 text-slate-900">
            <p className="font-bold">Reviewed draft total: UGX {draftPayroll.reduce((sum,line)=>sum+line.netSalary,0).toLocaleString()}</p>
            <button type="button" disabled={isGenerating||draftPayroll.some(line=>!line.reviewed)||(!!recoverySource&&!recoveryConfirmed)} onClick={()=>setConfirmSubmission(true)} className="mt-3 min-h-11 rounded-xl bg-slate-900 px-5 text-white disabled:opacity-50">Submit to Finance</button>
          </div>
          {confirmSubmission&&<div role="dialog" aria-modal="true" aria-label="Confirm payroll submission" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 text-slate-900">
              <h3 className="text-lg font-bold">Confirm payroll submission</h3><p>{fromDate} to {toDate} · {draftPayroll.length} employees</p>
              <p>Net salary: UGX {draftPayroll.reduce((sum,line)=>sum+line.netSalary,0).toLocaleString()}</p>
              <p>{draftPayroll.filter(line=>line.attendanceState!=='verified').length} employees have attendance exceptions. Submission sends a locked request for Finance approval; it does not pay salaries.</p>
              <button type="button" disabled={isGenerating} onClick={()=>{setConfirmSubmission(false);handleFinalizeAndCommit();}} className="mt-4 min-h-11 rounded-lg bg-indigo-600 px-4 text-white">Confirm submission</button>
              <button type="button" disabled={isGenerating} onClick={()=>setConfirmSubmission(false)} className="ml-3 min-h-11 px-4">Go back</button>
            </div>
          </div>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-md font-black text-slate-900 uppercase tracking-tight">Finalized Payroll History</h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">Historical payroll records registered in the Global Corporate Ledger.</p>
            </div>
            {payroll.length > 0 && (
              <button 
                onClick={() => handleExportCSV(payroll, false)}
                className="bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded-xl text-xs font-bold uppercase transition-colors hover:bg-slate-50 flex items-center gap-1.5 self-start"
              >
                <Download size={14} /> Export Past Logs (CSV)
              </button>
            )}
          </div>

          {/* Statutory PAYE & NSSF Report Exporter */}
          <div className="bg-slate-50 border border-slate-200/80 p-6 rounded-[24px] space-y-4 shadow-sm animate-in fade-in duration-200">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck size={16} className="text-indigo-600" />
                  Statutory PAYE, NSSF & WHT Period Report
                </h4>
                <p className="text-[11px] text-slate-500 font-medium max-w-2xl mt-0.5">
                  Generate periodic statutory tax registers aggregated across all payment runs during the selected time period. Formatted for direct URA portal filings and compliance audits.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end bg-white p-4 rounded-xl border border-slate-200">
              <div className="space-y-1.5">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Statutory Period Start</span>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                  <input 
                    type="date"
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none"
                    value={reportStartDate}
                    onChange={(e) => setReportStartDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Statutory Period End</span>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                  <input 
                    type="date"
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none"
                    value={reportEndDate}
                    onChange={(e) => setReportEndDate(e.target.value)}
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleExportStatutoryPAYEReport}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 px-4 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-md shadow-indigo-100"
              >
                <Download size={14} />
                Download PAYE Report
              </button>
            </div>
          </div>

          <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden animate-in fade-in duration-200">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100 bg-slate-50/50">
                    <th className="px-6 py-4">Employee</th>
                    <th className="px-6 py-4">Period</th>
                    <th className="px-6 py-4 text-right">Gross Salary</th>
                    <th className="px-6 py-4 text-right">Total Deductions</th>
                    <th className="px-6 py-4 text-right">Net salary / actual paid</th>
                    <th className="px-6 py-4 text-center">Status</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payroll
                    .filter(p => {
                      const member = staff.find(s => staffMatchesId(s, p.staffId));
                      return (p.staff_name || member?.full_name || '').toLowerCase().includes(searchTerm.toLowerCase());
                    })
                    .map((pay) => {
                      const member = staff.find(s => staffMatchesId(s, pay.staffId));
                      return (
                        <tr key={pay.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-4 flex items-center gap-3">
                            <div className="h-9 w-9 bg-slate-100 text-slate-500 rounded-lg flex items-center justify-center shrink-0">
                              <User size={16} />
                            </div>
                            <div>
                              <p className="font-bold text-slate-900 text-sm">{pay.staff_name || member?.full_name || 'Staff'}</p>
                              <p className="text-[9px] text-slate-400 font-bold uppercase">{member?.role || 'Unspecified'}</p>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-xs font-semibold text-slate-600">{pay.month}</span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className="text-xs font-bold text-slate-600">UGX {(pay.base_salary || 0).toLocaleString()}</span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className="text-xs font-semibold text-rose-500">-UGX {(pay.deductions || 0).toLocaleString()}</span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className="text-xs font-black text-slate-900">UGX {(pay.net_salary || 0).toLocaleString()}</span>{pay.payrollVersion===11 && <p className="text-xs text-slate-600">Paid: UGX {(pay.paidUGX || 0).toLocaleString()} · Outstanding: UGX {Math.max(0,pay.net_salary-(pay.paidUGX || 0)).toLocaleString()}</p>}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-600 border border-emerald-100">
                              {pay.payrollVersion===11 ? payrollStatusLabels[employeePayrollStatus(batches.find(b=>b.id===pay.batchId)?.status || 'draft',pay.paidUGX || 0,pay.net_salary)] : 'Legacy: ' + (pay.status || 'unreconciled')}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex gap-2 justify-end">
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest pl-2">{pay.payrollVersion===11 ? pay.payrollReference + ' · R' + pay.revision : 'Legacy: payment evidence unreconciled'}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                  {payroll.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                        <AlertCircle className="mx-auto text-slate-200 mb-2" size={32} />
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">No Finalized Payroll History Exist.</span>
                        <p className="text-[9px] text-slate-400 font-semibold uppercase mt-0.5">Please generate a period's payroll above to commit logs.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Detail reviewing individual receipt draft payslip modal */}
      {reviewingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div role="dialog" aria-modal="true" aria-label="Employee payroll review" className="bg-white w-full max-w-xl max-h-[calc(100dvh-2rem)] flex flex-col rounded-[32px] shadow-2xl overflow-hidden text-left animate-in zoom-in duration-200">
            <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div>
                <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Individual Invoice Verification</span>
                <h3 className="text-md font-black text-slate-900 mt-0.5 uppercase tracking-tight">Receipt: {reviewingRecord.staffName}</h3>
              </div>
              <button 
                onClick={() => setReviewingRecord(null)}
                className="p-1 text-slate-400 hover:text-slate-600 focus:outline-none"
              >
                <X size={22} />
              </button>
            </div>

            <div className="p-4 sm:p-8 space-y-6 min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {/* Detailed Breakdown of Hourly Remuneration Mechanics */}
              <div className="space-y-3 bg-indigo-50/40 border border-indigo-150/75 p-5 rounded-2xl">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-[8px] font-black text-indigo-500 uppercase tracking-wider block">Employee Designation</span>
                    <span className="text-xs font-bold text-slate-800">{reviewingRecord.role}</span>
                  </div>
                  <div>
                    <span className="text-[8px] font-black text-indigo-500 uppercase tracking-wider block">Profile Base Salary</span>
                    <span className="text-xs font-extrabold text-slate-900">UGX {(reviewingRecord.profileBaseSalary || 0).toLocaleString()}</span>
                  </div>
                </div>

                <div className="h-px bg-indigo-100/70" />

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <span className="text-[8px] font-black text-indigo-500 uppercase tracking-widest block">Standard Duty hours</span>
                    <span className="text-[10px] font-medium text-slate-700 block">
                      {(reviewingRecord.expectedHoursPerDay || 8)}h/day × {(reviewingRecord.expectedDaysPerMonth || 26)}d
                    </span>
                  </div>
                  <div>
                    <span className="text-[8px] font-black text-indigo-500 uppercase tracking-widest block">Remun. Rate / Hour</span>
                    <span className="text-xs font-extrabold text-indigo-900 font-mono block">
                      UGX {Math.round(reviewingRecord.hourlyRate || 0).toLocaleString()} / hr
                    </span>
                  </div>
                  <div>
                    <span className="text-[8px] font-black text-indigo-500 uppercase tracking-widest block">Logged hours (Period)</span>
                    <span className="text-xs font-black text-emerald-700 block">
                      {reviewingRecord.loggedHours.toFixed(1)} hrs
                    </span>
                  </div>
                </div>

                <div className="h-px bg-indigo-100/70" />

                <div className="flex justify-between items-center bg-indigo-50/50 p-2.5 rounded-xl border border-indigo-100/40">
                  <span className="text-[9px] font-black text-indigo-700 uppercase tracking-widest">Calculated Gross Payment:</span>
                  <span className="text-sm font-black text-indigo-950">
                    UGX {Math.round(reviewingRecord.baseSalary).toLocaleString()}
                  </span>
                </div>
              </div>

              {Array.isArray(reviewingRecord.attendanceWarnings) && reviewingRecord.attendanceWarnings.length>0 && <div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{reviewingRecord.attendanceWarnings.join(' ')} Review any exceptional remuneration before submission.</div>}
              <p className="text-sm text-slate-700">Verified worked hours: {reviewingRecord.loggedHours.toFixed(2)} · Approved paid leave: {reviewingRecord.paidLeaveHours.toFixed(2)} hours.</p>
              {/* CME Performance Governance Hook */}
              {(() => {
                const points = getStaffCmePoints(reviewingRecord.staffId);
                const cmeTargets = systemSettings?.operationalConfig?.qa?.cmeTargets || {
                  annualPoints: 24,
                  bonusThreshold: 30,
                  deductionThreshold: 18,
                  bonusAmount: 50000,
                  deductionAmount: 20000
                };
                const isEligibleBonus = points >= cmeTargets.bonusThreshold;
                const isEligibleDeduction = points <= cmeTargets.deductionThreshold;

                return (
                  <div className="p-4 rounded-2xl border text-xs space-y-2 bg-slate-50 border-slate-200">
                    <div className="flex items-center justify-between">
                      <span className="font-extrabold text-slate-700 uppercase tracking-wide">CME YTD Points Record</span>
                      <span className="font-black px-2.5 py-0.5 bg-slate-250 text-slate-800 rounded-full">{points.toFixed(1)} CPD Points</span>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-normal">
                      Annual target is <strong>{cmeTargets.annualPoints} pts</strong>. Bonus threshold: <strong>{cmeTargets.bonusThreshold} pts</strong>. Deduction threshold: <strong>{cmeTargets.deductionThreshold} pts</strong>.
                    </p>
                    
                    {isEligibleBonus && (
                      <div className="p-3 bg-emerald-50 border border-emerald-150 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <span className="text-[9px] font-black uppercase text-emerald-800 tracking-wider block">★ CME Performance Reward Qualified</span>
                          <p className="text-[10px] text-emerald-600 font-medium">Accumulated points is above the bonus threshold!</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditBonus(cmeTargets.bonusAmount);
                            setEditBonusNotes(`CME Performance Reward YTD (Accumulated: ${points} pts)`);
                            toast.success(`CME Performance Bonus applied: +UGX ${cmeTargets.bonusAmount.toLocaleString()}`);
                          }}
                          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[9px] uppercase tracking-wider rounded-lg shrink-0 transition-colors"
                        >
                          Apply Bonus (+UGX {cmeTargets.bonusAmount.toLocaleString()})
                        </button>
                      </div>
                    )}

                    {isEligibleDeduction && (
                      <div className="p-3 bg-rose-50 border border-rose-150 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <span className="text-[9px] font-black uppercase text-rose-800 tracking-wider block">⚠️ CME Compliance Deficit Suggestion</span>
                          <p className="text-[10px] text-rose-600 font-medium">Accumulated points is below the standard threshold of {cmeTargets.deductionThreshold} pts.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditCustomDeduction(cmeTargets.deductionAmount);
                            toast.warning(`CME Compliance Fine applied: -UGX ${cmeTargets.deductionAmount.toLocaleString()}`);
                          }}
                          className="px-3 py-1 bg-rose-100 hover:bg-rose-600 text-rose-700 hover:text-white font-black text-[9px] uppercase tracking-wider rounded-lg shrink-0 transition-all border border-rose-200"
                        >
                          Apply Fine (UGX {cmeTargets.deductionAmount.toLocaleString()})
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Leaves & Advances Compliance Breakdown Card */}
              <div className="p-4 rounded-2xl border text-xs space-y-2 bg-indigo-50/40 border-indigo-100/60">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-indigo-950 uppercase tracking-wide">Leaves & Advances Period Summary</span>
                  <span className="font-black px-2.5 py-0.5 bg-indigo-100/70 text-indigo-900 rounded-full text-[10px]">Active Checks</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-zinc-400 block tracking-widest mb-0.5">Approved Leaves</span>
                    <p className="text-xs font-black text-slate-800 bg-white px-2 py-1.5 rounded-lg border border-indigo-100/30">
                      {reviewingRecord.approvedLeavesDesc || 'None'}
                    </p>
                    {reviewingRecord.unpaidLeaveDeduction && reviewingRecord.unpaidLeaveDeduction > 0 ? (
                      <span className="text-[9px] font-black text-rose-500 mt-1 block">
                        ↳ Deducting UGX {Math.round(reviewingRecord.unpaidLeaveDeduction).toLocaleString()} (Unpaid Days)
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-zinc-400 block tracking-widest mb-0.5">Rejected Leaves</span>
                    <p className="text-xs font-black text-slate-800 bg-white px-2 py-1.5 rounded-lg border border-indigo-100/30">
                      {reviewingRecord.rejectedLeavesDesc || 'None'}
                    </p>
                  </div>
                </div>

                <div className="mt-2 pt-2 border-t border-indigo-100/60">
                  <span className="text-[10px] uppercase font-bold text-zinc-400 block tracking-widest mb-0.5">Advances Outstanding Repayments</span>
                  <p className="text-xs font-black text-slate-800 bg-white px-2 py-1.5 rounded-lg border border-indigo-100/30">
                    {reviewingRecord.advancesDesc || 'No salary advance deductions in date range'}
                  </p>
                </div>
              </div>

              {/* Editable Fields Grid */}
              <div className="space-y-4">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-1">Earnings & Bonuses</p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Gross Salary / Expected Pay (UGX)</label>
                    <input 
                      type="number"
                      disabled
                      className="w-full px-4 py-2 bg-slate-100 border border-slate-200 rounded-xl font-bold text-slate-500 text-xs outline-none"
                      value={reviewingRecord.baseSalary}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Assigned Bonus (UGX)</label>
                    <input 
                      type="number"
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 text-xs outline-none focus:ring-2 focus:ring-indigo-500/20"
                      value={editBonus}
                      onChange={(e) => setEditBonus(parseInt(e.target.value) || 0)}
                    />
                  </div>

                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Bonus/Allowances Description Notes</label>
                    <input 
                      type="text"
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-700 text-xs outline-none focus:ring-2 focus:ring-indigo-500/20"
                      placeholder="e.g. Sales performance reward, shift incentives..."
                      value={editBonusNotes}
                      onChange={(e) => setEditBonusNotes(e.target.value)}
                    />
                  </div>
                </div>

                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pt-3 pb-1">Recoveries & Tax Deductions (Deductions)</p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-zinc-500 uppercase ml-1">Progressive PAYE (Uganda Tax)</label>
                    <input 
                      type="number"
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-rose-600 text-xs outline-none focus:ring-2 focus:ring-indigo-500/20"
                      value={editPAYE}
                      onChange={(e) => setEditPAYE(parseInt(e.target.value) || 0)}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-zinc-500 uppercase ml-1">NSSF Employee contrib. (5%)</label>
                    <input 
                      type="number"
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-rose-600 text-xs outline-none focus:ring-2 focus:ring-indigo-500/20"
                      value={editNSSFEmployee}
                      onChange={(e) => setEditNSSFEmployee(parseInt(e.target.value) || 0)}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-zinc-500 uppercase ml-1">Salary Advance Repayment</label>
                    <input 
                      type="number"
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-rose-600 text-xs outline-none focus:ring-2 focus:ring-indigo-500/20"
                      value={editAdvanceDeduction}
                      onChange={(e) => setEditAdvanceDeduction(parseInt(e.target.value) || 0)}
                    />
                    <p className="text-[8px] text-slate-400 font-medium">Clear or change to forgive/defer repayment</p>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-zinc-500 uppercase ml-1">Traffic Fines Deductible Recovered</label>
                    <input 
                      type="number"
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-rose-600 text-xs outline-none focus:ring-2 focus:ring-indigo-500/20"
                      value={editFineDeduction}
                      onChange={(e) => setEditFineDeduction(parseInt(e.target.value) || 0)}
                    />
                    <p className="text-[8px] text-slate-400 font-medium">Clear to exempt driver fine this pay session</p>
                  </div>

                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] font-black text-zinc-500 uppercase ml-1">Other Custom Deductions (UGX)</label>
                    <input 
                      type="number"
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-rose-600 text-xs outline-none focus:ring-2 focus:ring-indigo-500/20"
                      value={editCustomDeduction}
                      onChange={(e) => setEditCustomDeduction(parseInt(e.target.value) || 0)}
                    />
                  </div>
                </div>
              </div>

              {/* Summary net payable card */}
              <div className="p-5 rounded-2xl bg-slate-900 text-white flex justify-between items-center">
                <div>
                  <span className="text-[9px] font-black tracking-widest text-slate-400 uppercase">Computed Net Salary payout</span>
                  <p className="text-xs text-slate-300 mt-1">Based on adjusted bonuses and exemptions</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-black tracking-tight text-white">
                    UGX {(reviewingRecord.baseSalary + editBonus - (editAdvanceDeduction + editFineDeduction + editNSSFEmployee + editPAYE + editCustomDeduction)).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            <div className="px-4 sm:px-8 py-5 shrink-0 border-t border-slate-100 bg-slate-50/50 flex flex-wrap justify-end gap-3 rounded-b-[32px]">
              <button 
                type="button"
                onClick={() => setReviewingRecord(null)}
                className="px-5 py-2.5 bg-white border border-slate-200 text-slate-600 font-bold text-xs rounded-xl hover:bg-slate-50 uppercase tracking-wider"
              >
                Close Without Save
              </button>
              <button 
                type="button"
                onClick={handleSaveReviewModal}
                className="px-6 py-2.5 bg-slate-900 text-white font-black text-xs rounded-xl hover:bg-slate-800 uppercase tracking-wider flex items-center gap-1.5"
              >
                <CheckCircle2 size={14} /> Update Draft Invoice
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
