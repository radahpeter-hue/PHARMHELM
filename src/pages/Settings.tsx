import React, { useState, useEffect } from 'react';
import { 
  Settings as SettingsIcon, 
  Shield, 
  ToggleLeft, 
  Sliders, 
  Check, 
  X, 
  Activity, 
  History, 
  UserPlus, 
  Globe, 
  Layout, 
  Database,
  Save,
  Clock,
  RefreshCw,
  AlertCircle,
  FileText,
  Lock,
  Building2,
  Plus,
  Trash2,
  Edit2,
  Users,
  Key,
  CheckCircle,
  Ban,
  Eye,
  EyeOff
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';
import { firestoreService } from '../services/firestore';
import { registerAuthUser, db } from '../firebase';
import { runTransaction, doc, writeBatch } from 'firebase/firestore';
import { toast } from 'sonner';
import { 
  SystemSettings, 
  MasterRegistry, 
  GlobalAuditLog, 
  SystemHealth, 
  PendingActivation,
  UserRole,
  Branch,
  Staff
} from '../types';
import { format } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';

import { BranchManager } from '../modules/hr/BranchManager';
import { uploadFileToObjectStorage } from '../utils/storage';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const TABS = [
  { id: 'system', label: 'System Config', icon: Sliders },
  { id: 'branches', label: 'Branch Registry', icon: Building2 },
  { id: 'pending', label: 'Pending Activations', icon: UserPlus },
  { id: 'users', label: 'User Accounts', icon: Users },
  { id: 'master-registry', label: 'Master Registries', icon: Database },
  { id: 'it-security', label: 'IT & Security', icon: Shield },
  { id: 'branding', label: 'Branding', icon: Globe },
  { id: 'shifts', label: 'Shift Management', icon: Clock },
];

const Settings = () => {
  const { hasPermission, profile, activeBranchId } = useAuth();
  if (!hasPermission('settings', 'view')) {
    return <div className="p-8">Access denied.</div>;
  }
  const { tenant } = useTenant();
  const [activeTab, setActiveTab] = useState('system');
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  
  // Per-branch branding states
  const [selectedBrandingBranchId, setSelectedBrandingBranchId] = useState<string>('');
  const [branchBranding, setBranchBranding] = useState({
    companyName: '',
    ndaRegNumber: '',
    receiptFooter: '',
    logoUrl: '',
    primaryColor: '#10b981',
    secondaryColor: '#1f2937',
    slogan: ''
  });

  // Per-branch shifts states
  const [selectedShiftBranchId, setSelectedShiftBranchId] = useState<string>('');
  const [branchShifts, setBranchShifts] = useState({
    dayShift: { enabled: true, startTime: '07:30', endTime: '17:00' },
    eveningShift: { enabled: false, startTime: '17:00', endTime: '22:00' },
    nightShift: { enabled: false, startTime: '22:00', endTime: '07:30' }
  });

  useEffect(() => {
    if (activeBranchId) {
      setSelectedBrandingBranchId(activeBranchId);
      setSelectedShiftBranchId(activeBranchId);
    } else if (branches.length > 0) {
      setSelectedBrandingBranchId(branches[0].id);
      setSelectedShiftBranchId(branches[0].id);
    }
  }, [activeBranchId, branches]);

  useEffect(() => {
    const selectedBranch = branches.find(b => b.id === selectedBrandingBranchId);
    if (selectedBranch) {
      setBranchBranding({
        companyName: selectedBranch.brandName || selectedBranch.name || '',
        ndaRegNumber: selectedBranch.brandNdaRegNumber || '',
        receiptFooter: selectedBranch.brandReceiptFooter || '',
        logoUrl: selectedBranch.brandLogoUrl || '',
        primaryColor: selectedBranch.brandPrimaryColor || '#10b981',
        secondaryColor: selectedBranch.brandSecondaryColor || '#1f2937',
        slogan: selectedBranch.brandSlogan || ''
      });
    }
  }, [selectedBrandingBranchId, branches]);

  useEffect(() => {
    const selectedBranch = branches.find(b => b.id === selectedShiftBranchId);
    if (selectedBranch && selectedBranch.shifts) {
      setBranchShifts({
        dayShift: {
          enabled: selectedBranch.shifts.dayShift?.enabled ?? true,
          startTime: selectedBranch.shifts.dayShift?.startTime || '07:30',
          endTime: selectedBranch.shifts.dayShift?.endTime || '17:00'
        },
        eveningShift: {
          enabled: selectedBranch.shifts.eveningShift?.enabled ?? false,
          startTime: selectedBranch.shifts.eveningShift?.startTime || '17:00',
          endTime: selectedBranch.shifts.eveningShift?.endTime || '22:00'
        },
        nightShift: {
          enabled: selectedBranch.shifts.nightShift?.enabled ?? false,
          startTime: selectedBranch.shifts.nightShift?.startTime || '22:00',
          endTime: selectedBranch.shifts.nightShift?.endTime || '07:30'
        }
      });
    } else if (selectedBranch) {
      setBranchShifts({
        dayShift: { enabled: true, startTime: '07:30', endTime: '17:00' },
        eveningShift: { enabled: false, startTime: '17:00', endTime: '22:00' },
        nightShift: { enabled: false, startTime: '22:00', endTime: '07:30' }
      });
    }
  }, [selectedShiftBranchId, branches]);

  const handleSaveBranchShifts = async () => {
    if (!selectedShiftBranchId) {
      toast.error('Please select a branch first');
      return;
    }
    setSaving(true);
    try {
      const updatedShifts = {
        shifts: {
          dayShift: branchShifts.dayShift,
          eveningShift: branchShifts.eveningShift,
          nightShift: branchShifts.nightShift
        }
      };
      
      await firestoreService.updateDocument('branches', selectedShiftBranchId, updatedShifts);
      
      // Update local state array of branches so that the changes reflect immediately
      setBranches(prev => prev.map(b => b.id === selectedShiftBranchId ? { ...b, ...updatedShifts } : b));
      
      toast.success('Branch shifts configuration saved successfully!');
      logAction('Settings', 'Update', 'BranchShifts', selectedShiftBranchId);
    } catch (error) {
      toast.error('Failed to save branch shifts');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBranchBranding = async () => {
    if (!selectedBrandingBranchId) {
      toast.error('Please select a branch first');
      return;
    }
    setSaving(true);
    try {
      const updatedFields = {
        brandName: branchBranding.companyName,
        brandNdaRegNumber: branchBranding.ndaRegNumber,
        brandReceiptFooter: branchBranding.receiptFooter,
        brandLogoUrl: branchBranding.logoUrl,
        brandPrimaryColor: branchBranding.primaryColor,
        brandSecondaryColor: branchBranding.secondaryColor,
        brandSlogan: branchBranding.slogan
      };
      
      await firestoreService.updateDocument('branches', selectedBrandingBranchId, updatedFields);
      
      // Update local state array of branches so that the changes reflect immediately
      setBranches(prev => prev.map(b => b.id === selectedBrandingBranchId ? { ...b, ...updatedFields } : b));
      
      toast.success('Branch branding identity saved successfully!');
      logAction('Settings', 'Update', 'BranchBranding', selectedBrandingBranchId);
    } catch (error) {
      toast.error('Failed to save branch branding');
    } finally {
      setSaving(false);
    }
  };
  const [registries, setRegistries] = useState<MasterRegistry[]>([]);
  const [auditLogs, setAuditLogs] = useState<GlobalAuditLog[]>([]);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [pendingActivations, setPendingActivations] = useState<PendingActivation[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activationModalOpen, setActivationModalOpen] = useState(false);
  const [selectedActivation, setSelectedActivation] = useState<PendingActivation | null>(null);
  const [activationPassword, setActivationPassword] = useState('');
  const [isActivating, setIsActivating] = useState(false);

  // User Management Modals
  const [passwordResetModalOpen, setPasswordResetModalOpen] = useState(false);
  const [suspendModalOpen, setSuspendModalOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (profile?.tenantId) {
      fetchData();
    }
  }, [profile?.tenantId]);

  const fetchData = async () => {
    if (!profile?.tenantId) return;
    setLoading(true);
    try {
      // Fetch System Settings
      const settingsDocs = await firestoreService.getCollection<SystemSettings>('system_settings', profile.tenantId);
      if (settingsDocs.length > 0) {
        const s = settingsDocs[0];
        // Ensure all nested objects exist to prevent crashes
        if (!s.operationalConfig) s.operationalConfig = {} as any;
        if (!s.operationalConfig.pos) s.operationalConfig.pos = {} as any;
        if (!s.operationalConfig.hr) s.operationalConfig.hr = {} as any;
        if (!s.operationalConfig.qa) s.operationalConfig.qa = {} as any;
        if (!s.operationalConfig.finance) s.operationalConfig.finance = {} as any;
        if (!s.featureToggles) s.featureToggles = {} as any;
        if (!s.branding) {
          s.branding = {
            companyName: 'Constitutional Pharmacy',
            receiptFooter: 'Thank you for your business!',
            ndaRegNumber: 'NDA/REG/001'
          };
        }
        setSettings(s);
      } else {
        const defaultSettings: Omit<SystemSettings, 'id'> = {
          tenantId: profile.tenantId,
          deploymentMode: 'Cloud',
          multiBranchMode: false,
          allowBackdating: false,
          requireManagerOverride: true,
          taxRate: 18,
          taxEngineEnabled: false,
          currency: 'UGX',
          updatedAt: new Date().toISOString(),
          updatedBy: profile.uid,
          featureToggles: {
            enableOperationalInventory: false,
            enableTelepharmacy: true,
            enablePredictiveAnalytics: false,
            enableWelfarePortal: true,
            enableLoyalty: true,
            enableInsurance: true,
            enableMultiBranch: true,
            enableTaxEngine: false
          },
          operationalConfig: {
            allowNegativeStock: false,
            requireBatchSelection: true,
            autoGenerateSKU: true,
            defaultTaxRate: 18,
            receiptHeader: 'PharmHelm Pro ERP',
            pos: {
              receiptPrefix: 'POS',
              minSellingPriceRule: 'cost_plus_percent',
              minSellingPriceValue: 5,
              creditSaleWarningThreshold: 80,
              welfareAllocationDefault: 50000,
            },
            inventory: {
              consumptionThresholds: { fast: 7, moderate: 3, slow: 1 },
              expiryAlertWindows: [30, 60, 90],
              safetyStockDays: 14,
              defaultLookbackPeriodMonths: 3,
              leadTimeFallbackDays: 7,
              allowNegativeStock: false,
              requireBatchSelection: true,
              autoGenerateSKU: true,
              defaultTaxRate: 18,
              receiptHeader: 'PharmHelm Pro ERP'
            },
            hr: {
              payrollCycle: 'monthly',
              overtimeMultiplier: 1.5,
              cmeAnnualTargetPoints: 50,
              probationDurationDays: 90,
              hiringTheoryPassMark: 70,
              oralInterviewPassThreshold: 60,
            },
            finance: {
              pettyCashApprovalLimit: 100000,
              procurementOrderApprovalLimit: 1000000,
              badDebtDefaultPeriodDays: 90,
              vatRate: 18,
              taxPricingMode: 'inclusive',
              bankingConfirmationRequired: true,
            },
            qa: {
              roomTempRange: { min: 15, max: 25 },
              fridgeTempRange: { min: 2, max: 8 },
              fridgeMissingEntryCutoff: "09:30",
              premisesLicenceAlertDays: 60,
              staffLicenceAlertDays: 30,
              appraisalPassMark: 75,
              expiryThresholds: {
                highRisk: 30,
                mediumRisk: 60,
                watchlist: 90
              },
              cmeTargets: {
                annualPoints: 24,
                bonusThreshold: 30,
                deductionThreshold: 18,
                bonusAmount: 50000,
                deductionAmount: 20000,
                isPercentage: false
              }
            },
            predictive: {
              desiredNetProfitPerBranch: 5000000,
              inventoryTurnoverBenchmark: 4,
              diohThresholdDays: 45,
            },
            logistics: {
              mandatoryRefuelInterval: 7,
              overtimeMultiplier: 1.2,
            },
          },
          branding: {
            companyName: 'Constitutional Pharmacy',
            receiptFooter: 'Thank you for your business!',
            ndaRegNumber: 'NDA/REG/001',
          },
          numberingFormats: {
            "POS Receipt": "[BRANCH]-[YEAR]-[SEQ6]",
            "Purchase Order": "PO-[YEAR]-[SEQ4]",
          },
        };
        const docId = await firestoreService.addDocument('system_settings', defaultSettings);
        if (docId) {
          setSettings({ id: docId, ...defaultSettings });
        }
      }

      // Fetch Branches
      const branchDocs = await firestoreService.getCollection<Branch>('branches', profile.tenantId);
      setBranches(branchDocs);

      // Fetch Master Registries
      const registryDocs = await firestoreService.getCollection<MasterRegistry>('master_registries', profile.tenantId);
      setRegistries(registryDocs);

      // Fetch Audit Logs (last 50)
      const logDocs = await firestoreService.getCollection<GlobalAuditLog>('global_audit_logs', profile.tenantId);
      setAuditLogs(logDocs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 50));

      // Fetch Pending Activations
      const activationDocs = await firestoreService.getCollection<PendingActivation>('pending_activations', profile.tenantId);
      setPendingActivations(activationDocs.filter(a => a.status === 'pending'));

      // Fetch Staff
      const staffDocs = await firestoreService.getCollection<Staff>('staff', profile.tenantId);
      setStaffList(staffDocs);

      // Mock Health Data
      setHealth({
        activeSessions: 12,
        lastBackupTimestamp: new Date().toISOString(),
        databaseSizeMb: 4.2,
        failedLogins24h: 2,
        pendingActivations: activationDocs.filter(a => a.status === 'pending').length,
        expiringStaffAccounts: 1,
        version: '2.4.0-stable',
        lastUpdateDate: '2024-03-15',
      });

    } catch (error) {
      console.error('Error fetching settings data:', error);
      toast.error('Failed to load system data');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await firestoreService.updateDocument('system_settings', settings.id, settings);
      toast.success('System settings updated successfully');
      logAction('System', 'Update', 'SystemSettings', settings.id);
    } catch (error) {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const logAction = async (module: string, actionType: string, objectAffected: string, objectId: string) => {
    if (!profile) return;
    const log: Omit<GlobalAuditLog, 'id'> = {
      tenantId: profile.tenantId,
      timestamp: new Date().toISOString(),
      userId: profile.id,
      userName: profile.full_name || profile.name,
      userRole: profile.role,
      module,
      actionType,
      objectAffected,
      objectId,
    };
    await firestoreService.addDocument('global_audit_logs', log);
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setAuditLogs([ { id: tempId, ...log } as GlobalAuditLog, ...auditLogs ].slice(0, 50));
  };

  const handleToggleMultiBranch = async () => {
    if (!settings) return;
    const newValue = !settings.multiBranchMode;
    
    if (newValue && branches.length === 0) {
      toast.error('You must add at least one branch before enabling Multi-Branch Mode');
      return;
    }

    setSettings({ ...settings, multiBranchMode: newValue });
    toast.info(`Multi-Branch Mode ${newValue ? 'enabled' : 'disabled'}. Save changes to apply.`);
  };

  const toggleFeature = (key: string) => {
    if (!settings) return;
    setSettings({
      ...settings,
      featureToggles: {
        ...settings.featureToggles,
        [key]: !settings.featureToggles[key as keyof typeof settings.featureToggles]
      }
    });
  };

  const handleActivateStaff = async (activation: PendingActivation, approved: boolean) => {
    if (approved) {
      setSelectedActivation(activation);
      setActivationModalOpen(true);
    } else {
      try {
        await firestoreService.updateDocument('pending_activations', activation.id, {
          status: 'rejected'
        });
        toast.info(`Activation for ${activation.name} rejected`);
        setPendingActivations(pendingActivations.filter(a => a.id !== activation.id));
        logAction('IT', 'Reject', 'StaffAccount', activation.staffId);
      } catch (error) {
        toast.error('Failed to process rejection');
      }
    }
  };

  const normalizeName = (fullName: string, staffId: string) => {
    const clean = fullName
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Transliterate accented characters to ASCII
      .trim();
    
    const parts = clean.split(/\s+/);
    let baseHandle = "";
    if (parts.length >= 2) {
      const firstInitial = parts[0].charAt(0);
      const surname = parts[parts.length - 1];
      baseHandle = `${firstInitial}.${surname}`;
    } else if (parts.length === 1 && parts[0]) {
      baseHandle = parts[0];
    }

    baseHandle = baseHandle.replace(/[^a-z0-9.]/g, '');

    if (!baseHandle || baseHandle === '.') {
      baseHandle = staffId.toLowerCase().replace(/[^a-z0-9.]/g, '');
    }

    return baseHandle;
  };

  const confirmActivation = async () => {
    if (!selectedActivation || !activationPassword || !tenant) return;
    setIsActivating(true);
    try {
      // Retrieve original staff record
      const staffDoc = await firestoreService.getDocument<Staff>('staff', selectedActivation.staffId);
      const tenantAcronym = tenant?.acronym ? tenant.acronym.toLowerCase().trim() : (tenant?.slug || 'radah');
      const baseHandle = normalizeName(staffDoc.full_name, selectedActivation.staffId);
      
      const registryDocRef = doc(db, 'tenants', tenant.id, 'usernameRegistry', baseHandle);
      let finalHandle = baseHandle;
      
      // Run atomic transaction to manage collision-safe handles
      await runTransaction(db, async (transaction) => {
        const registrySnap = await transaction.get(registryDocRef);
        let currentSuffix = 1;
        if (registrySnap.exists()) {
          currentSuffix = registrySnap.data().nextSuffix || 1;
        }
        
        transaction.set(registryDocRef, { nextSuffix: currentSuffix + 1 }, { merge: true });
        
        if (currentSuffix > 1) {
          finalHandle = `${baseHandle}${currentSuffix}`;
        }
      });
      
      const authEmail = `${finalHandle}@${tenantAcronym}.pharmhelm.com`;
      
      // Create Firebase Auth identity and use its UID as the authoritative staff document ID.
      const authUid = await registerAuthUser(authEmail, activationPassword);
      const { password: _legacyPassword, ...safeStaffData } = staffDoc as Staff & { password?: string };
      const activationBatch = writeBatch(db);
      const canonicalStaffRef = doc(db, 'staff', authUid);
      activationBatch.set(canonicalStaffRef, {
        ...safeStaffData,
        id: authUid,
        uid: authUid,
        legacyStaffId: selectedActivation.staffId !== authUid ? selectedActivation.staffId : null,
        password_set: true,
        active: true,
        status: 'active',
        loginHandle: finalHandle,
        authEmail: authEmail,
        username: finalHandle,
        updatedAt: new Date().toISOString()
      });
      if (selectedActivation.staffId !== authUid) {
        activationBatch.delete(doc(db, 'staff', selectedActivation.staffId));
      }
      activationBatch.update(doc(db, 'pending_activations', selectedActivation.id), {
        status: 'activated',
        activatedAt: new Date().toISOString(),
        activatedBy: profile?.id,
        authUid
      });
      await activationBatch.commit();

      toast.success(`Staff account for ${selectedActivation.name} activated successfully`);
      setPendingActivations(pendingActivations.filter(a => a.id !== selectedActivation.id));
      logAction('IT', 'Activate', 'StaffAccount', selectedActivation.staffId);
      
      setActivationModalOpen(false);
      setSelectedActivation(null);
      setActivationPassword('');
    } catch (error) {
      console.error('Activation error:', error);
      toast.error('Failed to activate staff account');
    } finally {
      setIsActivating(false);
    }
  };

  const openPasswordResetModal = (staff: Staff) => {
    setSelectedStaff(staff);
    setNewPassword('');
    setPasswordResetModalOpen(true);
  };

  const handleResetPassword = async () => {
    if (!selectedStaff) return;

    // Auto-generate secure temporary password
    const tempPassword = Math.random().toString(36).slice(-8) + Math.floor(100 + Math.random() * 900);

    try {
      await firestoreService.updateDocument('staff', selectedStaff.id, {
        password: tempPassword,
        password_set: true,
        updatedAt: new Date().toISOString()
      });

      // Write action to Global Audit Log
      await firestoreService.addDocument('global_audit_logs', {
        action: 'IT_RESET_STAFF_PASSWORD',
        category: 'SECURITY',
        description: `IT Support reset password for staff member ${selectedStaff.full_name} (${selectedStaff.loginHandle || selectedStaff.username}).`,
        timestamp: new Date().toISOString(),
        tenantId: profile?.tenantId || 'unknown',
        actor: profile?.email || 'IT Support',
        ipAddress: 'client-side',
        device: 'PharmHelm Client Portal'
      });

      // Display temporary password once on-screen
      alert(`Temporary password generated successfully for ${selectedStaff.full_name}:\n\nNew Password: ${tempPassword}\n\nPlease copy and share this password manually with the staff member. It will not be shown again.`);
      
      toast.success('Password reset successfully');
      setPasswordResetModalOpen(false);
      setSelectedStaff(null);
      setNewPassword('');
    } catch (error) {
      console.error('Error resetting password:', error);
      toast.error('Failed to reset password');
    }
  };

  const openSuspendModal = (staff: Staff) => {
    setSelectedStaff(staff);
    setSuspendModalOpen(true);
  };

  const handleToggleSuspend = async () => {
    if (!selectedStaff) return;
    const newStatus = selectedStaff.status === 'suspended' ? 'active' : 'suspended';

    try {
      await firestoreService.updateDocument('staff', selectedStaff.id, {
        status: newStatus,
        active: newStatus === 'active',
        updatedAt: new Date().toISOString()
      });
      toast.success(`Account ${newStatus === 'suspended' ? 'suspended' : 'activated'} successfully`);
      setSuspendModalOpen(false);
      setSelectedStaff(null);
    } catch (error) {
      console.error('Error toggling suspension:', error);
      toast.error('Failed to update account status');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-20">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">System Settings & IT Support</h1>
          <p className="text-zinc-500">Constitutional layer for system rules, roles, and feature toggles.</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={fetchData}
            className="p-2 text-zinc-500 hover:bg-zinc-100 rounded-xl transition-colors"
            title="Refresh Data"
          >
            <RefreshCw size={20} />
          </button>
          <button 
            onClick={handleSaveSettings}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all disabled:opacity-50"
          >
            {saving ? <RefreshCw className="animate-spin" size={18} /> : <Save size={18} />}
            Save Changes
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 p-1 bg-zinc-100 rounded-2xl w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all",
              activeTab === tab.id 
                ? "bg-white text-zinc-900 shadow-sm" 
                : "text-zinc-500 hover:text-zinc-700"
            )}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'system' && settings && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Feature Toggles */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 bg-emerald-500/10 rounded-xl flex items-center justify-center">
                  <ToggleLeft className="text-emerald-500" size={20} />
                </div>
                <h3 className="font-bold text-zinc-900">Feature Toggles</h3>
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-zinc-50 rounded-2xl border border-zinc-100">
                  <div>
                    <p className="text-sm font-bold text-zinc-900">Multi-Branch Mode</p>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">
                      {settings.multiBranchMode ? 'Active' : 'Disabled'}
                    </p>
                  </div>
                  <button 
                    onClick={handleToggleMultiBranch}
                    className={cn(
                      "w-10 h-5 rounded-full transition-all relative",
                      settings.multiBranchMode ? "bg-emerald-500" : "bg-zinc-300"
                    )}
                  >
                    <div className={cn(
                      "absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all",
                      settings.multiBranchMode ? "left-5.5" : "left-0.5"
                    )} />
                  </button>
                </div>

                {Object.entries(settings.featureToggles).map(([key, enabled]) => (
                  <div key={key} className="flex items-center justify-between p-3 bg-zinc-50 rounded-2xl border border-zinc-100">
                    <div>
                      <p className="text-sm font-bold text-zinc-900 capitalize">
                        {key.replace('enable', '').replace(/([A-Z])/g, ' $1').trim()}
                      </p>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">
                        {enabled ? 'Active' : 'Disabled'}
                      </p>
                    </div>
                    <button 
                      onClick={() => toggleFeature(key)}
                      className={cn(
                        "w-10 h-5 rounded-full transition-all relative",
                        enabled ? "bg-emerald-500" : "bg-zinc-300"
                      )}
                    >
                      <div className={cn(
                        "absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all",
                        enabled ? "left-5.5" : "left-0.5"
                      )} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 bg-blue-500/10 rounded-xl flex items-center justify-center">
                  <Layout className="text-blue-500" size={20} />
                </div>
                <h3 className="font-bold text-zinc-900">Deployment Mode</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => setSettings({ ...settings, deploymentMode: 'single' })}
                  className={cn(
                    "p-4 rounded-2xl border transition-all text-left",
                    settings.deploymentMode === 'single' 
                      ? "bg-blue-50 border-blue-200 ring-2 ring-blue-500/20" 
                      : "bg-zinc-50 border-zinc-100 hover:border-zinc-200"
                  )}
                >
                  <p className="text-sm font-bold text-zinc-900">Single Site</p>
                  <p className="text-[10px] text-zinc-500">Standalone pharmacy</p>
                </button>
                <button 
                  onClick={() => setSettings({ ...settings, deploymentMode: 'multi' })}
                  className={cn(
                    "p-4 rounded-2xl border transition-all text-left",
                    settings.deploymentMode === 'multi' 
                      ? "bg-blue-50 border-blue-200 ring-2 ring-blue-500/20" 
                      : "bg-zinc-50 border-zinc-100 hover:border-zinc-200"
                  )}
                >
                  <p className="text-sm font-bold text-zinc-900">Multi-Branch</p>
                  <p className="text-[10px] text-zinc-500">Centralized control</p>
                </button>
              </div>
            </div>
          </div>

          {/* Operational Config */}
          <div className="lg:col-span-2 bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
            <div className="flex items-center gap-3 mb-8">
              <div className="h-10 w-10 bg-zinc-100 rounded-xl flex items-center justify-center">
                <Sliders className="text-zinc-600" size={20} />
              </div>
              <h3 className="font-bold text-zinc-900">Operational Configuration</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* POS Config */}
              <div className="space-y-4">
                <h4 className="text-xs font-black uppercase tracking-widest text-zinc-400">POS & Sales</h4>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-bold text-zinc-500 mb-1 block">Receipt Prefix</label>
                    <input 
                      type="text"
                      value={settings.operationalConfig?.pos?.receiptPrefix || ''}
                      onChange={(e) => setSettings({
                        ...settings,
                        operationalConfig: {
                          ...settings.operationalConfig!,
                          pos: { ...settings.operationalConfig?.pos!, receiptPrefix: e.target.value }
                        }
                      })}
                      className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-zinc-500 mb-1 block">Min Selling Price Rule</label>
                    <select 
                      value={settings.operationalConfig?.pos?.minSellingPriceRule || 'cost'}
                      onChange={(e) => setSettings({
                        ...settings,
                        operationalConfig: {
                          ...settings.operationalConfig!,
                          pos: { ...settings.operationalConfig?.pos!, minSellingPriceRule: e.target.value as any }
                        }
                      })}
                      className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    >
                      <option value="cost">At Cost</option>
                      <option value="cost_plus_percent">Cost + %</option>
                      <option value="fixed_markup">Fixed Markup</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-zinc-500 mb-1 block">Annual Welfare Allocation (UGX)</label>
                    <input 
                      type="number"
                      value={isNaN(settings.operationalConfig?.pos?.welfareAllocationDefault!) ? '' : settings.operationalConfig?.pos?.welfareAllocationDefault}
                      onChange={(e) => setSettings({
                        ...settings,
                        operationalConfig: {
                          ...settings.operationalConfig!,
                          pos: { ...settings.operationalConfig?.pos!, welfareAllocationDefault: parseInt(e.target.value) || 0 }
                        }
                      })}
                      className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                </div>
              </div>

              {/* HR Config */}
              <div className="space-y-4">
                <h4 className="text-xs font-black uppercase tracking-widest text-zinc-400">Human Resources</h4>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-bold text-zinc-500 mb-1 block">CME Annual Target (Points)</label>
                    <input 
                      type="number"
                      value={isNaN(settings.operationalConfig?.hr?.cmeAnnualTargetPoints!) ? '' : settings.operationalConfig?.hr?.cmeAnnualTargetPoints}
                      onChange={(e) => setSettings({
                        ...settings,
                        operationalConfig: {
                          ...settings.operationalConfig!,
                          hr: { ...settings.operationalConfig?.hr!, cmeAnnualTargetPoints: parseInt(e.target.value) || 0 }
                        }
                      })}
                      className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-zinc-500 mb-1 block">Hiring Theory Pass Mark (%)</label>
                    <input 
                      type="number"
                      value={isNaN(settings.operationalConfig?.hr?.hiringTheoryPassMark!) ? '' : settings.operationalConfig?.hr?.hiringTheoryPassMark}
                      onChange={(e) => setSettings({
                        ...settings,
                        operationalConfig: {
                          ...settings.operationalConfig!,
                          hr: { ...settings.operationalConfig?.hr!, hiringTheoryPassMark: parseInt(e.target.value) || 0 }
                        }
                      })}
                      className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                </div>
              </div>

              {/* QA Config */}
              <div className="space-y-4">
                <h4 className="text-xs font-black uppercase tracking-widest text-zinc-400">Quality Assurance & CME</h4>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-zinc-500 mb-1 block">Fridge Min (°C)</label>
                      <input 
                        type="number"
                        value={isNaN(settings.operationalConfig?.qa?.fridgeTempRange?.min!) ? '' : settings.operationalConfig?.qa?.fridgeTempRange?.min}
                        onChange={(e) => setSettings({
                          ...settings,
                          operationalConfig: {
                            ...settings.operationalConfig!,
                            qa: { 
                              ...settings.operationalConfig?.qa!, 
                              fridgeTempRange: { ...settings.operationalConfig?.qa?.fridgeTempRange!, min: parseInt(e.target.value) || 0 } 
                            }
                          }
                        })}
                        className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-zinc-500 mb-1 block">Fridge Max (°C)</label>
                      <input 
                        type="number"
                        value={isNaN(settings.operationalConfig?.qa?.fridgeTempRange?.max!) ? '' : settings.operationalConfig?.qa?.fridgeTempRange?.max}
                        onChange={(e) => setSettings({
                          ...settings,
                          operationalConfig: {
                            ...settings.operationalConfig!,
                            qa: { 
                              ...settings.operationalConfig?.qa!, 
                              fridgeTempRange: { ...settings.operationalConfig?.qa?.fridgeTempRange!, max: parseInt(e.target.value) || 0 } 
                            }
                          }
                        })}
                        className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      />
                    </div>
                  </div>

                  <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 space-y-4">
                    <p className="text-xs font-black uppercase tracking-wider text-zinc-500">CME Performance Targets & Payroll Configurations</p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1 block">Annual Points Target</label>
                        <input 
                          type="number"
                          value={settings.operationalConfig?.qa?.cmeTargets?.annualPoints ?? 24}
                          onChange={(e) => setSettings({
                            ...settings,
                            operationalConfig: {
                              ...settings.operationalConfig!,
                              qa: { 
                                ...settings.operationalConfig?.qa!, 
                                cmeTargets: { ...(settings.operationalConfig?.qa?.cmeTargets || {}), annualPoints: parseInt(e.target.value) || 0 } 
                              }
                            }
                          })}
                          className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1 block">Bonus Threshold (YTD)</label>
                        <input 
                          type="number"
                          value={settings.operationalConfig?.qa?.cmeTargets?.bonusThreshold ?? 30}
                          onChange={(e) => setSettings({
                            ...settings,
                            operationalConfig: {
                              ...settings.operationalConfig!,
                              qa: { 
                                ...settings.operationalConfig?.qa!, 
                                cmeTargets: { ...(settings.operationalConfig?.qa?.cmeTargets || {}), bonusThreshold: parseInt(e.target.value) || 0 } 
                              }
                            }
                          })}
                          className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1 block">Deduction Threshold (YTD)</label>
                        <input 
                          type="number"
                          value={settings.operationalConfig?.qa?.cmeTargets?.deductionThreshold ?? 18}
                          onChange={(e) => setSettings({
                            ...settings,
                            operationalConfig: {
                              ...settings.operationalConfig!,
                              qa: { 
                                ...settings.operationalConfig?.qa!, 
                                cmeTargets: { ...(settings.operationalConfig?.qa?.cmeTargets || {}), deductionThreshold: parseInt(e.target.value) || 0 } 
                              }
                            }
                          })}
                          className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1 block">CME Bonus Amount (UGX)</label>
                        <input 
                          type="number"
                          value={settings.operationalConfig?.qa?.cmeTargets?.bonusAmount ?? 50000}
                          onChange={(e) => setSettings({
                            ...settings,
                            operationalConfig: {
                              ...settings.operationalConfig!,
                              qa: { 
                                ...settings.operationalConfig?.qa!, 
                                cmeTargets: { ...(settings.operationalConfig?.qa?.cmeTargets || {}), bonusAmount: parseInt(e.target.value) || 0 } 
                              }
                            }
                          })}
                          className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1 block">CME Deduction Amount (UGX)</label>
                        <input 
                          type="number"
                          value={settings.operationalConfig?.qa?.cmeTargets?.deductionAmount ?? 20000}
                          onChange={(e) => setSettings({
                            ...settings,
                            operationalConfig: {
                              ...settings.operationalConfig!,
                              qa: { 
                                ...settings.operationalConfig?.qa!, 
                                cmeTargets: { ...(settings.operationalConfig?.qa?.cmeTargets || {}), deductionAmount: parseInt(e.target.value) || 0 } 
                              }
                            }
                          })}
                          className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Inventory Config */}
              <div className="space-y-4">
                <h4 className="text-xs font-black uppercase tracking-widest text-zinc-400">Inventory & Stock</h4>
                <div className="space-y-3">
                  <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 space-y-4">
                    <p className="text-xs font-bold text-zinc-900">Consumption Thresholds (Avg. Packs/Month)</p>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1 block">Fast</label>
                        <input 
                          type="number"
                          value={settings.operationalConfig?.inventory?.consumptionThresholds?.fast || 7}
                          onChange={(e) => setSettings({
                            ...settings,
                            operationalConfig: {
                              ...settings.operationalConfig!,
                              inventory: { 
                                ...settings.operationalConfig?.inventory!, 
                                consumptionThresholds: { ...settings.operationalConfig?.inventory?.consumptionThresholds!, fast: parseInt(e.target.value) || 0 } 
                              }
                            }
                          })}
                          className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1 block">Moderate</label>
                        <input 
                          type="number"
                          value={settings.operationalConfig?.inventory?.consumptionThresholds?.moderate || 3}
                          onChange={(e) => setSettings({
                            ...settings,
                            operationalConfig: {
                              ...settings.operationalConfig!,
                              inventory: { 
                                ...settings.operationalConfig?.inventory!, 
                                consumptionThresholds: { ...settings.operationalConfig?.inventory?.consumptionThresholds!, moderate: parseInt(e.target.value) || 0 } 
                              }
                            }
                          })}
                          className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1 block">Slow</label>
                        <input 
                          type="number"
                          value={settings.operationalConfig?.inventory?.consumptionThresholds?.slow || 1}
                          onChange={(e) => setSettings({
                            ...settings,
                            operationalConfig: {
                              ...settings.operationalConfig!,
                              inventory: { 
                                ...settings.operationalConfig?.inventory!, 
                                consumptionThresholds: { ...settings.operationalConfig?.inventory?.consumptionThresholds!, slow: parseInt(e.target.value) || 0 } 
                              }
                            }
                          })}
                          className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        />
                      </div>
                    </div>
                    <p className="text-[10px] text-zinc-400 italic leading-tight">
                      Used to classify products in the Stockcard widget based on 3-month average sales.
                    </p>
                  </div>
                </div>
              </div>

              {/* Finance Config */}
              <div className="space-y-4">
                <h4 className="text-xs font-black uppercase tracking-widest text-zinc-400">Finance & Tax</h4>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                    <div>
                      <p className="text-xs font-bold text-zinc-900">Tax Engine</p>
                      <p className="text-[10px] text-zinc-500">Enable automated tax calculations on sales</p>
                    </div>
                    <button 
                      onClick={() => setSettings({ ...settings, taxEngineEnabled: !settings.taxEngineEnabled })}
                      className={cn(
                        "w-12 h-6 rounded-full transition-all relative",
                        settings.taxEngineEnabled ? "bg-emerald-500" : "bg-zinc-300"
                      )}
                    >
                      <div className={cn(
                        "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                        settings.taxEngineEnabled ? "right-1" : "left-1"
                      )} />
                    </button>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-zinc-500 mb-1 block">VAT Rate (%)</label>
                    <input 
                      type="number"
                      value={isNaN(settings.operationalConfig?.finance?.vatRate!) ? '' : settings.operationalConfig?.finance?.vatRate}
                      onChange={(e) => setSettings({
                        ...settings,
                        operationalConfig: {
                          ...settings.operationalConfig!,
                          finance: { ...settings.operationalConfig?.finance!, vatRate: parseInt(e.target.value) || 0 }
                        }
                      })}
                      className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-zinc-50 rounded-2xl border border-zinc-100">
                    <input 
                      type="checkbox"
                      checked={settings.operationalConfig?.finance?.bankingConfirmationRequired || false}
                      onChange={(e) => setSettings({
                        ...settings,
                        operationalConfig: {
                          ...settings.operationalConfig!,
                          finance: { ...settings.operationalConfig?.finance!, bankingConfirmationRequired: e.target.checked }
                        }
                      })}
                      className="h-4 w-4 text-emerald-600 rounded border-zinc-300 focus:ring-emerald-500"
                    />
                    <span className="text-sm font-bold text-zinc-700">Banking Confirmation Required</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'branches' && (
        <div className="space-y-6">
          <BranchManager />
        </div>
      )}

      {activeTab === 'pending' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold text-zinc-900">Pending Staff Activations</h3>
              <p className="text-sm text-zinc-500">Finalize login details for staff members registered by HR.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {pendingActivations.map((activation) => (
              <div key={activation.id} className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm hover:border-emerald-500/50 transition-all group">
                <div className="flex items-center justify-between mb-4">
                  <div className="h-10 w-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                    <UserPlus className="text-emerald-600" size={20} />
                  </div>
                  <span className="px-2 py-1 bg-amber-50 text-amber-700 rounded-lg text-[10px] font-bold uppercase tracking-wider">
                    Pending IT
                  </span>
                </div>
                <h4 className="font-bold text-zinc-900">{activation.name}</h4>
                <p className="text-xs text-emerald-600 font-bold uppercase tracking-widest mt-1">{activation.role}</p>
                {(() => {
                  const tenantAcronym = tenant?.acronym ? tenant.acronym.toLowerCase().trim() : (tenant?.slug || 'radah');
                  const proposedHandle = normalizeName(activation.name, activation.staffId);
                  const proposedEmail = `${proposedHandle}@${tenantAcronym}.pharmhelm.com`;
                  const proposedUsername = `${proposedHandle}.${tenantAcronym}.pharmhelm.com`;

                  return (
                    <div className="mt-4 grid grid-cols-2 gap-3 bg-zinc-50 p-3 rounded-2xl border border-zinc-100">
                      <div>
                        <p className="text-[8px] text-zinc-400 font-black uppercase tracking-widest">Login Username</p>
                        <p className="text-[11px] font-mono text-zinc-800 break-all">{proposedUsername}</p>
                      </div>
                      <div>
                        <p className="text-[8px] text-zinc-400 font-black uppercase tracking-widest">Firebase Email</p>
                        <p className="text-[11px] font-mono text-zinc-800 break-all">{proposedEmail}</p>
                      </div>
                    </div>
                  );
                })()}
                
                <div className="mt-6 flex items-center gap-2">
                  <button 
                    onClick={() => handleActivateStaff(activation, true)}
                    className="flex-1 py-2 bg-emerald-600 text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100"
                  >
                    Activate
                  </button>
                  <button 
                    onClick={() => handleActivateStaff(activation, false)}
                    className="px-4 py-2 bg-zinc-100 text-zinc-500 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-zinc-200 transition-all"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
            {pendingActivations.length === 0 && (
              <div className="col-span-full py-20 text-center border-2 border-dashed border-zinc-100 rounded-[32px]">
                <UserPlus size={48} className="mx-auto mb-4 text-zinc-200" />
                <p className="text-zinc-500 font-medium">No pending activations found.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'users' && (
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-zinc-100 rounded-xl flex items-center justify-center">
                <Users className="text-zinc-600" size={20} />
              </div>
              <h3 className="font-bold text-zinc-900">User Account Management</h3>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left border-b border-zinc-100">
                  <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-zinc-400">Staff Member</th>
                  <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-zinc-400">Role</th>
                  <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-zinc-400">Status</th>
                  <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-zinc-400">Branches</th>
                  <th className="pb-4 text-right text-[10px] font-black uppercase tracking-widest text-zinc-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {staffList.map((staff) => (
                  <tr key={staff.id} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="py-4">
                      <p className="text-sm font-bold text-zinc-900">{staff.full_name}</p>
                      <p className="text-[10px] text-zinc-400">{staff.username}</p>
                    </td>
                    <td className="py-4">
                      <span className="px-2 py-1 bg-zinc-100 text-[10px] font-bold text-zinc-600 rounded-lg uppercase">
                        {staff.role}
                      </span>
                    </td>
                    <td className="py-4">
                      <span className={cn(
                        "px-2 py-1 text-[10px] font-bold rounded-lg uppercase",
                        staff.status === 'active' ? "bg-emerald-100 text-emerald-700" :
                        staff.status === 'suspended' ? "bg-red-100 text-red-700" : "bg-zinc-100 text-zinc-600"
                      )}>
                        {staff.status}
                      </span>
                    </td>
                    <td className="py-4">
                      <p className="text-xs text-zinc-600">{staff.assigned_branches?.length || 0} Branches</p>
                    </td>
                    <td className="py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => openPasswordResetModal(staff)}
                          className="p-2 hover:bg-zinc-100 rounded-xl text-zinc-400 hover:text-blue-600 transition-colors"
                          title="Reset Password"
                        >
                          <Key size={16} />
                        </button>
                        <button 
                          onClick={() => openSuspendModal(staff)}
                          className={cn(
                            "p-2 rounded-xl transition-colors",
                            staff.status === 'suspended' 
                              ? "hover:bg-emerald-50 text-emerald-400 hover:text-emerald-600" 
                              : "hover:bg-red-50 text-red-400 hover:text-red-600"
                          )}
                          title={staff.status === 'suspended' ? "Unsuspend Account" : "Suspend Account"}
                        >
                          {staff.status === 'suspended' ? <CheckCircle size={16} /> : <Ban size={16} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'master-registry' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold text-zinc-900">Master Registries</h3>
              <p className="text-sm text-zinc-500">Manage system-wide dropdown options and categories.</p>
            </div>
            <button className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-xl font-bold hover:bg-zinc-800 transition-all">
              <Plus size={18} />
              New Registry
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {registries.length === 0 ? (
              <div className="col-span-full bg-white p-12 rounded-3xl border border-dashed border-zinc-300 flex flex-col items-center justify-center text-center">
                <Database className="text-zinc-300 mb-4" size={48} />
                <h3 className="font-bold text-zinc-900">No Master Registries Found</h3>
                <p className="text-sm text-zinc-500 max-w-xs">Master registries define the dropdown options across the system.</p>
                <button className="mt-6 px-6 py-2 bg-zinc-900 text-white rounded-xl font-bold hover:bg-zinc-800 transition-all">
                  Initialize Default Registries
                </button>
              </div>
            ) : (
              registries.map((registry) => (
                <div key={registry.id} className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm hover:border-emerald-500/50 transition-all group">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-zinc-900">{registry.category}</h3>
                    <span className="px-2 py-1 bg-zinc-100 text-[10px] font-black uppercase tracking-widest text-zinc-500 rounded-lg">
                      v{registry.version}
                    </span>
                  </div>
                  <div className="space-y-2 mb-6">
                    {registry.entries.slice(0, 5).map((entry) => (
                      <div key={entry.id} className="flex items-center gap-2 text-sm text-zinc-600">
                        <div className={cn("w-1.5 h-1.5 rounded-full", entry.isActive ? "bg-emerald-500" : "bg-zinc-300")} />
                        {entry.name}
                      </div>
                    ))}
                    {registry.entries.length > 5 && (
                      <p className="text-[10px] text-zinc-400 font-bold italic">+{registry.entries.length - 5} more entries</p>
                    )}
                  </div>
                  <button className="w-full py-2 bg-zinc-50 text-zinc-600 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-zinc-100 transition-all">
                    Edit Registry
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'it-security' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* System Health & Activations */}
          <div className="lg:col-span-1 space-y-8">
            {health && (
              <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
                <div className="flex items-center gap-3 mb-6">
                  <div className="h-10 w-10 bg-emerald-500/10 rounded-xl flex items-center justify-center">
                    <Activity className="text-emerald-500" size={20} />
                  </div>
                  <h3 className="font-bold text-zinc-900">System Health</h3>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">Active Sessions</p>
                    <p className="text-2xl font-black text-zinc-900">{health.activeSessions}</p>
                  </div>
                  <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">DB Size</p>
                    <p className="text-2xl font-black text-zinc-900">{health.databaseSizeMb} MB</p>
                  </div>
                  <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">Failed Logins</p>
                    <p className={cn("text-2xl font-black", health.failedLogins24h > 5 ? "text-red-500" : "text-zinc-900")}>
                      {health.failedLogins24h}
                    </p>
                  </div>
                  <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">Version</p>
                    <p className="text-sm font-black text-zinc-900">{health.version}</p>
                  </div>
                </div>

                <div className="mt-6 pt-6 border-t border-zinc-100">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-500">Last Backup</span>
                    <span className="font-bold text-zinc-900">{format(new Date(health.lastBackupTimestamp), 'MMM d, HH:mm')}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 bg-amber-500/10 rounded-xl flex items-center justify-center">
                  <UserPlus className="text-amber-500" size={20} />
                </div>
                <h3 className="font-bold text-zinc-900">Pending Activations</h3>
              </div>
              
              <div className="space-y-3">
                {pendingActivations.length === 0 ? (
                  <p className="text-sm text-zinc-500 text-center py-4 italic">No pending account activations</p>
                ) : (
                  pendingActivations.map((activation) => (
                    <div key={activation.id} className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-bold text-zinc-900">{activation.name}</p>
                        <span className="px-2 py-0.5 bg-amber-100 text-[10px] font-bold text-amber-700 rounded-lg uppercase">
                          {activation.role}
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-500 mb-4">Requested {format(new Date(activation.requestedAt), 'MMM d, HH:mm')}</p>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => handleActivateStaff(activation, true)}
                          className="flex-1 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-emerald-700 transition-all"
                        >
                          Activate
                        </button>
                        <button 
                          onClick={() => handleActivateStaff(activation, false)}
                          className="flex-1 py-1.5 bg-zinc-200 text-zinc-600 rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-zinc-300 transition-all"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Audit Logs */}
          <div className="lg:col-span-2 bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-zinc-100 rounded-xl flex items-center justify-center">
                  <History className="text-zinc-600" size={20} />
                </div>
                <h3 className="font-bold text-zinc-900">Global Audit Logs</h3>
              </div>
              <button className="text-xs font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-900 flex items-center gap-2">
                <FileText size={14} />
                Export Full Log
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left border-b border-zinc-100">
                    <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-zinc-400">Timestamp</th>
                    <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-zinc-400">User</th>
                    <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-zinc-400">Module</th>
                    <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-zinc-400">Action</th>
                    <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-zinc-400">Object</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-zinc-50/50 transition-colors">
                       <td className="py-4 text-xs text-zinc-500 font-medium">
                        {log.timestamp ? format(new Date(log.timestamp), 'MMM d, HH:mm:ss') : 'N/A'}
                      </td>
                      <td className="py-4">
                        <p className="text-xs font-bold text-zinc-900">{log.userName || log.actor || 'System'}</p>
                        <p className="text-[10px] text-zinc-400 uppercase tracking-wider">{log.userRole || 'Security Event'}</p>
                      </td>
                      <td className="py-4">
                        <span className="px-2 py-1 bg-zinc-100 text-[10px] font-bold text-zinc-600 rounded-lg">
                          {log.module || log.category || 'Security'}
                        </span>
                      </td>
                      <td className="py-4">
                        <span className={cn(
                          "text-xs font-bold",
                          log.actionType === 'Delete' || log.action === 'TMC_LOGIN_FAILED' || log.action === 'STAFF_LOGIN_FAILED' ? "text-red-500" : 
                          log.actionType === 'Update' ? "text-blue-500" : "text-emerald-500"
                        )}>
                          {log.actionType || log.action || 'Event'}
                        </span>
                      </td>
                      <td className="py-4">
                        <p className="text-xs font-medium text-zinc-600">{log.objectAffected || log.description || 'System Audit Event'}</p>
                        <p className="text-[10px] text-zinc-400 font-mono">
                          {log.objectId ? `${log.objectId.slice(0, 8)}...` : 'N/A'}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}      {activeTab === 'branding' && (
        <div className="max-w-2xl bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-8 pb-4 border-b border-zinc-100">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-zinc-100 rounded-xl flex items-center justify-center">
                <Globe className="text-zinc-600" size={20} />
              </div>
              <div>
                <h3 className="font-bold text-zinc-900">Branch-Specific Branding</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Define distinct identities and logos per branch</p>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {/* Branch Selection Dropdown */}
            <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-200 space-y-2">
              <label className="text-[10px] font-extrabold text-zinc-500 uppercase tracking-wider block">Select Branch to Configure</label>
              <select
                value={selectedBrandingBranchId}
                onChange={(e) => setSelectedBrandingBranchId(e.target.value)}
                className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-xs font-bold text-zinc-800 outline-none focus:ring-2 focus:ring-emerald-500/20"
              >
                {branches.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name} {b.isMainBranch ? '(Main Branch)' : ''}
                  </option>
                ))}
              </select>
              {activeBranchId === selectedBrandingBranchId && (
                <span className="text-[9px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md font-bold uppercase tracking-wider mt-1 inline-block border border-emerald-100">
                  Currently Logged-In Branch
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="text-xs font-bold text-zinc-500 mb-1 block">Brand/Company Name</label>
                <input 
                  type="text"
                  placeholder="e.g. PharmHelm Wandegeya"
                  value={branchBranding.companyName}
                  onChange={(e) => setBranchBranding({
                    ...branchBranding,
                    companyName: e.target.value
                  })}
                  className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-zinc-500 mb-1 block">NDA Registration Number</label>
                <input 
                  type="text"
                  placeholder="NDA/WHL/2026/0847"
                  value={branchBranding.ndaRegNumber}
                  onChange={(e) => setBranchBranding({
                    ...branchBranding,
                    ndaRegNumber: e.target.value
                  })}
                  className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="text-xs font-bold text-zinc-500 mb-1 block">Brand Slogan (Optional)</label>
                <input 
                  type="text"
                  placeholder="Your Health, Our Priority"
                  value={branchBranding.slogan}
                  onChange={(e) => setBranchBranding({
                    ...branchBranding,
                    slogan: e.target.value
                  })}
                  className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-zinc-500 mb-1 block">Primary Color</label>
                  <div className="flex gap-2">
                    <input 
                      type="color"
                      value={branchBranding.primaryColor}
                      onChange={(e) => setBranchBranding({
                        ...branchBranding,
                        primaryColor: e.target.value
                      })}
                      className="w-10 h-9 p-1 border border-zinc-200 rounded-xl cursor-pointer"
                    />
                    <input 
                      type="text"
                      value={branchBranding.primaryColor}
                      onChange={(e) => setBranchBranding({
                        ...branchBranding,
                        primaryColor: e.target.value
                      })}
                      className="w-full px-3 py-1 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-mono uppercase focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-zinc-500 mb-1 block">Secondary Color</label>
                  <div className="flex gap-2">
                    <input 
                      type="color"
                      value={branchBranding.secondaryColor}
                      onChange={(e) => setBranchBranding({
                        ...branchBranding,
                        secondaryColor: e.target.value
                      })}
                      className="w-10 h-9 p-1 border border-zinc-200 rounded-xl cursor-pointer"
                    />
                    <input 
                      type="text"
                      value={branchBranding.secondaryColor}
                      onChange={(e) => setBranchBranding({
                        ...branchBranding,
                        secondaryColor: e.target.value
                      })}
                      className="w-full px-3 py-1 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-mono uppercase focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-zinc-500 mb-1 block">Receipt Footer Text</label>
              <textarea 
                rows={3}
                placeholder="Thank you for choosing PharmHelm!"
                value={branchBranding.receiptFooter}
                onChange={(e) => setBranchBranding({
                  ...branchBranding,
                  receiptFooter: e.target.value
                })}
                className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            <div className="p-6 bg-zinc-50 rounded-3xl border border-dashed border-zinc-300 flex flex-col items-center justify-center text-center">
              {branchBranding.logoUrl ? (
                <div className="flex flex-col items-center">
                  <img src={branchBranding.logoUrl} alt="Logo" className="max-h-24 max-w-full mb-4 object-contain rounded-xl border border-zinc-200 bg-white p-2" />
                  <button 
                    onClick={() => setBranchBranding({
                      ...branchBranding,
                      logoUrl: ''
                    })}
                    className="mb-3 px-4 py-1 bg-red-50 text-red-650 hover:bg-red-100 rounded-lg text-xs font-bold transition-all border border-red-100"
                  >
                    Remove Logo
                  </button>
                </div>
              ) : (
                <div className="h-20 w-20 bg-zinc-200 rounded-2xl flex items-center justify-center mb-4">
                  <Layout className="text-zinc-400" size={32} />
                </div>
              )}
              
              <label className="cursor-pointer inline-flex items-center justify-center px-6 py-2 bg-white border border-zinc-200 text-zinc-900 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-zinc-50 transition-all shadow-sm">
                <span>Upload Brand Logo</span>
                <input 
                  type="file" 
                  accept="image/*" 
                  className="hidden" 
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      try {
                        const uploadToast = toast.loading("Uploading logo to secure Cloud Object Storage bucket...");
                        if (!profile?.tenantId || !selectedBrandingBranchId) {
                          throw new Error('Tenant and branch context are required before uploading a logo.');
                        }
                        const downloadUrl = await uploadFileToObjectStorage(
                          file,
                          `logos/${profile.tenantId}/${selectedBrandingBranchId}`
                        );
                        setBranchBranding({
                          ...branchBranding,
                          logoUrl: downloadUrl
                        });
                        toast.dismiss(uploadToast);
                        toast.success("Logo uploaded to Object Storage! Click 'Save Branch Branding' to persist.");
                      } catch (err: any) {
                        toast.dismiss();
                        toast.error("Failed to upload image: " + err.message);
                      }
                    }
                  }}
                />
              </label>
              <p className="text-[10px] text-zinc-400 mt-2 font-bold uppercase tracking-widest">Recommended: 512x512 PNG/JPEG</p>
            </div>

            <div className="pt-4 border-t border-zinc-100 flex justify-end">
              <button
                onClick={handleSaveBranchBranding}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-3 bg-zinc-900 text-white rounded-2xl font-bold text-xs uppercase tracking-wider hover:bg-zinc-800 transition-all disabled:opacity-50 shadow-md"
              >
                {saving ? 'Saving...' : 'Save Branch Branding'}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'shifts' && (
        <div className="max-w-2xl bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-8 pb-4 border-b border-zinc-100">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-zinc-100 rounded-xl flex items-center justify-center">
                <Clock className="text-zinc-600" size={20} />
              </div>
              <div>
                <h3 className="font-bold text-zinc-900">Shift Configuration</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Configure operational shifts and working hours per branch</p>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {/* Branch Selection Dropdown */}
            <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-200 space-y-2">
              <label className="text-[10px] font-extrabold text-zinc-500 uppercase tracking-wider block">Select Branch to Configure</label>
              <select
                value={selectedShiftBranchId}
                onChange={(e) => setSelectedShiftBranchId(e.target.value)}
                className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-xs font-bold text-zinc-800 outline-none focus:ring-2 focus:ring-emerald-500/20"
              >
                {branches.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name} {b.isMainBranch ? '(Main Branch)' : ''}
                  </option>
                ))}
              </select>
              {activeBranchId === selectedShiftBranchId && (
                <span className="text-[9px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md font-bold uppercase tracking-wider mt-1 inline-block border border-emerald-100">
                  Currently Logged-In Branch
                </span>
              )}
            </div>

            {/* Shift Cards */}
            <div className="space-y-4">
              {/* Day Shift */}
              <div className={cn(
                "p-6 rounded-2xl border transition-all space-y-4",
                branchShifts.dayShift.enabled ? "bg-white border-emerald-200 shadow-sm" : "bg-zinc-50 border-zinc-200 opacity-60"
              )}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">☀️</span>
                    <div>
                      <h4 className="font-bold text-zinc-900 text-sm">Day Shift</h4>
                      <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">Primary Working Hours</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer"
                      checked={branchShifts.dayShift.enabled}
                      onChange={(e) => setBranchShifts({
                        ...branchShifts,
                        dayShift: { ...branchShifts.dayShift, enabled: e.target.checked }
                      })}
                    />
                    <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                  </label>
                </div>

                {branchShifts.dayShift.enabled && (
                  <div className="grid grid-cols-2 gap-4 pt-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block">Start Time</label>
                      <input 
                        type="time" 
                        value={branchShifts.dayShift.startTime}
                        onChange={(e) => setBranchShifts({
                          ...branchShifts,
                          dayShift: { ...branchShifts.dayShift, startTime: e.target.value }
                        })}
                        className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-bold text-zinc-800 focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block">End Time</label>
                      <input 
                        type="time" 
                        value={branchShifts.dayShift.endTime}
                        onChange={(e) => setBranchShifts({
                          ...branchShifts,
                          dayShift: { ...branchShifts.dayShift, endTime: e.target.value }
                        })}
                        className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-bold text-zinc-800 focus:outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Evening Shift */}
              <div className={cn(
                "p-6 rounded-2xl border transition-all space-y-4",
                branchShifts.eveningShift.enabled ? "bg-white border-purple-200 shadow-sm" : "bg-zinc-50 border-zinc-200 opacity-60"
              )}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">🌆</span>
                    <div>
                      <h4 className="font-bold text-zinc-900 text-sm">Evening Shift</h4>
                      <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">Late Afternoon & Evening Coverage</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer"
                      checked={branchShifts.eveningShift.enabled}
                      onChange={(e) => setBranchShifts({
                        ...branchShifts,
                        eveningShift: { ...branchShifts.eveningShift, enabled: e.target.checked }
                      })}
                    />
                    <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
                  </label>
                </div>

                {branchShifts.eveningShift.enabled && (
                  <div className="grid grid-cols-2 gap-4 pt-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block">Start Time</label>
                      <input 
                        type="time" 
                        value={branchShifts.eveningShift.startTime}
                        onChange={(e) => setBranchShifts({
                          ...branchShifts,
                          eveningShift: { ...branchShifts.eveningShift, startTime: e.target.value }
                        })}
                        className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-bold text-zinc-800 focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block">End Time</label>
                      <input 
                        type="time" 
                        value={branchShifts.eveningShift.endTime}
                        onChange={(e) => setBranchShifts({
                          ...branchShifts,
                          eveningShift: { ...branchShifts.eveningShift, endTime: e.target.value }
                        })}
                        className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-bold text-zinc-800 focus:outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Night Shift */}
              <div className={cn(
                "p-6 rounded-2xl border transition-all space-y-4",
                branchShifts.nightShift.enabled ? "bg-white border-indigo-200 shadow-sm" : "bg-zinc-50 border-zinc-200 opacity-60"
              )}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">🌙</span>
                    <div>
                      <h4 className="font-bold text-zinc-900 text-sm">Night Shift</h4>
                      <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">Overnight / Emergency Hours</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer"
                      checked={branchShifts.nightShift.enabled}
                      onChange={(e) => setBranchShifts({
                        ...branchShifts,
                        nightShift: { ...branchShifts.nightShift, enabled: e.target.checked }
                      })}
                    />
                    <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-500"></div>
                  </label>
                </div>

                {branchShifts.nightShift.enabled && (
                  <div className="grid grid-cols-2 gap-4 pt-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block">Start Time</label>
                      <input 
                        type="time" 
                        value={branchShifts.nightShift.startTime}
                        onChange={(e) => setBranchShifts({
                          ...branchShifts,
                          nightShift: { ...branchShifts.nightShift, startTime: e.target.value }
                        })}
                        className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-bold text-zinc-800 focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block">End Time</label>
                      <input 
                        type="time" 
                        value={branchShifts.nightShift.endTime}
                        onChange={(e) => setBranchShifts({
                          ...branchShifts,
                          nightShift: { ...branchShifts.nightShift, endTime: e.target.value }
                        })}
                        className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-bold text-zinc-800 focus:outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-zinc-100 flex justify-end">
              <button
                onClick={handleSaveBranchShifts}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-3 bg-zinc-900 text-white rounded-2xl font-bold text-xs uppercase tracking-wider hover:bg-zinc-800 transition-all disabled:opacity-50 shadow-md"
              >
                {saving ? 'Saving...' : 'Save Shifts Configuration'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Activation Modal */}
      <AnimatePresence>
        {activationModalOpen && selectedActivation && (
          <div className="fixed inset-0 bg-zinc-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
                <h3 className="font-bold text-zinc-900">Activate Staff Account</h3>
                <button 
                  onClick={() => {
                    setActivationModalOpen(false);
                    setSelectedActivation(null);
                    setActivationPassword('');
                  }} 
                  className="p-2 hover:bg-zinc-100 rounded-xl transition-colors"
                >
                  <X size={20} className="text-zinc-400" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">Staff Member</p>
                  <p className="font-bold text-zinc-900">{selectedActivation.name}</p>
                  <p className="text-xs text-zinc-500">{selectedActivation.role}</p>
                </div>
                
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 mb-1 block uppercase tracking-wider">Set Initial Password</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                    <input 
                      type={showPassword ? "text" : "password"}
                      value={activationPassword}
                      onChange={(e) => setActivationPassword(e.target.value)}
                      className="w-full pl-12 pr-12 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      placeholder="Enter secure password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition-colors"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <p className="text-[10px] text-zinc-400 italic">This password will be required for the staff member's first login.</p>
                </div>
              </div>
              <div className="p-6 bg-zinc-50 flex items-center gap-3">
                <button 
                  onClick={() => {
                    setActivationModalOpen(false);
                    setSelectedActivation(null);
                    setActivationPassword('');
                  }}
                  className="flex-1 py-3 text-zinc-600 font-bold hover:bg-zinc-100 rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmActivation}
                  disabled={isActivating || !activationPassword}
                  className="flex-1 py-3 bg-emerald-600 text-white font-bold hover:bg-emerald-700 rounded-xl shadow-lg shadow-emerald-600/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isActivating ? <RefreshCw className="animate-spin" size={18} /> : <Check size={18} />}
                  Activate Account
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Password Reset Modal */}
      <AnimatePresence>
        {passwordResetModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Reset Password</h3>
                <button onClick={() => setPasswordResetModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-sm text-gray-600">
                  Manage password for <span className="font-semibold text-gray-900">{selectedStaff?.full_name}</span>.
                </p>
                
                {/* Current / Old Password display */}
                <div className="space-y-1 bg-zinc-50 border border-zinc-200 p-3.5 rounded-xl">
                  <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Current / Old Password</span>
                  <div className="flex items-center justify-between mt-1">
                    <p className="font-mono text-sm font-bold text-zinc-800">
                      {selectedStaff?.password || <span className="text-zinc-400 italic font-sans font-normal text-xs">Not set / Empty</span>}
                    </p>
                    {selectedStaff?.password && (
                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded uppercase tracking-wider">
                        Stored
                      </span>
                    )}
                  </div>
                </div>

                <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl text-amber-800 text-xs leading-relaxed">
                  ⚠️ <strong>Notice:</strong> This action will instantly generate a new random temporary password on-screen. Copy it immediately to share with the staff member.
                </div>
              </div>
              <div className="p-6 bg-gray-50 flex justify-end gap-3">
                <button
                  onClick={() => setPasswordResetModalOpen(false)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleResetPassword}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-bold shadow-md shadow-emerald-600/10"
                >
                  Generate Password
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Account Suspension Modal */}
      <AnimatePresence>
        {suspendModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">
                  {selectedStaff?.status === 'suspended' ? 'Reactivate Account' : 'Suspend Account'}
                </h3>
                <button onClick={() => setSuspendModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6">
                <p className="text-gray-600">
                  Are you sure you want to {selectedStaff?.status === 'suspended' ? 'reactivate' : 'suspend'} the account for{' '}
                  <span className="font-medium text-gray-900">{selectedStaff?.full_name}</span>?
                  {selectedStaff?.status !== 'suspended' && (
                    <span className="block mt-2 text-sm text-amber-600">
                      The user will no longer be able to log in to the system.
                    </span>
                  )}
                </p>
              </div>
              <div className="p-6 bg-gray-50 flex justify-end gap-3">
                <button
                  onClick={() => setSuspendModalOpen(false)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleToggleSuspend}
                  className={cn(
                    "px-4 py-2 text-white rounded-lg transition-colors",
                    selectedStaff?.status === 'suspended' ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
                  )}
                >
                  {selectedStaff?.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Settings;
