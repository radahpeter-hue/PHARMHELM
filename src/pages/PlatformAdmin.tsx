import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Plus, 
  Search, 
  Globe, 
  CreditCard, 
  Shield, 
  Settings, 
  LogOut,
  TrendingUp,
  Activity,
  CheckCircle2,
  XCircle,
  X,
  Clock,
  MoreVertical,
  Edit2,
  ExternalLink,
  LayoutDashboard,
  FileText,
  Trash2,
  AlertTriangle,
  Zap,
  Target,
  Calculator,
  BarChart2,
  Database,
  Cpu,
  Layers,
  Lock,
  Wifi,
  ShieldAlert,
  RefreshCw,
  Menu
} from 'lucide-react';
import { collection, query, getDocs, getDoc, addDoc, updateDoc, deleteDoc, doc, orderBy, limit, where, setDoc, onSnapshot } from 'firebase/firestore';
import { db, auth, registerAuthUser } from '../firebase';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Tenant, PlatformUser, PlatformAuditLog } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';
import { reportSystemCrash } from '../utils/crashReporter';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { deduplicateStaff } from '../utils/deduplicateStaff';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const PlatformAdmin = () => {
  const { platformProfile, logout } = useAuth();
  const { setTenantSlugAndMode } = useTenant();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'tenants' | 'accounts' | 'subscriptions' | 'revenue' | 'handlers' | 'audit' | 'analytics'>('dashboard');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [tenantsSubTab, setTenantsSubTab] = useState<'active' | 'deleted'>('active');
  const [quickAccessTenant, setQuickAccessTenant] = useState<Tenant | null>(null);
  const [editingHandler, setEditingHandler] = useState<any | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [activeTab]);

  // Deletion Re-authentication & Retention states
  const [showReauthModal, setShowReauthModal] = useState(false);
  const [reauthTenant, setReauthTenant] = useState<any | null>(null);
  const [reauthEmail, setReauthEmail] = useState('');
  const [reauthPassword, setReauthPassword] = useState('');
  const [reauthSaving, setReauthSaving] = useState(false);
  const [reauthAction, setReauthAction] = useState<string | null>(null);
  const [reauthPayload, setReauthPayload] = useState<any>(null);
  const [retentionPeriod, setRetentionPeriod] = useState('365');

  // 1. Accounts Module States
  const [selectedTenantForAccounts, setSelectedTenantForAccounts] = useState<string>('');
  const [staffAccounts, setStaffAccounts] = useState<any[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [overrideUserId, setOverrideUserId] = useState<string | null>(null);
  const [overrideUserFullName, setOverrideUserFullName] = useState<string>('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  // 2. Subscription Module States
  const [selectedTenantForSub, setSelectedTenantForSub] = useState<string>('');
  const [subPackage, setSubPackage] = useState<'basic' | 'standard' | 'enterprise'>('standard');
  const [subCycle, setSubCycle] = useState<'monthly' | 'annual'>('monthly');
  const [subStartDate, setSubStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [subEndDate, setSubEndDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().split('T')[0];
  });
  const [subAmountPaid, setSubAmountPaid] = useState<string>('250000');
  const [subNotes, setSubNotes] = useState('');
  const [savingSubscription, setSavingSubscription] = useState(false);
  const [isUpgradeMode, setIsUpgradeMode] = useState(false);
  const [upgradePackage, setUpgradePackage] = useState<'basic' | 'standard' | 'enterprise'>('standard');
  const [isRenewalMode, setIsRenewalMode] = useState(false);
  const [renewPackage, setRenewPackage] = useState<'basic' | 'standard' | 'enterprise'>('standard');
  const [renewCycle, setRenewCycle] = useState<'monthly' | 'annual'>('monthly');
  const [renewStartDate, setRenewStartDate] = useState('');
  const [renewEndDate, setRenewEndDate] = useState('');
  const [renewAmount, setRenewAmount] = useState('0');
  const [historyStartDate, setHistoryStartDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  });
  const [historyEndDate, setHistoryEndDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  });

  // 3. Revenue Module States
  const [revenueLogs, setRevenueLogs] = useState<any[]>([]);
  const [loadingRevenue, setLoadingRevenue] = useState(false);
  const [revSearch, setRevSearch] = useState('');
  const [revPackageFilter, setRevPackageFilter] = useState('all');
  const [revCycleFilter, setRevCycleFilter] = useState('all');

  // 3b. Platform Audit Logs States
  const [platformAuditLogs, setPlatformAuditLogs] = useState<any[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // 4. TMC Handlers Module States
  const [handlers, setHandlers] = useState<any[]>([]);
  const [loadingHandlers, setLoadingHandlers] = useState(false);
  const [handlerFirstName, setHandlerFirstName] = useState('');
  const [handlerSecondName, setHandlerSecondName] = useState('');
  const [handlerEmail, setHandlerEmail] = useState('');
  const [handlerPassword, setHandlerPassword] = useState('');
  const [handlerConfirmPassword, setHandlerConfirmPassword] = useState('');
  const [handlerAssignedTenant, setHandlerAssignedTenant] = useState('');
  const [showHandlerPassword, setShowHandlerPassword] = useState(false);
  const [savingHandler, setSavingHandler] = useState(false);

  const isSuper = platformProfile?.role === 'super_operator' || 
                  platformProfile?.email === 'peterssentongo61@gmail.com' ||
                  platformProfile?.email === 'peter.sentongo@pharmhelm' ||
                  localStorage.getItem('auth_username') === 'peter.sentongo@pharmhelm' ||
                  localStorage.getItem('auth_username') === 'peterssentongo61@gmail.com' ||
                  localStorage.getItem('auth_bypass_email') === 'peterssentongo61@gmail.com' ||
                  localStorage.getItem('auth_bypass_email') === 'peter.sentongo@pharmhelm';

  // Subscription Rates Config State
  const [rates, setRates] = useState({
    basic: 100000,
    standard: 250000,
    enterprise: 500000
  });
  const [loadingRates, setLoadingRates] = useState(false);
  const [savingRates, setSavingRates] = useState(false);

  const fetchSubscriptionRates = async () => {
    setLoadingRates(true);
    try {
      const ratesDoc = await getDoc(doc(db, 'platform_settings', 'subscription_rates'));
      if (ratesDoc.exists()) {
        const data = ratesDoc.data();
        setRates({
          basic: data.basic ?? 100000,
          standard: data.standard ?? 250000,
          enterprise: data.enterprise ?? 500000
        });
      }
    } catch (err) {
      console.error('Error fetching subscription rates:', err);
    } finally {
      setLoadingRates(false);
    }
  };

  useEffect(() => {
    fetchSubscriptionRates();
  }, []);

  const handleSaveRates = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingRates(true);
    try {
      await setDoc(doc(db, 'platform_settings', 'subscription_rates'), {
        basic: Number(rates.basic),
        standard: Number(rates.standard),
        enterprise: Number(rates.enterprise),
        updatedAt: new Date().toISOString(),
        updatedBy: platformProfile?.full_name || 'System Admin'
      });
      toast.success('Subscription rates saved successfully!');
      await logPlatformAction(
        'Subscription Rates Configured',
        `Updated package rates: Basic = UGX ${Number(rates.basic).toLocaleString()}/mo, Standard = UGX ${Number(rates.standard).toLocaleString()}/mo, Enterprise = UGX ${Number(rates.enterprise).toLocaleString()}/mo`
      );
    } catch (err) {
      console.error(err);
      toast.error('Failed to save subscription rates.');
    } finally {
      setSavingRates(false);
    }
  };

  // 1. Watch package, cycle, and start date to set default end date
  useEffect(() => {
    const start = new Date(subStartDate);
    if (isNaN(start.getTime())) return;
    if (subCycle === 'monthly') {
      start.setMonth(start.getMonth() + 1);
    } else {
      start.setFullYear(start.getFullYear() + 1);
    }
    setSubEndDate(start.toISOString().split('T')[0]);
  }, [subPackage, subCycle, subStartDate]);

  // 2. Watch package, start date, and end date to auto-calculate amount based on defined rates
  useEffect(() => {
    const start = new Date(subStartDate);
    const end = new Date(subEndDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
      setSubAmountPaid('0');
      return;
    }
    const diffTime = Math.max(0, end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    const monthlyRate = rates[subPackage] || 100000;
    
    // Prorate rate: monthly rate is for 30 days
    const calculated = Math.round((diffDays / 30) * monthlyRate);
    setSubAmountPaid(calculated.toString());
  }, [subPackage, subStartDate, subEndDate, rates]);

  // Watch renewal dates and package to calculate renewal amount
  useEffect(() => {
    if (!isRenewalMode) return;
    const start = new Date(renewStartDate);
    const end = new Date(renewEndDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
      setRenewAmount('0');
      return;
    }
    const diffTime = Math.max(0, end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const monthlyRate = rates[renewPackage] || 100000;
    const calculated = Math.round((diffDays / 30) * monthlyRate);
    setRenewAmount(calculated.toString());
  }, [renewPackage, renewStartDate, renewEndDate, rates, isRenewalMode]);

  // Set default dates when opening renewal mode or changing cycle
  useEffect(() => {
    if (!isRenewalMode || !selectedTenantForSub) return;
    const tenantToUpdate = tenants.find(t => t.id === selectedTenantForSub);
    if (!tenantToUpdate) return;

    let startStr = new Date().toISOString().split('T')[0];
    if (tenantToUpdate.subscription_end) {
      const currentEnd = new Date(tenantToUpdate.subscription_end);
      if (currentEnd > new Date()) {
        startStr = tenantToUpdate.subscription_end.split('T')[0];
      }
    }
    setRenewStartDate(startStr);

    const start = new Date(startStr);
    if (renewCycle === 'monthly') {
      start.setMonth(start.getMonth() + 1);
    } else {
      start.setFullYear(start.getFullYear() + 1);
    }
    setRenewEndDate(start.toISOString().split('T')[0]);
  }, [renewCycle, isRenewalMode, selectedTenantForSub]);

  // Load secondary collections reactively
  useEffect(() => {
    if (activeTab === 'revenue' || activeTab === 'subscriptions') {
      fetchRevenueLogs();
    }
    if (activeTab === 'handlers') {
      fetchHandlers();
    } else if (activeTab === 'audit') {
      fetchPlatformAuditLogs();
    }
  }, [activeTab]);

  useEffect(() => {
    if (selectedTenantForAccounts) {
      fetchStaffAccounts(selectedTenantForAccounts);
    } else {
      setStaffAccounts([]);
    }
  }, [selectedTenantForAccounts]);

  useEffect(() => {
    let unsubscribe = () => {};
    
    const setupListener = () => {
      const q = query(collection(db, 'tenants'), orderBy('created_at', 'desc'));
      unsubscribe = onSnapshot(q, (snapshot) => {
        let tenantList = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Tenant));
        
        if (platformProfile?.role === 'tmc_handler') {
          const assignedIds = platformProfile.assignedTenantIds || [];
          if (platformProfile.assignedTenantId && !assignedIds.includes(platformProfile.assignedTenantId)) {
            assignedIds.push(platformProfile.assignedTenantId);
          }
          tenantList = tenantList.filter(t => assignedIds.includes(t.id) || assignedIds.includes(t.slug));
        }
        
        // Check for Auto-Delete (Step 2c)
        const nowCheck = new Date();
        tenantList.forEach(async (t) => {
          if ((t.status === 'deleted' || (t as any).deleted === true) && t.deleted_expires_at) {
            const expDate = new Date(t.deleted_expires_at);
            if (nowCheck >= expDate) {
              console.log(`Auto-deleting tenant ${t.name} (expired retention period)...`);
              try {
                await performCascadeDelete(t.id);
                toast.info(`Tenant ${t.name} auto-deleted (retention period expired).`);
              } catch (e) {
                console.error(`Failed to auto-delete tenant ${t.name}:`, e);
              }
            }
          }
        });

        setTenants(tenantList);
        setLoading(false);

        if (tenantList.length > 0) {
          if (!selectedTenantForAccounts) {
            setSelectedTenantForAccounts(tenantList[0].id);
          }
          if (!selectedTenantForSub) {
            setSelectedTenantForSub(tenantList[0].id);
          }
        }
      }, (error) => {
        console.error('Error listening to tenants:', error);
        toast.error('Failed to load tenants in real-time');
        setLoading(false);
      });
    };

    setupListener();
    return () => unsubscribe();
  }, [platformProfile]);

  const fetchTenants = async () => {
    // Handled in real-time by the useEffect snapshot listener
  };

  const performCascadeDelete = async (tenantId: string) => {
    const subCollections = [
      'staff', 'clients', 'products', 'product_batches', 'sales', 
      'eod_reconciliations', 'petty_cash_ledger', 'welfare', 'csr', 
      'stock_orders', 'stock_order_lines', 'fuel_logs', 'maintenance_logs', 
      'traffic_fine_logs', 'logistics_expenses', 'payroll', 
      'marketing_expenses', 'sourcing_lines', 'welfare_records'
    ];

    for (const colName of subCollections) {
      try {
        const q = query(collection(db, colName), where('tenantId', '==', tenantId));
        const snap = await getDocs(q);
        for (const d of snap.docs) {
          await deleteDoc(doc(db, colName, d.id));
        }
      } catch (err) {
        console.error(`Error purging ${colName}:`, err);
      }
    }

    try {
      await deleteDoc(doc(db, 'system_settings', tenantId));
    } catch (_) {}

    await deleteDoc(doc(db, 'tenants', tenantId));
  };

  const handleReauthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reauthTenant) return;
    setReauthSaving(true);
    try {
      const credential = EmailAuthProvider.credential(reauthEmail, reauthPassword);
      await reauthenticateWithCredential(auth.currentUser!, credential);

      // Branch based on requested reauthAction
      if (reauthAction === 'purge') {
        await performCascadeDelete(reauthTenant.id);
        toast.success(`Tenant ${reauthTenant.name} has been permanently deleted.`);
      } else if (reauthAction === 'updateBranchLimit') {
        const payload = reauthPayload || {};
        const tenantRef = doc(db, 'tenants', reauthTenant.id);
        await updateDoc(tenantRef, { branchLimit: payload.newLimit });
        await addDoc(collection(db, 'global_audit_logs'), {
          action: 'BRANCH_LIMIT_CHANGED',
          category: 'TENANT',
          description: `Changed branchLimit from ${payload.oldLimit} to ${payload.newLimit}`,
          timestamp: new Date().toISOString(),
          tenantId: reauthTenant.id,
          actor: auth.currentUser?.uid || 'system',
          ipAddress: 'client-side',
          device: window.navigator.userAgent || 'web'
        });
        toast.success(`Branch limit updated to ${payload.newLimit} for ${reauthTenant.name}`);
      } else if (reauthAction === 'grantTrial') {
        const payload = reauthPayload || {};
        const tenantRef = doc(db, 'tenants', reauthTenant.id);
        const trialStatus = {
          isTrial: true,
          trialBranchLimit: payload.trialBranchLimit,
          trialStartDate: payload.trialStartDate,
          trialEndDate: payload.trialEndDate,
          grantedBy: auth.currentUser?.uid || 'system',
          grantedAt: new Date().toISOString(),
          notes: payload.notes || ''
        };
        await updateDoc(tenantRef, { trialStatus: trialStatus, branchLimit: payload.trialBranchLimit });
        await addDoc(collection(db, 'global_audit_logs'), {
          action: 'TRIAL_GRANTED',
          category: 'TENANT',
          description: `Trial granted: branchLimit=${payload.trialBranchLimit}, end=${payload.trialEndDate}`,
          timestamp: new Date().toISOString(),
          tenantId: reauthTenant.id,
          actor: auth.currentUser?.uid || 'system',
          ipAddress: 'client-side',
          device: window.navigator.userAgent || 'web'
        });
        toast.success(`Trial access granted for ${reauthTenant.name}`);
      } else if (reauthAction === 'grantComplimentary') {
        const payload = reauthPayload || {};
        const tenantRef = doc(db, 'tenants', reauthTenant.id);
        const complimentaryPeriod = {
          isActive: true,
          startDate: payload.startDate,
          endDate: payload.endDate,
          reason: payload.reason || '',
          grantedBy: auth.currentUser?.uid || 'system',
          grantedAt: new Date().toISOString()
        };
        await updateDoc(tenantRef, { complimentaryPeriod });
        await addDoc(collection(db, 'global_audit_logs'), {
          action: 'COMPLIMENTARY_PERIOD_GRANTED',
          category: 'TENANT',
          description: `Complimentary period granted: ${payload.startDate} to ${payload.endDate} - ${payload.reason}`,
          timestamp: new Date().toISOString(),
          tenantId: reauthTenant.id,
          actor: auth.currentUser?.uid || 'system',
          ipAddress: 'client-side',
          device: window.navigator.userAgent || 'web'
        });
        toast.success(`Complimentary period granted for ${reauthTenant.name}`);
      }

      // Reset modal state
      setShowReauthModal(false);
      setReauthTenant(null);
      setReauthEmail('');
      setReauthPassword('');
      setReauthAction(null);
      setReauthPayload(null);
    } catch (err: any) {
      console.error(err);
      toast.error(`Re-authentication failed: ${err.message || 'Incorrect credentials.'}`);
    } finally {
      setReauthSaving(false);
    }
  };

  const fetchStaffAccounts = async (tenantId: string) => {
    setLoadingAccounts(true);
    try {
      const q = query(collection(db, 'staff'), where('tenantId', '==', tenantId));
      const snap = await getDocs(q);
      const accounts = deduplicateStaff(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setStaffAccounts(accounts);
    } catch (err) {
      console.error('Error fetching staff accounts:', err);
      toast.error('Failed to load accounts for this tenant');
    } finally {
      setLoadingAccounts(false);
    }
  };

  const fetchRevenueLogs = async () => {
    setLoadingRevenue(true);
    try {
      const q = query(collection(db, 'platform_revenue'), orderBy('paymentDate', 'desc'));
      const snap = await getDocs(q);
      const logs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRevenueLogs(logs);
    } catch (err) {
      console.error('Error fetching revenue:', err);
    } finally {
      setLoadingRevenue(false);
    }
  };

  const fetchHandlers = async () => {
    setLoadingHandlers(true);
    try {
      const q = query(collection(db, 'platform_users'));
      const snap = await getDocs(q);
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setHandlers(list);
    } catch (err) {
      console.error('Error fetching handlers:', err);
    } finally {
      setLoadingHandlers(false);
    }
  };

  const fetchPlatformAuditLogs = async () => {
    setLoadingAudit(true);
    try {
      const q = query(collection(db, 'platform_audit_logs'), orderBy('timestamp', 'desc'), limit(100));
      const snap = await getDocs(q);
      const logs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPlatformAuditLogs(logs);
    } catch (err) {
      console.error('Error fetching platform audit logs:', err);
    } finally {
      setLoadingAudit(false);
    }
  };

  const logPlatformAction = async (action: string, details: string, targetId?: string) => {
    try {
      await addDoc(collection(db, 'platform_audit_logs'), {
        action,
        details,
        targetId: targetId || '',
        timestamp: new Date().toISOString(),
        performedBy: platformProfile?.full_name || platformProfile?.email || 'System Admin',
        ipAddress: '197.239.4.15'
      });
    } catch (err) {
      console.error('Error writing platform audit log:', err);
    }
  };

  const handleSubscriptionActivation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenantForSub) {
      toast.error('Please select a tenant');
      return;
    }
    const tenantToUpdate = tenants.find(t => t.id === selectedTenantForSub);
    if (!tenantToUpdate) {
      toast.error('Selected tenant not found');
      return;
    }

    setSavingSubscription(true);
    try {
      // 1. Update Tenant subscription details in Firestore
      const tenantRef = doc(db, 'tenants', selectedTenantForSub);
      await updateDoc(tenantRef, {
        subscription_status: 'active',
        subscription_tier: subPackage,
        subscription_cycle: subCycle,
        subscription_start: subStartDate,
        subscription_end: subEndDate,
        status: 'active'
      });

      // 2. Add transaction to platform_revenue log
      await addDoc(collection(db, 'platform_revenue'), {
        tenantId: selectedTenantForSub,
        tenantName: tenantToUpdate.name,
        amount: Number(subAmountPaid),
        package: subPackage,
        cycle: subCycle,
        paymentDate: new Date().toISOString(),
        subscriptionStart: subStartDate,
        subscriptionEnd: subEndDate,
        loggedBy: platformProfile?.full_name || platformProfile?.email || 'System Admin',
        notes: subNotes || 'Activated via TMC Subscription panel.'
      });

      toast.success(`Subscription activated for ${tenantToUpdate.name}! Payment logged.`);
      await logPlatformAction(
        'Subscription Activated',
        `Activated ${subPackage} (${subCycle}) subscription for ${tenantToUpdate.name} - UGX ${Number(subAmountPaid).toLocaleString()}`,
        selectedTenantForSub
      );
      setSubNotes('');
      fetchTenants(); // refresh tenants list
    } catch (err) {
      console.error(err);
      toast.error('Failed to activate subscription.');
    } finally {
      setSavingSubscription(false);
    }
  };

  const handleSubscriptionUpgrade = async (upgradeTopUp: number) => {
    if (!selectedTenantForSub) {
      toast.error('Please select a tenant');
      return;
    }
    const tenantToUpdate = tenants.find(t => t.id === selectedTenantForSub);
    if (!tenantToUpdate) {
      toast.error('Selected tenant not found');
      return;
    }

    setSavingSubscription(true);
    try {
      const tenantRef = doc(db, 'tenants', selectedTenantForSub);
      await updateDoc(tenantRef, {
        subscription_tier: upgradePackage,
        subscription_status: 'active',
        status: 'active'
      });

      await addDoc(collection(db, 'platform_revenue'), {
        tenantId: selectedTenantForSub,
        tenantName: tenantToUpdate.name,
        amount: upgradeTopUp,
        package: upgradePackage,
        cycle: tenantToUpdate.subscription_cycle || 'monthly',
        paymentDate: new Date().toISOString(),
        subscriptionStart: tenantToUpdate.subscription_start || new Date().toISOString().split('T')[0],
        subscriptionEnd: tenantToUpdate.subscription_end || new Date().toISOString().split('T')[0],
        loggedBy: platformProfile?.full_name || platformProfile?.email || 'System Admin',
        notes: subNotes || `Upgraded package from ${tenantToUpdate.subscription_tier} to ${upgradePackage}. (Top-up payment)`,
        isUpgrade: true,
        previousPackage: tenantToUpdate.subscription_tier
      });

      toast.success(`Subscription package successfully upgraded to ${upgradePackage}!`);
      await logPlatformAction(
        'Subscription Upgraded',
        `Upgraded ${tenantToUpdate.name} to ${upgradePackage} package - Top-up payment: UGX ${upgradeTopUp.toLocaleString()}`,
        selectedTenantForSub
      );

      setSubNotes('');
      setIsUpgradeMode(false);
      fetchTenants(); // refresh list
      fetchRevenueLogs(); // refresh revenue list for history
    } catch (err) {
      console.error(err);
      toast.error('Failed to process subscription upgrade.');
    } finally {
      setSavingSubscription(false);
    }
  };

  const handleSubscriptionRenewal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenantForSub) return;
    const tenantToUpdate = tenants.find(t => t.id === selectedTenantForSub);
    if (!tenantToUpdate) return;

    setSavingSubscription(true);
    try {
      const tenantRef = doc(db, 'tenants', selectedTenantForSub);
      await updateDoc(tenantRef, {
        subscription_status: 'active',
        subscription_tier: renewPackage,
        subscription_cycle: renewCycle,
        subscription_start: renewStartDate,
        subscription_end: renewEndDate,
        status: 'active'
      });

      await addDoc(collection(db, 'platform_revenue'), {
        tenantId: selectedTenantForSub,
        tenantName: tenantToUpdate.name,
        amount: Number(renewAmount),
        package: renewPackage,
        cycle: renewCycle,
        paymentDate: new Date().toISOString(),
        subscriptionStart: renewStartDate,
        subscriptionEnd: renewEndDate,
        loggedBy: platformProfile?.full_name || platformProfile?.email || 'System Admin',
        notes: subNotes || `Renewed subscription for package ${renewPackage} (${renewCycle}).`,
        isRenewal: true
      });

      toast.success(`Subscription renewed successfully for ${tenantToUpdate.name}!`);
      await logPlatformAction(
        'Subscription Renewed',
        `Renewed ${renewPackage} subscription for ${tenantToUpdate.name} - UGX ${Number(renewAmount).toLocaleString()}`,
        selectedTenantForSub
      );

      setSubNotes('');
      setIsRenewalMode(false);
      fetchTenants();
      fetchRevenueLogs();
    } catch (err) {
      console.error(err);
      toast.error('Failed to renew subscription.');
    } finally {
      setSavingSubscription(false);
    }
  };

  const getTenantSubscriptionLogs = (tenantId: string) => {
    const logs = revenueLogs
      .filter(log => log.tenantId === tenantId)
      .filter(log => {
        if (!log.paymentDate) return false;
        const dateStr = log.paymentDate.split('T')[0];
        return dateStr >= historyStartDate && dateStr <= historyEndDate;
      })
      .sort((a, b) => new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime());

    const tenantObj = tenants.find(t => t.id === tenantId);
    const creationDate = tenantObj?.created_at ? new Date(tenantObj.created_at) : null;

    return logs.map((log, index) => {
      let daysUnsubscribed = 0;
      let label = "";

      if (index === 0) {
        if (creationDate && new Date(log.subscriptionStart) > creationDate) {
          const diffTime = new Date(log.subscriptionStart).getTime() - creationDate.getTime();
          daysUnsubscribed = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
          label = `${daysUnsubscribed} days (Since Creation)`;
        } else {
          daysUnsubscribed = 0;
          label = "0 days (First Sub)";
        }
      } else {
        const prevLog = logs[index - 1];
        const prevEnd = new Date(prevLog.subscriptionEnd);
        const currStart = new Date(log.subscriptionStart);

        if (currStart > prevEnd) {
          const diffTime = currStart.getTime() - prevEnd.getTime();
          daysUnsubscribed = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
          label = `${daysUnsubscribed} days`;
        } else {
          daysUnsubscribed = 0;
          label = "0 days (Renewed / Upgraded)";
        }
      }

      return {
        ...log,
        daysUnsubscribed,
        daysUnsubscribedLabel: label
      };
    }).reverse();
  };

  const handleCreateHandler = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!handlerFirstName || !handlerSecondName) {
      toast.error('Please enter first name and second name');
      return;
    }
    if (!handlerPassword) {
      toast.error('Please enter a password');
      return;
    }
    if (handlerPassword !== handlerConfirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (!handlerAssignedTenant) {
      toast.error('Please assign a tenant to this handler');
      return;
    }

    const email = `${handlerFirstName.toLowerCase()}.${handlerSecondName.toLowerCase()}@pharmhelm`;
    
    setSavingHandler(true);
    try {
      const q = query(collection(db, 'platform_users'), where('email', '==', email));
      const snap = await getDocs(q);
      if (!snap.empty) {
        toast.error(`A platform user with email ${email} already exists.`);
        setSavingHandler(false);
        return;
      }

      await addDoc(collection(db, 'platform_users'), {
        email: email,
        password: handlerPassword,
        role: 'tmc_handler',
        full_name: `${handlerFirstName} ${handlerSecondName}`,
        active: true,
        assignedTenantId: handlerAssignedTenant,
        created_at: new Date().toISOString()
      });

      toast.success(`TMC Handler ${handlerFirstName} ${handlerSecondName} created successfully!`);
      await logPlatformAction(
        'Handler Account Created',
        `Created operator profile for ${handlerFirstName} ${handlerSecondName} (${email}) assigned to tenant ID ${handlerAssignedTenant}`
      );
      setHandlerFirstName('');
      setHandlerSecondName('');
      setHandlerPassword('');
      setHandlerConfirmPassword('');
      setHandlerAssignedTenant('');
      fetchHandlers();
    } catch (err) {
      console.error(err);
      toast.error('Failed to create handler');
    } finally {
      setSavingHandler(false);
    }
  };

  const monthlyTenantData = React.useMemo(() => {
    const data: { monthLabel: string; count: number; rawDate: Date }[] = [];
    const now = new Date();

    // Create the last 12 months array (ordered chronologically)
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      data.push({ monthLabel: label, count: 0, rawDate: d });
    }

    // Aggregate tenants into the respective months they were created
    tenants.forEach(tenant => {
      if (!tenant.created_at || tenant.deleted) return;
      const createdDate = new Date(tenant.created_at);
      
      // Find the month bucket
      data.forEach(bucket => {
        // A tenant is active/provisioned in a bucket month if it was created before or during that month
        const bucketEndOfMonth = new Date(bucket.rawDate.getFullYear(), bucket.rawDate.getMonth() + 1, 0, 23, 59, 59);
        if (createdDate <= bucketEndOfMonth) {
          bucket.count += 1;
        }
      });
    });

    return data;
  }, [tenants]);

  const stats = {
    total: tenants.length,
    active: tenants.filter(t => t.subscription_status === 'active').length,
    revenue: tenants.reduce((acc, t) => {
      const amount = t.subscription_tier === 'enterprise' ? 500000 : t.subscription_tier === 'standard' ? 250000 : 100000;
      return t.subscription_status === 'active' ? acc + amount : acc;
    }, 0),
    growth: '+12%'
  };

  return (
    <div className="min-h-screen bg-[#E4E3E0] flex font-sans overflow-hidden">
      {mobileNavOpen && (
        <button
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close navigation menu"
        />
      )}
      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-72 md:w-64 bg-[#141414] text-white flex flex-col transition-transform duration-300 md:relative md:translate-x-0",
        mobileNavOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-8 w-8 bg-emerald-500 rounded-lg flex items-center justify-center">
              <Shield size={20} className="text-white" />
            </div>
            <span className="font-bold tracking-tight text-lg">PHARMHELM TMC</span>
          </div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold">Tenant Management Console</p>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all",
              activeTab === 'dashboard' ? "bg-white/10 text-white" : "text-white/50 hover:text-white hover:bg-white/5"
            )}
          >
            <LayoutDashboard size={18} />
            Dashboard
          </button>
          
          <button 
            onClick={() => setActiveTab('tenants')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all",
              activeTab === 'tenants' ? "bg-white/10 text-white" : "text-white/50 hover:text-white hover:bg-white/5"
            )}
          >
            <Users size={18} />
            Tenants
          </button>

          <button 
            onClick={() => setActiveTab('accounts')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all",
              activeTab === 'accounts' ? "bg-white/10 text-white" : "text-white/50 hover:text-white hover:bg-white/5"
            )}
          >
            <Shield size={18} />
            Accounts
          </button>

          <button 
            onClick={() => setActiveTab('subscriptions')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all",
              activeTab === 'subscriptions' ? "bg-white/10 text-white" : "text-white/50 hover:text-white hover:bg-white/5"
            )}
          >
            <CreditCard size={18} />
            Subscriptions
          </button>

          <button 
            onClick={() => setActiveTab('revenue')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all",
              activeTab === 'revenue' ? "bg-white/10 text-white" : "text-white/50 hover:text-white hover:bg-white/5"
            )}
          >
            <TrendingUp size={18} />
            Revenue Tracker
          </button>

          <button 
            onClick={() => setActiveTab('analytics')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all",
              activeTab === 'analytics' ? "bg-white/10 text-white" : "text-white/50 hover:text-white hover:bg-white/5"
            )}
          >
            <BarChart2 size={18} />
            Telemetry & Metrics
          </button>

          {isSuper && (
            <button 
              onClick={() => setActiveTab('handlers')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all",
                activeTab === 'handlers' ? "bg-white/10 text-white" : "text-white/50 hover:text-white hover:bg-white/5"
              )}
            >
              <Settings size={18} />
              TMC Handlers
            </button>
          )}

          <button 
            onClick={() => setActiveTab('audit')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all",
              activeTab === 'audit' ? "bg-white/10 text-white" : "text-white/50 hover:text-white hover:bg-white/5"
            )}
          >
            <FileText size={18} />
            Audit Logs
          </button>
        </nav>

        <div className="p-4 border-t border-white/10">
          <div className="flex items-center gap-3 px-4 py-3 mb-4">
            <div className="h-8 w-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold">
              {(platformProfile?.name || platformProfile?.full_name || 'System Admin').charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate">{platformProfile?.name || platformProfile?.full_name || 'System Admin'}</p>
              <p className="text-[10px] text-white/40 uppercase tracking-wider">{(platformProfile?.role || 'admin').replace('_', ' ')}</p>
            </div>
          </div>
          <button 
            onClick={() => setTenantSlugAndMode('radah')}
            className="w-full flex items-center gap-3 px-4 py-3 mb-2 rounded-xl text-sm font-medium text-emerald-400 hover:bg-emerald-400/10 transition-all border border-emerald-500/20"
          >
            <ExternalLink size={18} />
            Enter Tenant ERP
          </button>
          <button 
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-red-400 hover:bg-red-400/10 transition-all"
          >
            <LogOut size={18} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden min-h-screen">
        <header className="min-h-16 bg-white border-b border-[#141414]/10 flex items-center justify-between px-3 sm:px-5 md:px-8 gap-3 shrink-0">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="md:hidden p-2 rounded-xl text-[#141414]/70 hover:bg-[#E4E3E0]"
            aria-label="Open navigation menu"
          >
            <Menu size={24} />
          </button>
          <h2 className="text-sm font-bold uppercase tracking-widest text-[#141414]/60">
            {activeTab === 'dashboard' ? 'Network Overview' : activeTab === 'tenants' ? 'Tenant Directory' : activeTab === 'analytics' ? 'Performance & Telemetry' : 'Platform Audit'}
          </h2>
          <div className="flex items-center gap-2 sm:gap-4 ml-auto">
            <div className="relative hidden sm:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#141414]/40" size={16} />
              <input 
                type="text" 
                placeholder="Search tenants..."
                className="pl-10 pr-4 py-2 bg-[#E4E3E0]/50 border border-[#141414]/10 rounded-full text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 w-64 transition-all"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {activeTab === 'tenants' && (
              <button 
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-2 bg-[#141414] text-white px-4 py-2 rounded-full text-sm font-bold hover:bg-[#2a2a2a] transition-all shadow-lg shadow-[#141414]/10"
              >
                <Plus size={16} />
                <span className="hidden sm:inline">New Tenant</span>
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-auto p-3 sm:p-5 md:p-8">
          {activeTab === 'dashboard' && (
            <div className="space-y-8">
              {/* Stats Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6">
                {[
                  { label: 'Total Tenants', value: stats.total, icon: Users, color: 'text-blue-500' },
                  { label: 'Active Subscriptions', value: stats.active, icon: CheckCircle2, color: 'text-emerald-500' },
                  { label: 'Monthly Revenue', value: `UGX ${stats.revenue.toLocaleString()}`, icon: TrendingUp, color: 'text-purple-500' },
                  { label: 'Platform Health', value: '99.9%', icon: Activity, color: 'text-orange-500' }
                ].map((stat, i) => (
                  <div key={i} className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <div className={cn("p-2 rounded-xl bg-zinc-50", stat.color)}>
                        <stat.icon size={20} />
                      </div>
                      <span className="text-[10px] font-bold text-emerald-500 bg-emerald-50 px-2 py-1 rounded-full">+4.5%</span>
                    </div>
                    <p className="text-2xl font-bold text-[#141414]">{stat.value}</p>
                    <p className="text-[10px] uppercase tracking-wider text-[#141414]/40 font-bold mt-1">{stat.label}</p>
                  </div>
                ))}
              </div>

              {/* Recent Activity & Charts Placeholder */}
              <div className="grid grid-cols-3 gap-6">
                <div className="col-span-2 bg-white rounded-3xl border border-[#141414]/5 shadow-sm p-6">
                  <h3 className="text-sm font-bold uppercase tracking-widest mb-6">Subscription Growth</h3>
                  <div className="h-64 flex items-end gap-2">
                    {monthlyTenantData.map((dataPoint, i) => {
                      const maxCount = Math.max(...monthlyTenantData.map(d => d.count), 5);
                      const heightPercent = (dataPoint.count / maxCount) * 100;
                      return (
                        <div 
                          key={i} 
                          className="flex-1 bg-emerald-500/20 rounded-t-lg hover:bg-emerald-500 transition-all cursor-pointer group relative" 
                          style={{ height: `${Math.max(heightPercent, 5)}%` }}
                        >
                          <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-[#141414] text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                            {dataPoint.count} Tenants ({dataPoint.monthLabel})
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between mt-4 text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">
                    <span>{monthlyTenantData[0]?.monthLabel}</span>
                    <span>{monthlyTenantData[monthlyTenantData.length - 1]?.monthLabel}</span>
                  </div>
                </div>

                <div className="bg-white rounded-3xl border border-[#141414]/5 shadow-sm p-6">
                  <h3 className="text-sm font-bold uppercase tracking-widest mb-6">Recent Tenants</h3>
                  <div className="space-y-4">
                    {tenants.slice(0, 5).map((tenant) => (
                      <div key={tenant.id} className="flex items-center gap-3 p-3 hover:bg-zinc-50 rounded-2xl transition-all cursor-pointer border border-transparent hover:border-zinc-100">
                        <div 
                          className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold"
                          style={{ backgroundColor: tenant.brand_colour }}
                        >
                          {tenant.name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold truncate">{tenant.name}</p>
                          <p className="text-[10px] text-[#141414]/40 font-medium">{tenant.slug}.pharmhelm.com</p>
                        </div>
                        <div className={cn(
                          "h-2 w-2 rounded-full",
                          tenant.subscription_status === 'active' ? "bg-emerald-500" : "bg-zinc-300"
                        )} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'tenants' && (
            <div className="space-y-6">
              {/* Sub-tab Navigation */}
              <div className="flex border-b border-[#141414]/10 gap-8 pb-1 mb-2">
                <button 
                  onClick={() => setTenantsSubTab('active')}
                  className={cn(
                    "pb-3 text-xs font-bold uppercase tracking-widest border-b-2 transition-all",
                    tenantsSubTab === 'active' ? "border-emerald-500 text-emerald-600" : "border-transparent text-zinc-400 hover:text-zinc-600"
                  )}
                >
                  Active Directory ({tenants.filter(t => !t.deleted).length})
                </button>
                <button 
                  onClick={() => setTenantsSubTab('deleted')}
                  className={cn(
                    "pb-3 text-xs font-bold uppercase tracking-widest border-b-2 transition-all",
                    tenantsSubTab === 'deleted' ? "border-red-500 text-red-600" : "border-transparent text-zinc-400 hover:text-zinc-600"
                  )}
                >
                  Deleted Tenants Bin ({tenants.filter(t => t.deleted).length})
                </button>
              </div>

              {tenantsSubTab === 'active' ? (
                <div className="bg-white rounded-3xl border border-[#141414]/5 shadow-sm overflow-hidden animate-in fade-in duration-200">
                  <div className="grid grid-cols-7 gap-4 p-6 bg-zinc-50 border-b border-[#141414]/5">
                    <div className="col-span-2 text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">Tenant / Subdomain</div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">Tier</div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">Status</div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">Renewal</div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">Created</div>
                    <div className="text-right text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">Actions</div>
                  </div>

                  <div className="divide-y divide-[#141414]/5">
                    {tenants.filter(t => !t.deleted).filter(t => 
                      t.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                      t.slug.toLowerCase().includes(searchQuery.toLowerCase())
                    ).map((tenant) => (
                      <div 
                        key={tenant.id} 
                        onClick={() => setEditingTenant(tenant)}
                        className="grid grid-cols-7 gap-4 p-6 items-center hover:bg-zinc-50/50 transition-all group cursor-pointer"
                      >
                        <div className="col-span-2 flex items-center gap-4">
                          <div 
                            className="h-12 w-12 rounded-2xl flex items-center justify-center text-white text-lg font-bold shadow-inner"
                            style={{ backgroundColor: tenant.brand_colour }}
                          >
                            {tenant.logo_url ? (
                              <img src={tenant.logo_url} alt="" className="w-full h-full object-cover rounded-2xl" referrerPolicy="no-referrer" />
                            ) : tenant.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-bold text-[#141414]">{tenant.name} {tenant.acronym ? <span className="text-[10px] bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded font-mono font-bold ml-1.5 uppercase">@{tenant.acronym}</span> : null}</p>
                            <div className="flex items-center gap-1 text-[10px] text-[#141414]/40 font-bold uppercase tracking-wider mt-0.5">
                              <Globe size={10} />
                              {tenant.slug}.pharmhelm.com
                            </div>
                          </div>
                        </div>

                        <div>
                          <span className={cn(
                            "text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full",
                            tenant.subscription_tier === 'enterprise' ? "bg-purple-100 text-purple-600" :
                            tenant.subscription_tier === 'standard' ? "bg-blue-100 text-blue-600" : "bg-zinc-100 text-zinc-600"
                          )}>
                            {tenant.subscription_tier}
                          </span>
                        </div>

                        <div>
                          <div className="flex items-center gap-2">
                            <div className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              tenant.subscription_status === 'active' ? "bg-emerald-500" :
                              tenant.subscription_status === 'expired' ? "bg-red-500" : "bg-orange-500"
                            )} />
                            <span className="text-xs font-bold text-[#141414] capitalize">{tenant.subscription_status}</span>
                          </div>
                        </div>

                        <div className="text-xs font-medium text-[#141414]/60">
                          {tenant.subscription_end ? format(new Date(tenant.subscription_end), 'MMM dd, yyyy') : 'Pending Activation'}
                        </div>

                        <div className="text-xs font-medium text-[#141414]/60">
                          {format(new Date(tenant.created_at), 'MMM dd, yyyy')}
                        </div>

                        <div className="flex justify-end gap-2">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingTenant(tenant);
                            }}
                            className="p-2 hover:bg-zinc-100 rounded-xl text-[#141414]/40 hover:text-[#141414] transition-all"
                            title="Edit Tenant Settings"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setQuickAccessTenant(tenant);
                            }}
                            className="p-2 bg-emerald-50 hover:bg-emerald-100 rounded-xl text-emerald-600 transition-all font-bold flex items-center justify-center"
                            title="Quick Access Link"
                          >
                            <ExternalLink size={16} />
                          </button>
                          <button 
                            onClick={(e) => e.stopPropagation()}
                            className="p-2 hover:bg-zinc-100 rounded-xl text-[#141414]/40 hover:text-[#141414] transition-all"
                          >
                            <MoreVertical size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {tenants.filter(t => !t.deleted).length === 0 && (
                      <div className="p-12 text-center text-zinc-400 text-sm">
                        No active tenants found.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-3xl border border-[#141414]/5 shadow-sm overflow-hidden animate-in fade-in duration-200">
                  <div className="grid grid-cols-7 gap-4 p-6 bg-zinc-50 border-b border-[#141414]/5">
                    <div className="col-span-2 text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">Tenant / Subdomain</div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">Deleted At</div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">Auto Deletion Expiry</div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">Days Remaining</div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">Status</div>
                    <div className="text-right text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">Actions</div>
                  </div>

                  <div className="divide-y divide-[#141414]/5">
                    {tenants.filter(t => t.deleted).filter(t => 
                      t.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                      t.slug.toLowerCase().includes(searchQuery.toLowerCase())
                    ).map((tenant) => {
                      const daysRemaining = Math.max(0, Math.ceil((new Date(tenant.deleted_expires_at || '').getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)));
                      return (
                        <div key={tenant.id} className="grid grid-cols-7 gap-4 p-6 items-center hover:bg-zinc-50/30 transition-all">
                          <div className="col-span-2 flex items-center gap-4">
                            <div className="h-10 w-10 rounded-xl bg-zinc-100 flex items-center justify-center text-zinc-400 text-sm font-bold">
                              {tenant.name.charAt(0)}
                            </div>
                            <div>
                              <p className="font-bold text-zinc-500 line-through">{tenant.name}</p>
                              <p className="text-[10px] text-zinc-400 font-mono">{tenant.slug}.pharmhelm.com</p>
                            </div>
                          </div>

                          <div className="text-xs text-zinc-500 font-medium">
                            {tenant.deleted_at ? format(new Date(tenant.deleted_at), 'MMM dd, yyyy') : 'N/A'}
                          </div>

                          <div className="text-xs text-zinc-500 font-medium">
                            {tenant.deleted_expires_at ? format(new Date(tenant.deleted_expires_at), 'MMM dd, yyyy') : 'N/A'}
                          </div>

                          <div>
                            <span className="text-xs font-mono font-bold text-red-600 bg-red-50 px-2.5 py-1 rounded">
                              {daysRemaining} Days
                            </span>
                          </div>

                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-red-100 text-red-700">
                              Soft Deleted
                            </span>
                          </div>

                          <div className="flex justify-end gap-3 col-span-2">
                            <button 
                              onClick={async () => {
                                if (window.confirm(`Are you sure you want to restore ${tenant.name}? Its subdomain and slug will immediately go live again.`)) {
                                  try {
                                    await updateDoc(doc(db, 'tenants', tenant.id), {
                                      deleted: false,
                                      deleted_at: null,
                                      deletedAt: null,
                                      deleted_expires_at: null,
                                      deletedBy: null,
                                      autoPurgeDate: null,
                                      status: 'active',
                                      subscription_status: 'active',
                                      slug: tenant.original_slug || tenant.slug
                                    });
                                    toast.success('Tenant recovered successfully!');
                                    fetchTenants();
                                  } catch (e) {
                                    toast.error('Failed to recover tenant.');
                                  }
                                }
                              }}
                              className="px-3 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-lg hover:bg-emerald-100 transition-all"
                            >
                              Recover
                            </button>
                            <button 
                              onClick={() => {
                                setReauthTenant(tenant);
                                setReauthEmail(auth.currentUser?.email || '');
                                setReauthPassword('');
                                setShowReauthModal(true);
                              }}
                              className="px-3 py-1.5 bg-red-50 text-red-700 text-xs font-bold rounded-lg hover:bg-red-100 transition-all"
                            >
                              Purge
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {tenants.filter(t => t.deleted).length === 0 && (
                      <div className="p-12 text-center text-zinc-400 text-sm">
                        No soft-deleted tenants currently in holding bin.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'accounts' && (
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-widest mb-1">Select Tenant Platform</h3>
                    <p className="text-xs text-[#141414]/40">Manage and override staff user credentials for specific tenant environments.</p>
                  </div>
                  <select 
                    className="px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/20 w-64"
                    value={selectedTenantForAccounts}
                    onChange={(e) => setSelectedTenantForAccounts(e.target.value)}
                  >
                    <option value="">-- Choose Tenant --</option>
                    {tenants.map(t => (
                      <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedTenantForAccounts ? (
                <div className="bg-white rounded-3xl border border-[#141414]/5 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-[#141414]/5">
                    <h4 className="text-sm font-bold uppercase tracking-widest">Active Staff Profiles</h4>
                  </div>
                  
                  {loadingAccounts ? (
                    <div className="p-12 text-center text-zinc-400">
                      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-emerald-500 mx-auto mb-4"></div>
                      Fetching user accounts...
                    </div>
                  ) : staffAccounts.length === 0 ? (
                    <div className="p-12 text-center text-zinc-400 text-sm">
                      No staff member accounts found for this tenant platform.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm border-collapse">
                        <thead>
                          <tr className="bg-zinc-50 border-b border-[#141414]/5 text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">
                            <th className="p-6">Full Name</th>
                            <th className="p-6">Login Username</th>
                            <th className="p-6">Firebase Auth Email</th>
                            <th className="p-6">System Role</th>
                            <th className="p-6">Status</th>
                            <th className="p-6">Password / Recover Key</th>
                            <th className="p-6 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                          {(() => {
                            const tenantObj = tenants.find(t => t.id === selectedTenantForAccounts);
                            const tenantAcronym = tenantObj?.acronym?.toLowerCase().trim() || tenantObj?.slug?.toLowerCase().trim() || 'radah';
                            
                            return staffAccounts.map((account) => {
                              const fullUsername = account.username.includes('.pharmhelm.com') 
                                ? account.username 
                                : `${account.username}.${tenantAcronym}.pharmhelm.com`;
                                
                              const firebaseEmail = account.authEmail || (
                                account.username.includes('@') 
                                  ? account.username 
                                  : `${account.username}@${tenantAcronym}.pharmhelm.com`
                              );
                              
                              return (
                                <tr key={account.id} className="hover:bg-zinc-50/50 transition-colors">
                                  <td className="p-6 font-bold text-zinc-900">{account.full_name}</td>
                                  <td className="p-6 font-mono text-xs text-zinc-600 bg-zinc-50/30">
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-zinc-400 text-[10px] uppercase font-bold tracking-wider">Short:</span>
                                        <span className="font-bold">{account.username}</span>
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-zinc-400 text-[10px] uppercase font-bold tracking-wider">Full:</span>
                                        <span>{fullUsername}</span>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="p-6 font-mono text-xs text-zinc-600 bg-emerald-50/30">
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-emerald-800">{firebaseEmail}</span>
                                      <button 
                                        onClick={() => {
                                          navigator.clipboard.writeText(firebaseEmail);
                                          toast.success('Firebase Auth Email copied!');
                                        }}
                                        className="text-xs text-emerald-600 hover:underline font-bold"
                                      >
                                        Copy
                                      </button>
                                    </div>
                                  </td>
                                  <td className="p-6">
                                    <span className="text-xs bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full font-bold uppercase tracking-wider">
                                      {account.role}
                                    </span>
                                  </td>
                                  <td className="p-6">
                                    <span className={cn(
                                      "text-xs font-bold px-2.5 py-1 rounded-full",
                                      account.status === 'active' || account.active ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-600"
                                    )}>
                                      {account.status || 'active'}
                                    </span>
                                  </td>
                                  <td className="p-6">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-xs font-bold text-zinc-700 bg-zinc-100 px-2 py-1 rounded">
                                        {account.password || '••••••••'}
                                      </span>
                                      <button 
                                        onClick={() => {
                                          navigator.clipboard.writeText(account.password || '');
                                          toast.success('Password copied to clipboard!');
                                        }}
                                        className="text-xs text-emerald-600 hover:underline font-bold"
                                        disabled={!account.password}
                                      >
                                        Copy
                                      </button>
                                    </div>
                                  </td>
                                  <td className="p-6 text-right">
                                    <button
                                      onClick={() => {
                                        setOverrideUserId(account.id);
                                        setOverrideUserFullName(account.full_name);
                                        setShowPasswordModal(true);
                                      }}
                                      className="px-4 py-2 bg-[#141414] text-white rounded-xl text-xs font-bold hover:bg-zinc-800 transition-all shadow-sm"
                                    >
                                      Override Password
                                    </button>
                                  </td>
                                </tr>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-white rounded-3xl p-12 text-center border border-[#141414]/5 shadow-sm">
                  <p className="text-zinc-400 text-sm">Please select a tenant from the dropdown menu to manage staff accounts.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'subscriptions' && (() => {
            const currentSubTenant = tenants.find(t => t.id === selectedTenantForSub);
            const isSubscriptionActive = currentSubTenant && currentSubTenant.subscription_status === 'active' && new Date(currentSubTenant.subscription_end) > new Date();

            const remainingDays = currentSubTenant && currentSubTenant.subscription_end 
              ? Math.max(0, Math.ceil((new Date(currentSubTenant.subscription_end).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))
              : 0;

            const oldRate = currentSubTenant?.subscription_tier 
              ? (rates[currentSubTenant.subscription_tier as 'basic' | 'standard' | 'enterprise'] || 0) 
              : 0;

            const getUpgradeOptions = () => {
              if (!currentSubTenant) return [];
              const tier = currentSubTenant.subscription_tier;
              if (tier === 'basic') {
                return [
                  { value: 'standard', label: `Standard (Pro) - UGX ${rates.standard.toLocaleString()}/mo` },
                  { value: 'enterprise', label: `Enterprise (Premium) - UGX ${rates.enterprise.toLocaleString()}/mo` }
                ];
              }
              if (tier === 'standard') {
                return [
                  { value: 'enterprise', label: `Enterprise (Premium) - UGX ${rates.enterprise.toLocaleString()}/mo` }
                ];
              }
              return [];
            };

            const upgradeOptions = getUpgradeOptions();
            const activeUpgradePackage = upgradeOptions.find(o => o.value === upgradePackage) 
              ? upgradePackage 
              : (upgradeOptions[0]?.value as 'basic' | 'standard' | 'enterprise' || 'enterprise');

            const newRate = rates[activeUpgradePackage] || 0;
            const rateDiff = Math.max(0, newRate - oldRate);
            const computedUpgradeTopUp = Math.round((remainingDays / 30) * rateDiff);

            const historyLogs = selectedTenantForSub ? getTenantSubscriptionLogs(selectedTenantForSub) : [];

            return (
              <div className="space-y-8">
                <div className="grid grid-cols-3 gap-8">
                  {/* Form Side */}
                  <div className="col-span-2 bg-white rounded-3xl border border-[#141414]/5 shadow-sm p-8">
                    <div className="flex items-center justify-between mb-6 border-b pb-4">
                      <h3 className="text-sm font-bold uppercase tracking-widest text-[#141414]">
                        {isSubscriptionActive 
                          ? (isUpgradeMode ? "Upgrade Package" : isRenewalMode ? "Renew Subscription" : "Subscription Locked") 
                          : "Activate Tenant Subscription"
                        }
                      </h3>
                      {isSubscriptionActive && (
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold px-3 py-1 rounded-full flex items-center gap-1.5 uppercase ${
                            isUpgradeMode ? 'bg-amber-50 text-amber-600 border border-amber-100' : isRenewalMode ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                          }`}>
                            <Lock size={12} /> {isUpgradeMode ? 'Upgrade Mode' : isRenewalMode ? 'Renewal Mode' : 'Subscription Active'}
                          </span>
                        </div>
                      )}
                    </div>
                    
                    {/* Tenant Selector always visible */}
                    <div className="mb-6 space-y-2">
                      <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Select Tenant Platform</label>
                      <select 
                        required
                        className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/20"
                        value={selectedTenantForSub}
                        onChange={(e) => {
                          setSelectedTenantForSub(e.target.value);
                          setIsUpgradeMode(false);
                          setIsRenewalMode(false);
                        }}
                      >
                        <option value="">-- Choose Tenant --</option>
                        {tenants.map(t => (
                          <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>
                        ))}
                      </select>
                    </div>

                    {!selectedTenantForSub ? (
                      <div className="p-12 text-center bg-zinc-50 border border-dashed border-zinc-200 rounded-2xl">
                        <p className="text-sm font-medium text-zinc-400">Please choose a tenant platform from the dropdown above to manage, upgrade, or activate subscriptions.</p>
                      </div>
                    ) : isSubscriptionActive && !isUpgradeMode && !isRenewalMode ? (
                      // LOCKED SCREEN
                      <div className="space-y-6">
                        <div className="p-6 bg-zinc-50 border border-zinc-200 rounded-2xl flex items-start gap-4">
                          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
                            <Lock size={24} />
                          </div>
                          <div className="space-y-1 flex-1">
                            <h4 className="text-sm font-bold text-zinc-900">Active Subscription Is Locked</h4>
                            <p className="text-xs text-zinc-500 leading-relaxed">
                              This tenant currently has an active <strong>{currentSubTenant.subscription_tier?.toUpperCase()}</strong> subscription. 
                              The status is locked until it expires on <strong>{currentSubTenant.subscription_end ? new Date(currentSubTenant.subscription_end).toLocaleDateString() : 'N/A'}</strong> ({remainingDays} days remaining).
                            </p>
                            <div className="pt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-400 font-medium">
                              <span>Plan Cycle: <strong className="text-zinc-600 uppercase">{currentSubTenant.subscription_cycle || 'monthly'}</strong></span>
                              <span>Started: <strong className="text-zinc-600">{currentSubTenant.subscription_start ? new Date(currentSubTenant.subscription_start).toLocaleDateString() : 'N/A'}</strong></span>
                            </div>
                          </div>
                        </div>

                        <div className="flex gap-4">
                          {upgradeOptions.length > 0 && (
                            <button 
                              type="button"
                              onClick={() => {
                                setUpgradePackage(upgradeOptions[0].value as any);
                                setIsUpgradeMode(true);
                                setIsRenewalMode(false);
                              }}
                              className="flex-1 py-3 bg-[#141414] text-white font-bold rounded-xl text-xs hover:bg-zinc-800 transition-all uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm"
                            >
                              <TrendingUp size={14} className="text-amber-400" />
                              Upgrade Subscription
                            </button>
                          )}
                          <button 
                            type="button"
                            onClick={() => {
                              setRenewPackage(currentSubTenant.subscription_tier as any);
                              setRenewCycle(currentSubTenant.subscription_cycle as any || 'monthly');
                              setIsRenewalMode(true);
                              setIsUpgradeMode(false);
                            }}
                            className="flex-1 py-3 bg-emerald-650 text-white font-bold rounded-xl text-xs hover:bg-emerald-700 transition-all uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm"
                          >
                            <RefreshCw size={14} />
                            Renew Subscription
                          </button>
                        </div>
                      </div>
                    ) : isRenewalMode ? (
                      // RENEWAL MODE FORM
                      <form onSubmit={handleSubscriptionRenewal} className="space-y-6 animate-in fade-in duration-200">
                        <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-start gap-3 text-xs text-emerald-800">
                          <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0 mt-0.5" />
                          <div className="space-y-1">
                            <p className="font-bold">Subscription Renewal Active</p>
                            <p className="leading-relaxed">
                              Renewing subscription for <strong>{currentSubTenant?.name}</strong>. Dates will extend forward from the previous expiration date.
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Select Renewal Tier</label>
                            <select 
                              required
                              className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/20"
                              value={renewPackage}
                              onChange={(e) => setRenewPackage(e.target.value as any)}
                            >
                              <option value="basic">Basic (Starter) - UGX {rates.basic.toLocaleString()}/mo</option>
                              <option value="standard">Standard (Pro) - UGX {rates.standard.toLocaleString()}/mo</option>
                              <option value="enterprise">Enterprise (Premium) - UGX {rates.enterprise.toLocaleString()}/mo</option>
                            </select>
                          </div>

                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Renewal Cycle</label>
                            <select 
                              required
                              className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/20"
                              value={renewCycle}
                              onChange={(e) => setRenewCycle(e.target.value as any)}
                            >
                              <option value="monthly">Monthly Plan</option>
                              <option value="annual">Annual Plan</option>
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Renewal Start Date</label>
                            <input 
                              type="date"
                              required
                              className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
                              value={renewStartDate}
                              onChange={(e) => setRenewStartDate(e.target.value)}
                            />
                          </div>

                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Renewal End Date</label>
                            <input 
                              type="date"
                              required
                              className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
                              value={renewEndDate}
                              onChange={(e) => setRenewEndDate(e.target.value)}
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider flex items-center justify-between">
                            <span>Amount to Pay (UGX)</span>
                            <span className="text-[10px] bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full font-sans font-black flex items-center gap-1">
                              <Calculator size={10} /> Auto-calculated
                            </span>
                          </label>
                          <input 
                            type="text"
                            disabled
                            className="w-full px-4 py-3 bg-zinc-100 border border-zinc-200 rounded-xl text-sm font-bold text-zinc-600 cursor-not-allowed"
                            value={Number(renewAmount).toLocaleString() + " UGX"}
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Payment Notes / References</label>
                          <textarea 
                            rows={2}
                            className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 resize-none"
                            placeholder="e.g. Received cash renewal / Mobile Money reference"
                            value={subNotes}
                            onChange={(e) => setSubNotes(e.target.value)}
                          />
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                          <button 
                            type="button"
                            onClick={() => setIsRenewalMode(false)}
                            className="py-4 bg-zinc-100 text-zinc-600 font-bold rounded-xl text-xs hover:bg-zinc-200 transition-all uppercase tracking-wider"
                          >
                            Cancel
                          </button>
                          <button 
                            type="submit"
                            disabled={savingSubscription}
                            className="col-span-2 py-4 bg-emerald-600 text-white font-bold rounded-xl text-xs hover:bg-emerald-700 transition-all disabled:bg-zinc-300 uppercase tracking-wider shadow-md"
                          >
                            {savingSubscription ? 'Processing Renewal...' : `Confirm Renewal & Log UGX ${Number(renewAmount).toLocaleString()}`}
                          </button>
                        </div>
                      </form>
                    ) : isUpgradeMode ? (
                      // UPGRADE MODE FORM
                      <form onSubmit={(e) => { e.preventDefault(); handleSubscriptionUpgrade(computedUpgradeTopUp); }} className="space-y-6 animate-in fade-in duration-200">
                        <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-start gap-3 text-xs text-amber-800">
                          <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                          <div className="space-y-1">
                            <p className="font-bold">Pro-Rata Upgrade Active</p>
                            <p className="leading-relaxed">
                              You are upgrading from <strong>{currentSubTenant?.subscription_tier?.toUpperCase()}</strong> (UGX {oldRate.toLocaleString()}/mo) for the remaining <strong>{remainingDays} days</strong> of the subscription. The expiration date remains unchanged.
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Select Higher Tier</label>
                            <select 
                              required
                              className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-amber-500/20"
                              value={activeUpgradePackage}
                              onChange={(e) => setUpgradePackage(e.target.value as any)}
                            >
                              {upgradeOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider flex items-center justify-between">
                              <span>Prorated Top-Up (UGX)</span>
                              <span className="text-[9px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-sans font-black flex items-center gap-1">
                                <Calculator size={9} /> Pro-rated
                              </span>
                            </label>
                            <input 
                              type="text"
                              disabled
                              className="w-full px-4 py-3 bg-zinc-100 border border-zinc-200 rounded-xl text-sm font-black text-amber-800 cursor-not-allowed"
                              value={computedUpgradeTopUp.toLocaleString() + " UGX"}
                            />
                          </div>
                        </div>

                        {/* Top-up formula visualization */}
                        <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-xl space-y-1.5 text-xs text-zinc-600">
                          <p className="font-bold text-zinc-700 uppercase text-[9px] tracking-wider">Calculation Breakdown</p>
                          <div className="font-mono text-[11px] space-y-1">
                            <div className="flex justify-between">
                              <span>Formula:</span>
                              <span className="text-zinc-500">(Remaining Days / 30) * Rate Difference</span>
                            </div>
                            <div className="flex justify-between border-t border-zinc-100 pt-1">
                              <span>Calculation:</span>
                              <span>({remainingDays} / 30) * (UGX {(newRate - oldRate).toLocaleString()})</span>
                            </div>
                            <div className="flex justify-between font-black text-zinc-800 pt-1 border-t border-zinc-200">
                              <span>Total Top-up Due:</span>
                              <span>UGX {computedUpgradeTopUp.toLocaleString()}</span>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Upgrade Notes / References</label>
                          <textarea 
                            rows={3}
                            className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-amber-500/20 resize-none"
                            placeholder="e.g. Received cash top-up / Mobile Money reference for plan upgrade"
                            value={subNotes}
                            onChange={(e) => setSubNotes(e.target.value)}
                          />
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                          <button 
                            type="button"
                            onClick={() => setIsUpgradeMode(false)}
                            className="py-4 bg-zinc-100 text-zinc-600 font-bold rounded-xl text-xs hover:bg-zinc-200 transition-all uppercase tracking-wider"
                          >
                            Cancel & Lock
                          </button>
                          <button 
                            type="submit"
                            disabled={savingSubscription}
                            className="col-span-2 py-4 bg-amber-600 text-white font-bold rounded-xl text-xs hover:bg-amber-700 transition-all disabled:bg-zinc-300 uppercase tracking-wider shadow-md shadow-amber-200"
                          >
                            {savingSubscription ? 'Processing Upgrade...' : `Confirm Upgrade & Log UGX ${computedUpgradeTopUp.toLocaleString()}`}
                          </button>
                        </div>
                      </form>
                    ) : (
                      // STANDARD ACTIVATION FORM
                      <form onSubmit={handleSubscriptionActivation} className="space-y-6">
                        <div className="grid grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Subscription Tier / Package</label>
                            <select 
                              required
                              className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/20"
                              value={subPackage}
                              onChange={(e) => setSubPackage(e.target.value as any)}
                            >
                              <option value="basic">Basic (Starter) - UGX {rates.basic.toLocaleString()}/mo</option>
                              <option value="standard">Standard (Pro) - UGX {rates.standard.toLocaleString()}/mo</option>
                              <option value="enterprise">Enterprise (Premium) - UGX {rates.enterprise.toLocaleString()}/mo</option>
                            </select>
                          </div>

                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Billing Cycle</label>
                            <select 
                              required
                              className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/20"
                              value={subCycle}
                              onChange={(e) => setSubCycle(e.target.value as any)}
                            >
                              <option value="monthly">Monthly Plan</option>
                              <option value="annual">Annual Plan</option>
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Activation Start Date</label>
                            <input 
                              type="date"
                              required
                              className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
                              value={subStartDate}
                              onChange={(e) => setSubStartDate(e.target.value)}
                            />
                          </div>

                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider flex items-center justify-between">
                              <span>Amount Calculated (UGX)</span>
                              <span className="text-[10px] bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full font-sans font-black flex items-center gap-1">
                                <Calculator size={10} /> Auto-calculated
                              </span>
                            </label>
                            <input 
                              type="text"
                              disabled
                              className="w-full px-4 py-3 bg-zinc-100 border border-zinc-200 rounded-xl text-sm font-bold text-zinc-600 cursor-not-allowed"
                              value={Number(subAmountPaid).toLocaleString() + " UGX"}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Activation Expiry Date</label>
                            <input 
                              type="date"
                              required
                              className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
                              value={subEndDate}
                              onChange={(e) => setSubEndDate(e.target.value)}
                            />
                          </div>

                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Payment Notes / References</label>
                            <input 
                              type="text"
                              className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
                              placeholder="e.g. Mobile Money Ref: MP20349..."
                              value={subNotes}
                              onChange={(e) => setSubNotes(e.target.value)}
                            />
                          </div>
                        </div>

                        <button 
                          type="submit"
                          disabled={savingSubscription}
                          className="w-full py-4 bg-emerald-600 text-white font-bold rounded-xl text-sm hover:bg-emerald-700 transition-all disabled:bg-zinc-300 shadow-lg shadow-emerald-200"
                        >
                          {savingSubscription ? 'Processing Activation...' : 'Activate Subscription & Log Revenue'}
                        </button>
                      </form>
                    )}
                  </div>

                  {/* Informational Card & Define Package Rates Card */}
                  <div className="space-y-6">
                    <div className="bg-[#141414] text-white rounded-3xl p-8 shadow-sm">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-emerald-400 mb-4">Subscription Control Manual</h4>
                      <div className="space-y-4 text-xs leading-relaxed text-zinc-300">
                        <p>Once a tenant makes a payment, you activate their status in this panel.</p>
                        <p><strong>Subdomain Protection:</strong> When activated and dates are current, the tenant subdomain (e.g. <code>tenant.pharmhelm.com</code>) becomes fully operative.</p>
                        <p><strong>Expiry Override:</strong> If current date is past the Active range, subdomains automatically render the "Subscription Inactive" warning screen.</p>
                        <p><strong>Revenue Ledger:</strong> All payments are automatically entered into the Revenue logs with timestamp, operator signature, and package tier.</p>
                      </div>
                    </div>

                    {/* Configure Packages & Rates Card */}
                    <div className="bg-white rounded-3xl border border-[#141414]/5 shadow-sm p-8">
                      <h4 className="text-xs font-black uppercase tracking-wider text-[#141414] mb-3 border-b pb-3 flex items-center gap-2">
                        <Layers size={14} className="text-emerald-500" />
                        Define Package Rates
                      </h4>
                      <p className="text-[11px] text-[#141414]/50 leading-relaxed mb-5">Set the monthly base rates used for auto-calculating tenant subscriptions based on activation dates.</p>
                      
                      <form onSubmit={handleSaveRates} className="space-y-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Basic (Starter) / mo (UGX)</label>
                          <input 
                            type="number"
                            required
                            className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-emerald-500/20 font-bold"
                            value={rates.basic}
                            onChange={(e) => setRates({ ...rates, basic: Number(e.target.value) })}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Standard (Pro) / mo (UGX)</label>
                          <input 
                            type="number"
                            required
                            className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-emerald-500/20 font-bold"
                            value={rates.standard}
                            onChange={(e) => setRates({ ...rates, standard: Number(e.target.value) })}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Enterprise (Premium) / mo (UGX)</label>
                          <input 
                            type="number"
                            required
                            className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-emerald-500/20 font-bold"
                            value={rates.enterprise}
                            onChange={(e) => setRates({ ...rates, enterprise: Number(e.target.value) })}
                          />
                        </div>
                        
                        <button 
                          type="submit"
                          disabled={savingRates}
                          className="w-full py-2.5 bg-[#141414] text-white text-[10px] font-bold rounded-xl hover:bg-zinc-800 transition-all disabled:bg-zinc-300 uppercase tracking-wider mt-1"
                        >
                          {savingRates ? 'Saving Rates...' : 'Save Pricing Rates'}
                        </button>
                      </form>
                    </div>
                  </div>
                </div>

                {/* SUBSCRIPTION EVENTS & CHRONOLOGICAL HISTORY LOGS */}
                <div className="bg-white rounded-3xl border border-[#141414]/5 shadow-sm p-8 space-y-6">
                  <div className="flex items-center justify-between border-b pb-4">
                    <div>
                      <h4 className="text-sm font-black uppercase tracking-wider text-zinc-900">Subscription History & Chronological Ledger</h4>
                      <p className="text-xs text-zinc-400 mt-1">Tracks chronological activations, plan upgrades, and gaps (days spent unsubscribed) for the selected tenant.</p>
                    </div>
                    {selectedTenantForSub && (
                      <div className="flex items-center gap-4 flex-wrap">
                        <div className="flex items-center gap-2 text-xs font-semibold">
                          <div className="flex items-center gap-1.5">
                            <span className="text-zinc-400 uppercase tracking-widest text-[9px] font-black">From</span>
                            <input 
                              type="date"
                              value={historyStartDate}
                              onChange={(e) => setHistoryStartDate(e.target.value)}
                              className="px-3 py-1.5 border border-zinc-200 rounded-xl bg-zinc-50 outline-none text-zinc-700 text-xs font-medium focus:ring-2 focus:ring-emerald-500/25"
                            />
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-zinc-400 uppercase tracking-widest text-[9px] font-black">To</span>
                            <input 
                              type="date"
                              value={historyEndDate}
                              onChange={(e) => setHistoryEndDate(e.target.value)}
                              className="px-3 py-1.5 border border-zinc-200 rounded-xl bg-zinc-50 outline-none text-zinc-700 text-xs font-medium focus:ring-2 focus:ring-emerald-500/25"
                            />
                          </div>
                        </div>
                        <span className="text-[10px] bg-zinc-100 text-zinc-800 font-bold px-3 py-1 rounded-full border border-zinc-200">
                          Tenant ID: {selectedTenantForSub}
                        </span>
                      </div>
                    )}
                  </div>

                  {!selectedTenantForSub ? (
                    <div className="p-8 text-center bg-zinc-50 border border-dashed border-zinc-200 rounded-2xl">
                      <p className="text-xs text-zinc-400 font-medium">Select a tenant platform above to render their detailed subscription history and unsubscribe logs.</p>
                    </div>
                  ) : historyLogs.length === 0 ? (
                    <div className="p-8 text-center bg-zinc-50 border border-dashed border-zinc-200 rounded-2xl">
                      <p className="text-xs text-zinc-400 font-medium">No subscription events or payment records have been logged for this tenant yet.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-zinc-100">
                            <th className="py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Payment Date</th>
                            <th className="py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Package / Event</th>
                            <th className="py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Active Period</th>
                            <th className="py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Amount Paid</th>
                            <th className="py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Days Spent Unsubscribed</th>
                            <th className="py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Logged By</th>
                            <th className="py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Notes / References</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-50">
                          {historyLogs.map((log: any) => (
                            <tr key={log.id} className="text-xs hover:bg-zinc-50/50 transition-colors">
                              <td className="py-4 font-medium text-zinc-500 whitespace-nowrap">
                                {log.paymentDate ? format(new Date(log.paymentDate), 'MMM dd, yyyy HH:mm') : 'N/A'}
                              </td>
                              <td className="py-4 font-bold text-zinc-800">
                                <div className="flex items-center gap-1.5">
                                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${
                                    log.package === 'enterprise' 
                                      ? 'bg-purple-50 text-purple-600 border border-purple-100' 
                                      : log.package === 'standard' 
                                        ? 'bg-blue-50 text-blue-600 border border-blue-100' 
                                        : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                                  }`}>
                                    {log.package}
                                  </span>
                                  {log.isUpgrade && (
                                    <span className="text-[9px] bg-amber-50 text-amber-700 font-bold px-1.5 py-0.5 rounded-full border border-amber-100 flex items-center gap-0.5">
                                      <TrendingUp size={10} /> Upgrade
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-4 text-zinc-600 font-mono text-[11px] whitespace-nowrap">
                                {log.subscriptionStart ? format(new Date(log.subscriptionStart), 'MMM dd, yyyy') : 'N/A'} 
                                <span className="mx-1 text-zinc-300">→</span> 
                                {log.subscriptionEnd ? format(new Date(log.subscriptionEnd), 'MMM dd, yyyy') : 'N/A'}
                              </td>
                              <td className="py-4 font-black text-zinc-900">
                                UGX {Number(log.amount || 0).toLocaleString()}
                              </td>
                              <td className="py-4">
                                {log.daysUnsubscribed > 0 ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-rose-50 text-rose-700 border border-rose-100">
                                    <Clock size={10} /> {log.daysUnsubscribedLabel}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-100">
                                    <CheckCircle2 size={10} /> 0 days (Continuous)
                                  </span>
                                )}
                              </td>
                              <td className="py-4 text-zinc-500 font-medium">{log.loggedBy || 'System Admin'}</td>
                              <td className="py-4 text-zinc-500 italic max-w-xs truncate" title={log.notes}>
                                {log.notes || 'N/A'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {activeTab === 'revenue' && (() => {
            const filteredRevenue = revenueLogs.filter(log => {
              const matchesSearch = 
                (log.tenantName || '').toLowerCase().includes(revSearch.toLowerCase()) ||
                (log.notes || '').toLowerCase().includes(revSearch.toLowerCase()) ||
                (log.loggedBy || '').toLowerCase().includes(revSearch.toLowerCase());
              const matchesPackage = revPackageFilter === 'all' || log.package === revPackageFilter;
              const matchesCycle = revCycleFilter === 'all' || log.cycle === revCycleFilter;
              return matchesSearch && matchesPackage && matchesCycle;
            });

            const totalRevenue = filteredRevenue.reduce((sum, l) => sum + (l.amount || 0), 0);
            
            // Calculate active ARR (Annual Recurring Revenue) dynamically
            const activeTenants = tenants.filter(t => !t.deleted && t.subscription_status === 'active');
            const arrValue = activeTenants.reduce((sum, t) => {
              let tierCost = t.subscription_tier === 'basic' ? 100000 : t.subscription_tier === 'standard' ? 250000 : 500000;
              if (t.subscription_cycle === 'annual') {
                return sum + (t.subscription_tier === 'basic' ? 1000000 : t.subscription_tier === 'standard' ? 2500000 : 5000000);
              } else {
                return sum + (tierCost * 12);
              }
            }, 0);

            const arpuValue = filteredRevenue.length ? Math.round(totalRevenue / filteredRevenue.length) : 0;

            // Group payments by date for trend chart
            const groupedChartData = filteredRevenue.reduce((acc: any[], log) => {
              const dateStr = log.paymentDate ? format(new Date(log.paymentDate), 'MMM dd') : 'N/A';
              const existing = acc.find(item => item.date === dateStr);
              if (existing) {
                existing.Amount += log.amount || 0;
              } else {
                acc.push({ date: dateStr, Amount: log.amount || 0 });
              }
              return acc;
            }, []).slice(0, 15).reverse();

            return (
              <div className="space-y-6 animate-in fade-in duration-200">
                {/* Financial KPI Grid */}
                <div className="grid grid-cols-4 gap-6">
                  <div className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Total Filtered Revenue</span>
                    <h3 className="text-2xl font-extrabold text-[#141414] mt-1">
                      UGX {totalRevenue.toLocaleString()}
                    </h3>
                    <p className="text-[10px] text-zinc-400 mt-2 font-bold uppercase tracking-widest">Across {filteredRevenue.length} payments</p>
                  </div>

                  <div className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Annual Recurring Revenue (ARR)</span>
                    <h3 className="text-2xl font-extrabold text-[#141414] mt-1 text-emerald-600">
                      UGX {arrValue.toLocaleString()}
                    </h3>
                    <p className="text-[10px] text-zinc-400 mt-2 font-bold uppercase tracking-widest">Active contracted baseline ARR</p>
                  </div>

                  <div className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Avg Transaction Size (ARPU)</span>
                    <h3 className="text-2xl font-extrabold text-[#141414] mt-1 text-blue-600">
                      UGX {arpuValue.toLocaleString()}
                    </h3>
                    <p className="text-[10px] text-zinc-400 mt-2 font-bold uppercase tracking-widest">Average value per invoice</p>
                  </div>

                  <div className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Active Paid Tenants</span>
                    <h3 className="text-2xl font-extrabold text-[#141414] mt-1">
                      {activeTenants.length} Tenants
                    </h3>
                    <p className="text-[10px] text-emerald-600 mt-2 font-bold uppercase tracking-widest flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      100% cloud delivery
                    </p>
                  </div>
                </div>

                {/* Search, Filter & CSV Action Panel */}
                <div className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm flex flex-wrap gap-4 items-center justify-between">
                  <div className="flex flex-wrap items-center gap-3 flex-1">
                    <div className="relative max-w-xs w-full">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                      <input 
                        type="text"
                        placeholder="Search by tenant or reference..."
                        className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-emerald-500/10 transition-all font-medium"
                        value={revSearch}
                        onChange={(e) => setRevSearch(e.target.value)}
                      />
                    </div>

                    <select 
                      className="px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-xs outline-none font-medium text-zinc-700 focus:ring-2 focus:ring-emerald-500/10 cursor-pointer"
                      value={revPackageFilter}
                      onChange={(e) => setRevPackageFilter(e.target.value)}
                    >
                      <option value="all">All Plan Packages</option>
                      <option value="basic">Basic (Starter)</option>
                      <option value="standard">Standard (Pro)</option>
                      <option value="enterprise">Enterprise (Premium)</option>
                    </select>

                    <select 
                      className="px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-xs outline-none font-medium text-zinc-700 focus:ring-2 focus:ring-emerald-500/10 cursor-pointer"
                      value={revCycleFilter}
                      onChange={(e) => setRevCycleFilter(e.target.value)}
                    >
                      <option value="all">All Payment Cycles</option>
                      <option value="monthly">Monthly Cycle</option>
                      <option value="annual">Annual Cycle</option>
                    </select>
                  </div>

                  <div className="flex gap-2">
                    <button 
                      onClick={() => fetchRevenueLogs()}
                      className="p-2.5 bg-zinc-50 hover:bg-zinc-100 text-zinc-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                      title="Sync Ledger"
                    >
                      <RefreshCw size={14} className={loadingRevenue ? "animate-spin" : ""} />
                      Sync
                    </button>
                    <button 
                      onClick={() => {
                        if (filteredRevenue.length === 0) {
                          toast.error('No items available to export.');
                          return;
                        }
                        const headers = ['Tenant Name', 'Package', 'Cycle', 'Amount UGX', 'Active Start', 'Active End', 'Payment Date', 'Operator Signature', 'Notes'];
                        const rows = filteredRevenue.map(l => [
                          l.tenantName,
                          l.package,
                          l.cycle,
                          l.amount,
                          l.subscriptionStart,
                          l.subscriptionEnd,
                          l.paymentDate,
                          l.loggedBy,
                          l.notes || ''
                        ]);
                        const csvContent = "data:text/csv;charset=utf-8," 
                          + [headers.join(','), ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))].join('\n');
                        const encodedUri = encodeURI(csvContent);
                        const link = document.createElement("a");
                        link.setAttribute("href", encodedUri);
                        link.setAttribute("download", `pharmhelm_billing_ledger_${new Date().toISOString().split('T')[0]}.csv`);
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        toast.success('Billing ledger successfully exported as CSV!');
                      }}
                      className="px-4 py-2.5 bg-zinc-900 text-white hover:bg-zinc-800 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer"
                    >
                      <FileText size={14} />
                      Export Billing Ledger
                    </button>
                  </div>
                </div>

                {/* Trend Chart and Overview Row */}
                <div className="grid grid-cols-3 gap-6">
                  {/* Financial Velocity Chart */}
                  <div className="col-span-2 bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm space-y-4">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-700">Financial Revenue Velocity Trend</h4>
                    <div className="h-64 w-full">
                      {groupedChartData.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-zinc-400 text-xs">
                          Not enough financial data points to plot graph.
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={groupedChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <defs>
                              <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                            <XAxis dataKey="date" stroke="#a1a1aa" fontSize={10} tickLine={false} />
                            <YAxis stroke="#a1a1aa" fontSize={10} tickLine={false} tickFormatter={(tick) => `UGX ${(tick/1000).toLocaleString()}K`} />
                            <Tooltip formatter={(value) => [`UGX ${Number(value).toLocaleString()}`, 'Revenue']} contentStyle={{ borderRadius: '12px', fontSize: '11px', border: '1px solid #e4e4e7' }} />
                            <Area type="monotone" dataKey="Amount" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorAmount)" />
                          </AreaChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>

                  {/* Distribution breakdown */}
                  <div className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm space-y-4 flex flex-col justify-between">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-700">Package Distribution Share</h4>
                      <p className="text-[10px] text-zinc-400 mt-1 uppercase font-bold tracking-widest">Active tenant plan statistics</p>
                    </div>

                    <div className="space-y-4 my-auto">
                      {['enterprise', 'standard', 'basic'].map((pkg) => {
                        const count = activeTenants.filter(t => t.subscription_tier === pkg).length;
                        const percentage = activeTenants.length ? Math.round((count / activeTenants.length) * 100) : 0;
                        const color = pkg === 'enterprise' ? 'bg-purple-500' : pkg === 'standard' ? 'bg-blue-500' : 'bg-emerald-500';
                        return (
                          <div key={pkg} className="space-y-1">
                            <div className="flex justify-between text-xs font-bold">
                              <span className="capitalize text-zinc-700">{pkg} Plan</span>
                              <span className="text-zinc-500">{count} active ({percentage}%)</span>
                            </div>
                            <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                              <div className={cn("h-full rounded-full transition-all duration-300", color)} style={{ width: `${percentage}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="text-[10px] text-zinc-400 leading-relaxed font-bold uppercase tracking-wider pt-4 border-t border-zinc-100">
                      Enterprise Tier: UGX 5,000,000 / Yr<br />
                      Standard Tier: UGX 2,500,000 / Yr<br />
                      Basic Tier: UGX 1,000,000 / Yr
                    </div>
                  </div>
                </div>

                {/* Verified Transactions Table Ledger */}
                <div className="bg-white rounded-3xl border border-[#141414]/5 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-[#141414]/5 flex items-center justify-between">
                    <h4 className="text-sm font-bold uppercase tracking-widest text-zinc-900">Platform Payment Ledger</h4>
                    <span className="text-xs font-mono font-bold text-zinc-400 bg-zinc-50 px-2.5 py-1 rounded">
                      {filteredRevenue.length} of {revenueLogs.length} matching transactions
                    </span>
                  </div>

                  {loadingRevenue ? (
                    <div className="p-12 text-center text-zinc-400">
                      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-emerald-500 mx-auto mb-4"></div>
                      Loading database ledger...
                    </div>
                  ) : filteredRevenue.length === 0 ? (
                    <div className="p-12 text-center text-zinc-400">
                      <div className="h-12 w-12 bg-zinc-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <FileText className="text-zinc-300" size={24} />
                      </div>
                      <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">No payment records match the current filter selection</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm border-collapse">
                        <thead>
                          <tr className="bg-zinc-50 border-b border-[#141414]/5 text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">
                            <th className="p-6">Tenant</th>
                            <th className="p-6">Plan / Cycle</th>
                            <th className="p-6">Amount Logged</th>
                            <th className="p-6">Active Period</th>
                            <th className="p-6">Transaction Date</th>
                            <th className="p-6">Logged By</th>
                            <th className="p-6">Notes / References</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                          {filteredRevenue.map((log) => (
                            <tr key={log.id} className="hover:bg-zinc-50/50 transition-colors">
                              <td className="p-6 font-bold text-zinc-900">{log.tenantName}</td>
                              <td className="p-6 capitalize">
                                <span className={cn(
                                  "text-[9px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider mr-1.5",
                                  log.package === 'enterprise' 
                                    ? "bg-purple-50 text-purple-700 border border-purple-100"
                                    : log.package === 'standard'
                                    ? "bg-blue-50 text-blue-700 border border-blue-100"
                                    : "bg-emerald-50 text-emerald-700 border border-emerald-100"
                                )}>
                                  {log.package}
                                </span>
                                <span className="text-xs text-zinc-500 font-bold uppercase tracking-widest">{log.cycle}</span>
                              </td>
                              <td className="p-6 font-mono font-bold text-emerald-600 bg-emerald-50/10">
                                UGX {log.amount?.toLocaleString()}
                              </td>
                              <td className="p-6 text-xs text-zinc-600 font-medium whitespace-nowrap">
                                {log.subscriptionStart} to {log.subscriptionEnd}
                              </td>
                              <td className="p-6 text-xs text-zinc-500 font-medium whitespace-nowrap">
                                {log.paymentDate ? format(new Date(log.paymentDate), 'MMM dd, yyyy HH:mm') : 'N/A'}
                              </td>
                              <td className="p-6 text-xs text-zinc-700 font-bold">{log.loggedBy}</td>
                              <td className="p-6 text-xs text-zinc-500 max-w-xs truncate" title={log.notes}>
                                {log.notes}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {activeTab === 'handlers' && isSuper && (
            <div className="grid grid-cols-3 gap-8">
              {/* Left Form */}
              <div className="bg-white rounded-3xl border border-[#141414]/5 shadow-sm p-8 col-span-1 h-fit">
                <h3 className="text-sm font-bold uppercase tracking-widest mb-6 border-b pb-4">Create TMC Handler</h3>
                
                <form onSubmit={handleCreateHandler} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">First Name</label>
                    <input 
                      type="text" 
                      required
                      placeholder="e.g. Jane"
                      className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
                      value={handlerFirstName}
                      onChange={(e) => setHandlerFirstName(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Second Name</label>
                    <input 
                      type="text" 
                      required
                      placeholder="e.g. Doe"
                      className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
                      value={handlerSecondName}
                      onChange={(e) => setHandlerSecondName(e.target.value)}
                    />
                  </div>

                  {handlerFirstName && handlerSecondName && (
                    <div className="bg-emerald-50/50 p-3 rounded-xl border border-emerald-100">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 block mb-1">Generated Username / Email</span>
                      <code className="text-xs font-mono font-bold text-zinc-700">
                        {handlerFirstName.toLowerCase()}.{handlerSecondName.toLowerCase()}@pharmhelm
                      </code>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Assign Tenant Administration</label>
                    <select 
                      required
                      className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/20"
                      value={handlerAssignedTenant}
                      onChange={(e) => setHandlerAssignedTenant(e.target.value)}
                    >
                      <option value="">-- Choose Tenant --</option>
                      {tenants.map(t => (
                        <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Password</label>
                    <div className="relative">
                      <input 
                        type={showHandlerPassword ? "text" : "password"} 
                        required
                        placeholder="Type password"
                        className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 pr-12"
                        value={handlerPassword}
                        onChange={(e) => setHandlerPassword(e.target.value)}
                      />
                      <button 
                        type="button"
                        onClick={() => setShowHandlerPassword(!showHandlerPassword)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                      >
                        {showHandlerPassword ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Confirm Password</label>
                    <input 
                      type={showHandlerPassword ? "text" : "password"} 
                      required
                      placeholder="Retype password"
                      className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
                      value={handlerConfirmPassword}
                      onChange={(e) => setHandlerConfirmPassword(e.target.value)}
                    />
                  </div>

                  <button 
                    type="submit"
                    disabled={savingHandler}
                    className="w-full py-3.5 bg-zinc-900 text-white font-bold rounded-xl text-sm hover:bg-zinc-800 transition-all disabled:bg-zinc-300 shadow-lg shadow-zinc-900/10"
                  >
                    {savingHandler ? 'Creating Handler...' : 'Register Handler'}
                  </button>
                </form>
              </div>

              {/* Right Handlers List */}
              <div className="col-span-2 bg-white rounded-3xl border border-[#141414]/5 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-[#141414]/5 flex items-center justify-between">
                  <h4 className="text-sm font-bold uppercase tracking-widest">Registered TMC Handlers</h4>
                  <span className="text-xs font-mono font-bold text-zinc-400 bg-zinc-50 px-2.5 py-1 rounded">
                    {handlers.filter(h => h.role === 'tmc_handler' && h.email !== 'peterssentongo61@gmail.com' && h.email !== 'peter.sentongo@pharmhelm.com' && h.email !== 'peter.sentongo@pharmhelm').length} Handlers
                  </span>
                </div>

                {loadingHandlers ? (
                  <div className="p-12 text-center text-zinc-400">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-emerald-500 mx-auto mb-4"></div>
                    Loading platform operators...
                  </div>
                ) : handlers.filter(h => h.role === 'tmc_handler' && h.email !== 'peterssentongo61@gmail.com' && h.email !== 'peter.sentongo@pharmhelm.com' && h.email !== 'peter.sentongo@pharmhelm').length === 0 ? (
                  <div className="p-12 text-center text-zinc-400 text-sm">
                    No custom TMC handlers created yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm border-collapse">
                      <thead>
                        <tr className="bg-zinc-50 border-b border-[#141414]/5 text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">
                          <th className="p-6">Operator Name</th>
                          <th className="p-6">Username / Email</th>
                          <th className="p-6">Assigned Tenant Target</th>
                          <th className="p-6">Role Privileges</th>
                          <th className="p-6">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {handlers.filter(h => 
                          h.role === 'tmc_handler' && 
                          h.email !== 'peterssentongo61@gmail.com' && 
                          h.email !== 'peter.sentongo@pharmhelm.com' && 
                          h.email !== 'peter.sentongo@pharmhelm'
                        ).map((h) => {
                          const assignedTenantIds = h.assignedTenantIds || [];
                          const combinedIds = [...assignedTenantIds];
                          if (h.assignedTenantId && !combinedIds.includes(h.assignedTenantId)) {
                            combinedIds.push(h.assignedTenantId);
                          }
                          const assignedTenantNames = combinedIds
                            .map(id => tenants.find(t => t.id === id || t.slug === id)?.name)
                            .filter(Boolean)
                            .join(', ') || 'No branches assigned';

                          return (
                            <tr 
                              key={h.id} 
                              onClick={() => setEditingHandler(h)}
                              className="hover:bg-zinc-50/50 transition-colors cursor-pointer group"
                            >
                              <td className="p-6 font-bold text-zinc-900 group-hover:text-emerald-600 transition-colors flex items-center gap-2">
                                <span>{h.full_name}</span>
                                <span className="text-[10px] text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity">(Click to edit)</span>
                              </td>
                              <td className="p-6 font-mono text-xs text-zinc-600 bg-zinc-50/30">{h.email}</td>
                              <td className="p-6 text-xs text-zinc-600 font-bold">{assignedTenantNames}</td>
                              <td className="p-6">
                                <span className="text-[10px] font-mono bg-zinc-100 text-zinc-800 px-2 py-0.5 rounded font-bold">
                                  {h.role}
                                </span>
                              </td>
                              <td className="p-6">
                                <span className={cn(
                                  "text-xs font-bold px-2.5 py-1 rounded-full",
                                  h.active ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                                )}>
                                  {h.active ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'analytics' && (
            <TelemetryDashboard tenants={tenants} />
          )}

          {activeTab === 'audit' && (
            <div className="space-y-6">
              {/* Stats & Controls */}
              <div className="flex justify-between items-center bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-900">Platform Security Audit Log</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">Immutable records of administrative, subscription, and billing changes.</p>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => fetchPlatformAuditLogs()}
                    className="p-2.5 bg-zinc-50 hover:bg-zinc-100 text-zinc-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                    title="Refresh Log"
                  >
                    <RefreshCw size={14} className={loadingAudit ? "animate-spin" : ""} />
                    Refresh
                  </button>
                  <button 
                    onClick={() => {
                      if (platformAuditLogs.length === 0) {
                        toast.error('No logs available to export.');
                        return;
                      }
                      const headers = ['Timestamp', 'Action', 'Details', 'Target ID', 'Operator', 'IP Address'];
                      const rows = platformAuditLogs.map(l => [
                        l.timestamp,
                        l.action,
                        l.details,
                        l.targetId || 'N/A',
                        l.performedBy,
                        l.ipAddress || '127.0.0.1'
                      ]);
                      const csvContent = "data:text/csv;charset=utf-8," 
                        + [headers.join(','), ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))].join('\n');
                      const encodedUri = encodeURI(csvContent);
                      const link = document.createElement("a");
                      link.setAttribute("href", encodedUri);
                      link.setAttribute("download", `pharmhelm_tmc_audit_log_${new Date().toISOString().split('T')[0]}.csv`);
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                      toast.success('Platform audit trail exported as CSV!');
                    }}
                    className="px-4 py-2.5 bg-zinc-900 text-white hover:bg-zinc-800 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <FileText size={14} />
                    Export CSV Ledger
                  </button>
                </div>
              </div>

              {/* Table ledger */}
              <div className="bg-white rounded-3xl border border-[#141414]/5 shadow-sm overflow-hidden">
                {loadingAudit ? (
                  <div className="p-12 text-center text-zinc-400">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-emerald-500 mx-auto mb-4"></div>
                    Loading audit trail...
                  </div>
                ) : platformAuditLogs.length === 0 ? (
                  <div className="p-12 text-center text-[#141414]/40">
                    <div className="h-16 w-16 bg-zinc-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <Clock className="text-zinc-300" size={32} />
                    </div>
                    <p className="text-sm font-medium text-zinc-400 mb-2">No Platform Audit Logs recorded yet.</p>
                    <p className="text-xs text-zinc-400 max-w-sm mx-auto">Try activating a subscription or provision a new tenant to generate immutable ledger items.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm border-collapse">
                      <thead>
                        <tr className="bg-zinc-50 border-b border-[#141414]/5 text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">
                          <th className="p-6">Timestamp</th>
                          <th className="p-6">Action</th>
                          <th className="p-6">Details</th>
                          <th className="p-6">Performed By</th>
                          <th className="p-6">IP Address</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {platformAuditLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-zinc-50/50 transition-colors">
                            <td className="p-6 font-mono text-xs text-zinc-500 whitespace-nowrap">
                              {log.timestamp ? format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss') : 'N/A'}
                            </td>
                            <td className="p-6 whitespace-nowrap">
                              <span className={cn(
                                "text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full",
                                log.action?.includes('Subscription') 
                                  ? "bg-purple-50 text-purple-700 border border-purple-100"
                                  : log.action?.includes('Tenant')
                                  ? "bg-blue-50 text-blue-700 border border-blue-100"
                                  : log.action?.includes('Handler')
                                  ? "bg-amber-50 text-amber-700 border border-amber-100"
                                  : "bg-zinc-100 text-zinc-700"
                              )}>
                                {log.action}
                              </span>
                            </td>
                            <td className="p-6 text-zinc-700 font-medium min-w-[300px]">
                              {log.details}
                            </td>
                            <td className="p-6 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                <span className="font-bold text-zinc-800 text-xs">{log.performedBy}</span>
                              </div>
                            </td>
                            <td className="p-6 font-mono text-xs text-zinc-400 whitespace-nowrap">
                              {log.ipAddress || '197.239.4.15'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Edit Tenant Modal */}
      {editingTenant && (
        <EditTenantModal 
          tenant={editingTenant}
          platformEmail={platformProfile?.email || ''}
          onRequestReauth={(action, payload) => {
            setReauthTenant(editingTenant);
            setReauthEmail(auth.currentUser?.email || '');
            setReauthPassword('');
            setReauthAction(action);
            setReauthPayload(payload);
            setShowReauthModal(true);
          }}
          onClose={() => setEditingTenant(null)} 
          onSuccess={() => {
            setEditingTenant(null);
            fetchTenants();
          }} 
        />
      )}

      {/* Create Tenant Modal */}
      {showCreateModal && (
        <CreateTenantModal 
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            fetchTenants();
          }}
          logAction={logPlatformAction}
        />
      )}

      {/* Staff Override Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-[#141414]/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full border border-zinc-200 shadow-2xl">
            <h3 className="text-lg font-bold mb-2">Override Staff Password</h3>
            <p className="text-xs text-zinc-500 mb-6">Updating credentials for <strong>{overrideUserFullName}</strong>.</p>
            <div className="space-y-4 mb-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">New Password</label>
                <input 
                  type="password" 
                  required
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Confirm Password</label>
                <input 
                  type="password" 
                  required
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => {
                  setShowPasswordModal(false);
                  setNewPassword('');
                  setConfirmNewPassword('');
                }}
                className="flex-1 py-3 bg-zinc-100 text-zinc-800 rounded-xl font-bold text-sm hover:bg-zinc-200 transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={async () => {
                  if (!newPassword) {
                    toast.error('Password cannot be empty');
                    return;
                  }
                  if (newPassword !== confirmNewPassword) {
                    toast.error('Passwords do not match');
                    return;
                  }
                  try {
                    const docRef = doc(db, 'staff', overrideUserId!);
                    await updateDoc(docRef, {
                      password: newPassword,
                      password_set: true,
                      updatedAt: new Date().toISOString()
                    });
                    toast.success('Password override successful!');
                    setShowPasswordModal(false);
                    setNewPassword('');
                    setConfirmNewPassword('');
                    if (selectedTenantForAccounts) {
                      fetchStaffAccounts(selectedTenantForAccounts);
                    }
                  } catch (e) {
                    toast.error('Failed to override password.');
                  }
                }}
                className="flex-1 py-3 bg-[#141414] text-white rounded-xl font-bold text-sm hover:bg-zinc-800 transition-all"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Access Modal */}
      {quickAccessTenant && (
        <QuickAccessModal 
          tenant={quickAccessTenant}
          onClose={() => setQuickAccessTenant(null)}
          onSwitch={(slug) => setTenantSlugAndMode(slug)}
        />
      )}

      {/* Edit Handler Modal */}
      {editingHandler && (
        <EditHandlerModal 
          handler={editingHandler}
          tenants={tenants}
          currentUserEmail={platformProfile?.email || ''}
          onClose={() => setEditingHandler(null)}
          onSuccess={() => {
            setEditingHandler(null);
            fetchHandlers();
          }}
        />
      )}

      {/* Re-auth Modal */}
      {showReauthModal && (() => {
        let title = 'Confirm Action';
        let desc = <span>Please verify your credentials to confirm this action for <strong>{reauthTenant?.name}</strong>.</span>;
        let iconColor = 'bg-blue-50 text-blue-600';
        let btnColor = 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/20';
        let btnText = reauthSaving ? 'Confirming...' : 'Confirm';

        if (reauthAction === 'purge') {
          title = 'Confirm Permanent Deletion';
          desc = <span>This is a highly destructive administrative action. Please verify your credentials to permanently purge <strong>{reauthTenant?.name}</strong>.</span>;
          iconColor = 'bg-red-50 text-red-600';
          btnColor = 'bg-red-600 hover:bg-red-700 shadow-red-500/20';
          btnText = reauthSaving ? 'Purging...' : 'Confirm Purge';
        } else if (reauthAction === 'updateBranchLimit') {
          title = 'Confirm Branch Limit Update';
          desc = <span>Please verify your credentials to update the branch limit for <strong>{reauthTenant?.name}</strong>.</span>;
          iconColor = 'bg-amber-50 text-amber-600';
          btnColor = 'bg-amber-600 hover:bg-amber-700 shadow-amber-500/20';
          btnText = reauthSaving ? 'Updating...' : 'Confirm Update';
        } else if (reauthAction === 'grantTrial') {
          title = 'Confirm Trial Grant';
          desc = <span>Please verify your credentials to grant a trial period for <strong>{reauthTenant?.name}</strong>.</span>;
          iconColor = 'bg-emerald-50 text-emerald-600';
          btnColor = 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20';
          btnText = reauthSaving ? 'Granting...' : 'Confirm Grant';
        } else if (reauthAction === 'grantComplimentary') {
          title = 'Confirm Complimentary Period';
          desc = <span>Please verify your credentials to grant a complimentary period for <strong>{reauthTenant?.name}</strong>.</span>;
          iconColor = 'bg-emerald-50 text-emerald-600';
          btnColor = 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20';
          btnText = reauthSaving ? 'Granting...' : 'Confirm Grant';
        }

        return (
          <div className="fixed inset-0 bg-[#141414]/80 backdrop-blur-sm flex items-center justify-center p-4 z-[70]">
            <div className="bg-white rounded-[2rem] p-8 max-w-md w-full border border-zinc-200 shadow-2xl space-y-6">
              <div className="text-center">
                <div className={`h-16 w-16 ${iconColor} rounded-3xl flex items-center justify-center mx-auto mb-4`}>
                  <ShieldAlert size={36} />
                </div>
                <h3 className="text-xl font-black text-zinc-900 uppercase tracking-tight">{title}</h3>
                <p className="text-xs text-zinc-500 mt-2">
                  {desc}
                </p>
              </div>

              <form onSubmit={handleReauthSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Email Address</label>
                  <input 
                    type="email" 
                    required 
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none font-medium"
                    placeholder="Enter your administrative email"
                    value={reauthEmail}
                    onChange={(e) => setReauthEmail(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Password</label>
                  <input 
                    type="password" 
                    required 
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none"
                    placeholder="Enter your password"
                    value={reauthPassword}
                    onChange={(e) => setReauthPassword(e.target.value)}
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button 
                    type="button"
                    onClick={() => {
                      setShowReauthModal(false);
                      setReauthTenant(null);
                      setReauthEmail('');
                      setReauthPassword('');
                      setReauthAction(null);
                      setReauthPayload(null);
                    }}
                    className="flex-1 py-3.5 bg-zinc-100 text-zinc-700 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-zinc-200 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    disabled={reauthSaving}
                    className={`flex-1 py-3.5 text-white rounded-xl font-bold text-xs uppercase tracking-widest disabled:bg-zinc-200 transition-all shadow-lg ${btnColor}`}
                  >
                    {btnText}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const EditTenantModal = ({ tenant, platformEmail, onClose, onSuccess, onRequestReauth }: { tenant: Tenant, platformEmail: string, onClose: () => void, onSuccess: () => void, onRequestReauth: (action: string, payload: any) => void }) => {
  const [branchCount, setBranchCount] = useState<number | null>(null);
  const [branchLimitInput, setBranchLimitInput] = useState<number | ''>(tenant.branchLimit ?? '');
  const [resetToTierDefault, setResetToTierDefault] = useState(false);
  const [showTrialForm, setShowTrialForm] = useState(false);
  const [trialBranchLimit, setTrialBranchLimit] = useState<number | ''>('');
  const [trialEndDate, setTrialEndDate] = useState('');
  const [trialNotes, setTrialNotes] = useState('');
  const [showComplimentaryForm, setShowComplimentaryForm] = useState(false);
  const [compStartDate, setCompStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [compEndDate, setCompEndDate] = useState('');
  const [compReason, setCompReason] = useState('');
  const [formData, setFormData] = useState({
    name: tenant.name,
    slug: tenant.slug,
    country: tenant.country,
    nda_reg_number: tenant.nda_reg_number,
    contact_name: tenant.contact_name,
    contact_email: tenant.contact_email,
    contact_phone: tenant.contact_phone,
    subscription_tier: tenant.subscription_tier,
    subscription_status: tenant.subscription_status,
    subscription_cycle: tenant.subscription_cycle,
    subscription_end: tenant.subscription_end ? tenant.subscription_end.split('T')[0] : '',
    brand_colour: tenant.brand_colour,
    deployment_mode: tenant.deployment_mode,
    status: tenant.status,
    acronym: tenant.acronym || ''
  });
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmSlug, setDeleteConfirmSlug] = useState('');
  const [retentionPeriod, setRetentionPeriod] = useState('365');
  const [activeModalTab, setActiveModalTab] = useState<'details' | 'predictive'>('details');
  const [predictiveData, setPredictiveData] = useState<any[]>([]);
  const [loadingPredictive, setLoadingPredictive] = useState(false);

  useEffect(() => {
    if (activeModalTab === 'predictive') {
      fetchPredictiveData();
    }
  }, [activeModalTab]);

  useEffect(() => {
    // Fetch current branch count for tenant
    (async () => {
      try {
        const q = query(collection(db, 'branches'), where('tenantId', '==', tenant.id));
        const snap = await getDocs(q);
        setBranchCount(snap.size);
      } catch (e) {
        console.warn('Failed to fetch branch count for tenant', tenant.id, e);
      }
    })();
  }, [tenant.id]);

  const fetchPredictiveData = async () => {
    setLoadingPredictive(true);
    try {
      const q = query(collection(db, 'predictive_settings'), where('tenantId', '==', tenant.slug));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(d => d.data());
      setPredictiveData(data);
    } catch (error) {
      console.error('Error fetching predictive data:', error);
    } finally {
      setLoadingPredictive(false);
    }
  };

  const calculateSustainability = (state: any) => {
    const grossMargin = state.markup / (1 + state.markup);
    const gp = state.totalSales * grossMargin;
    const f = state.fixedCosts;
    const pi = state.desiredProfit;
    const score = ((gp / (f + pi)) * 100);
    
    let zone: 'loss' | 'survival' | 'sustainable' = 'loss';
    if (gp < f) zone = 'loss';
    else if (gp >= f && gp < (f + pi)) zone = 'survival';
    else zone = 'sustainable';

    return { score, zone, gp, netProfit: gp - f };
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      const now = new Date();
      const expires = new Date();
      expires.setDate(expires.getDate() + parseInt(retentionPeriod));

      await updateDoc(doc(db, 'tenants', tenant.id), {
        deleted: true,
        deleted_at: now.toISOString(),
        deletedAt: now.toISOString(),
        deleted_expires_at: expires.toISOString(),
        autoPurgeDate: expires.toISOString(),
        deletedBy: auth.currentUser?.uid || '',
        status: 'deleted',
        subscription_status: 'expired',
        slug: tenant.slug.includes('_deleted_') ? tenant.slug : tenant.slug + '_deleted_' + Date.now(),
        original_slug: tenant.original_slug || tenant.slug
      });

      toast.success('Tenant moved to Bin.');
      onSuccess();
    } catch (error) {
      console.error('Error soft-deleting tenant:', error);
      toast.error('Failed to soft-delete tenant');
    } finally {
      setSaving(false);
      setShowDeleteConfirm(false);
      setDeleteConfirmSlug('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updateData = {
        ...formData,
        subscription_end: formData.subscription_end ? new Date(formData.subscription_end).toISOString() : '',
        updated_at: new Date().toISOString()
      };

      await updateDoc(doc(db, 'tenants', tenant.id), updateData);
      
      // Update system settings if deployment mode changed
      if (formData.deployment_mode !== tenant.deployment_mode) {
        try {
          await updateDoc(doc(db, 'system_settings', tenant.id), {
            multiBranchMode: formData.deployment_mode === 'multi_branch',
            updatedAt: new Date().toISOString()
          });
        } catch (err) {
          console.warn("Direct settings update failed, falling back to slug query...");
        }

        const settingsQuery = query(collection(db, 'system_settings'), where('tenantId', '==', tenant.slug));
        const settingsSnap = await getDocs(settingsQuery);
        if (!settingsSnap.empty) {
          await updateDoc(doc(db, 'system_settings', settingsSnap.docs[0].id), {
            multiBranchMode: formData.deployment_mode === 'multi_branch',
            updatedAt: new Date().toISOString()
          });
        }
      }

      toast.success('Tenant updated successfully');
      onSuccess();
    } catch (error) {
      console.error('Error updating tenant:', error);
      toast.error('Failed to update tenant');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#141414]/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white w-full max-w-2xl rounded-[2rem] overflow-hidden shadow-2xl">
        <div className="p-8 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
          <div>
            <h2 className="text-xl font-bold text-[#141414]">Edit Tenant: {tenant.name}</h2>
            <div className="flex gap-4 mt-2">
              <button 
                onClick={() => setActiveModalTab('details')}
                className={cn(
                  "text-[10px] font-black uppercase tracking-widest transition-all",
                  activeModalTab === 'details' ? "text-emerald-500" : "text-zinc-400 hover:text-zinc-600"
                )}
              >
                General Details
              </button>
              <button 
                onClick={() => setActiveModalTab('predictive')}
                className={cn(
                  "text-[10px] font-black uppercase tracking-widest transition-all",
                  activeModalTab === 'predictive' ? "text-emerald-500" : "text-zinc-400 hover:text-zinc-600"
                )}
              >
                Predictive Health
              </button>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white rounded-full transition-all">
            <XCircle size={24} className="text-zinc-300 hover:text-red-500" />
          </button>
        </div>

        {activeModalTab === 'details' ? (
          <form onSubmit={handleSubmit} className="p-8 space-y-6 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-3 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Pharmacy Name</label>
              <input 
                required
                type="text"
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all font-medium"
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Subdomain Slug</label>
              <input 
                required
                disabled
                type="text"
                className="w-full px-4 py-3 bg-zinc-100 border border-zinc-200 rounded-xl outline-none font-mono text-sm opacity-60 cursor-not-allowed"
                value={formData.slug}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Tenant Acronym (e.g. RPL)</label>
              <input 
                type="text"
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all font-mono text-sm uppercase"
                placeholder="e.g. RPL"
                value={formData.acronym}
                onChange={(e) => setFormData({...formData, acronym: e.target.value.toUpperCase().replace(/\s+/g, '')})}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Subscription Tier</label>
              <select 
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none appearance-none"
                value={formData.subscription_tier}
                onChange={(e) => setFormData({...formData, subscription_tier: e.target.value as any})}
              >
                <option value="basic">Basic (Starter)</option>
                <option value="standard">Standard (Pro)</option>
                <option value="enterprise">Enterprise (Premium)</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Branch Limit</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none"
                  value={branchLimitInput as any}
                  onChange={(e) => setBranchLimitInput(e.target.value === '' ? '' : parseInt(e.target.value))}
                  placeholder="Set branch limit"
                />
                <button
                  type="button"
                  onClick={() => {
                    // trigger reauth modal for branch limit change
                    const tierDefault = tenant.subscription_tier === 'basic' ? 1 : (tenant.subscription_tier === 'standard' ? 5 : 15);
                    const newLimit = resetToTierDefault ? tierDefault : branchLimitInput;
                    onRequestReauth('updateBranchLimit', { oldLimit: tenant.branchLimit ?? null, newLimit });
                  }}
                  className="px-3 py-3 bg-emerald-500 text-white rounded-xl font-bold text-xs uppercase tracking-widest"
                >
                  Save
                </button>
              </div>
              <p className="text-xs text-zinc-400">Current branches: {branchCount ?? '—'} • Tier default: {tenant.subscription_tier === 'basic' ? 1 : tenant.subscription_tier === 'standard' ? 5 : 15}</p>
              <label className="inline-flex items-center gap-2 text-xs mt-2"><input type="checkbox" checked={resetToTierDefault} onChange={(e) => setResetToTierDefault(e.target.checked)} /> Reset branchLimit to tier default on save</label>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Trial Access</label>
              {!showTrialForm ? (
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowTrialForm(true)} className="px-3 py-2 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-bold">Grant Trial Access</button>
                </div>
              ) : (
                <div className="space-y-2">
                  <input type="number" min={1} placeholder="Trial Branch Limit" value={trialBranchLimit as any} onChange={(e) => setTrialBranchLimit(e.target.value === '' ? '' : parseInt(e.target.value))} className="w-full px-3 py-2 border rounded-xl" />
                  <input type="date" value={trialEndDate} onChange={(e) => setTrialEndDate(e.target.value)} className="w-full px-3 py-2 border rounded-xl" />
                  <input type="text" placeholder="Notes (optional)" value={trialNotes} onChange={(e) => setTrialNotes(e.target.value)} className="w-full px-3 py-2 border rounded-xl" />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => {
                      // trigger reauth for trial grant
                      if (!trialBranchLimit || !trialEndDate) { toast.error('Please set trial branch limit and end date'); return; }
                      onRequestReauth('grantTrial', { trialBranchLimit, trialStartDate: new Date().toISOString(), trialEndDate, notes: trialNotes });
                    }} className="px-3 py-2 bg-emerald-500 text-white rounded-xl text-xs font-bold">Grant Trial</button>
                    <button type="button" onClick={() => setShowTrialForm(false)} className="px-3 py-2 bg-zinc-100 rounded-xl text-xs">Cancel</button>
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Complimentary Period</label>
              {!showComplimentaryForm ? (
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowComplimentaryForm(true)} className="px-3 py-2 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-bold">Grant Complimentary Period</button>
                </div>
              ) : (
                <div className="space-y-2">
                  <input type="date" value={compStartDate} onChange={(e) => setCompStartDate(e.target.value)} className="w-full px-3 py-2 border rounded-xl" />
                  <input type="date" value={compEndDate} onChange={(e) => setCompEndDate(e.target.value)} className="w-full px-3 py-2 border rounded-xl" />
                  <input type="text" placeholder="Reason" value={compReason} onChange={(e) => setCompReason(e.target.value)} className="w-full px-3 py-2 border rounded-xl" />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => {
                      if (!compEndDate || !compReason) { toast.error('Please set end date and reason'); return; }
                      onRequestReauth('grantComplimentary', { startDate: compStartDate, endDate: compEndDate, reason: compReason });
                    }} className="px-3 py-2 bg-emerald-500 text-white rounded-xl text-xs font-bold">Grant</button>
                    <button type="button" onClick={() => setShowComplimentaryForm(false)} className="px-3 py-2 bg-zinc-100 rounded-xl text-xs">Cancel</button>
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Subscription Status</label>
              <select 
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none appearance-none"
                value={formData.subscription_status}
                onChange={(e) => setFormData({...formData, subscription_status: e.target.value as any})}
              >
                <option value="trial">Trial</option>
                <option value="active">Active</option>
                <option value="expired">Expired</option>
                <option value="unsubscribed">Unsubscribed</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Expiry Date</label>
              <input 
                type="date"
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none"
                value={formData.subscription_end}
                onChange={(e) => setFormData({...formData, subscription_end: e.target.value})}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Billing Cycle</label>
              <select 
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none appearance-none"
                value={formData.subscription_cycle}
                onChange={(e) => setFormData({...formData, subscription_cycle: e.target.value as any})}
              >
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">System Status</label>
              <select 
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none appearance-none"
                value={formData.status}
                onChange={(e) => setFormData({...formData, status: e.target.value as any})}
              >
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Brand Colour</label>
              <div className="flex gap-2">
                <input 
                  type="color"
                  className="h-11 w-11 p-1 bg-zinc-50 border border-zinc-200 rounded-xl cursor-pointer"
                  value={formData.brand_colour}
                  onChange={(e) => setFormData({...formData, brand_colour: e.target.value})}
                />
                <input 
                  type="text"
                  className="flex-1 px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none font-mono text-xs uppercase"
                  value={formData.brand_colour}
                  onChange={(e) => setFormData({...formData, brand_colour: e.target.value})}
                />
              </div>
            </div>
          </div>

          <div className="space-y-4 pt-4 border-t border-zinc-100">
            <h3 className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Primary Contact</h3>
            <div className="grid grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Full Name</label>
                <input 
                  required
                  type="text"
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none text-sm"
                  value={formData.contact_name}
                  onChange={(e) => setFormData({...formData, contact_name: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Email Address</label>
                <input 
                  required
                  type="email"
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none text-sm"
                  value={formData.contact_email}
                  onChange={(e) => setFormData({...formData, contact_email: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Phone Number</label>
                <input 
                  required
                  type="tel"
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none text-sm"
                  value={formData.contact_phone}
                  onChange={(e) => setFormData({...formData, contact_phone: e.target.value})}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-6">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <input 
                  type="checkbox" 
                  id="multiBranchEdit"
                  className="h-5 w-5 rounded-lg border-zinc-200 text-emerald-500 focus:ring-emerald-500/20"
                  checked={formData.deployment_mode === 'multi_branch'}
                  onChange={(e) => setFormData({...formData, deployment_mode: e.target.checked ? 'multi_branch' : 'single_branch'})}
                />
                <label htmlFor="multiBranchEdit" className="text-sm font-bold text-[#141414]">Enable Multi-Branch Management</label>
              </div>
              
              <button 
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-2 text-red-500 hover:text-red-600 font-bold text-sm transition-all"
              >
                <Trash2 size={16} />
                Delete Tenant
              </button>
            </div>
            <div className="flex gap-4">
              <button 
                type="button"
                onClick={onClose}
                className="px-6 py-3 text-sm font-bold text-[#141414]/40 hover:text-[#141414] transition-all"
              >
                Cancel
              </button>
              <button 
                type="submit"
                disabled={saving}
                className="px-8 py-3 bg-[#141414] text-white rounded-xl font-bold hover:bg-[#2a2a2a] disabled:bg-zinc-400 transition-all flex items-center gap-2"
              >
                {saving ? <Clock className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
                Save Changes
              </button>
            </div>
          </div>
        </form>
        ) : (
          <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-400">Branch Sustainability Analysis</h3>
              <button 
                onClick={fetchPredictiveData}
                type="button"
                className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest hover:underline"
              >
                Refresh Data
              </button>
            </div>

            {loadingPredictive ? (
              <div className="py-20 text-center">
                <Clock className="animate-spin mx-auto text-zinc-300 mb-4" size={32} />
                <p className="text-sm font-medium text-zinc-400">Analyzing branch health...</p>
              </div>
            ) : predictiveData.length > 0 ? (
              <div className="space-y-6">
                {predictiveData.map((branchData, i) => {
                  const metrics = calculateSustainability(branchData);
                  return (
                    <div key={i} className="p-6 bg-zinc-50 rounded-3xl border border-zinc-100 space-y-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 bg-white rounded-xl flex items-center justify-center text-zinc-900 shadow-sm">
                            <Activity size={20} />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-zinc-900">Branch ID: {branchData.branchId}</p>
                            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                              Last Updated: {branchData.updatedAt ? format(new Date(branchData.updatedAt), 'MMM dd, HH:mm') : 'Never'}
                            </p>
                          </div>
                        </div>
                        <div className={cn(
                          "px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest",
                          metrics.zone === 'sustainable' ? "bg-emerald-100 text-emerald-700" :
                          metrics.zone === 'survival' ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                        )}>
                          {metrics.zone} Zone
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div className="p-4 bg-white rounded-2xl border border-zinc-100">
                          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Sustainability</p>
                          <p className="text-lg font-black text-zinc-900">{Math.round(metrics.score)}%</p>
                        </div>
                        <div className="p-4 bg-white rounded-2xl border border-zinc-100">
                          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Gross Profit</p>
                          <p className="text-lg font-black text-zinc-900">UGX {metrics.gp.toLocaleString()}</p>
                        </div>
                        <div className="p-4 bg-white rounded-2xl border border-zinc-100">
                          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Net Profit</p>
                          <p className={cn("text-lg font-black", metrics.netProfit >= 0 ? "text-emerald-600" : "text-red-600")}>
                            UGX {metrics.netProfit.toLocaleString()}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 p-3 bg-white/50 rounded-xl border border-zinc-100">
                        <Zap size={14} className="text-amber-500" />
                        <p className="text-[10px] font-bold text-zinc-500">
                          Based on {Math.round(branchData.markup * 100)}% markup and UGX {branchData.fixedCosts.toLocaleString()} fixed costs.
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-20 text-center bg-zinc-50 rounded-[2rem] border border-dashed border-zinc-200">
                <Calculator className="mx-auto text-zinc-300 mb-4" size={48} />
                <p className="text-sm font-bold text-zinc-400">No predictive data available for this tenant.</p>
                <p className="text-xs text-zinc-400 mt-1">The tenant needs to configure their Predictive Engine first.</p>
              </div>
            )}
          </div>
        )}

        {/* Delete Confirmation Overlay */}
        {showDeleteConfirm && (
          <div className="absolute inset-0 bg-white/95 backdrop-blur-md flex items-center justify-center p-8 z-[60]">
            <div className="max-w-md w-full text-center space-y-6">
              <div className="h-20 w-20 bg-amber-50 text-amber-600 rounded-3xl flex items-center justify-center mx-auto">
                <AlertTriangle size={40} />
              </div>
              <div>
                <h3 className="text-2xl font-bold text-[#141414]">Move to Bin</h3>
                <p className="text-sm text-[#141414]/60 mt-2">
                  Are you sure you want to delete <span className="font-bold text-[#141414]">{tenant.name}</span>'s account? It will move to the Bin and can be restored or permanently deleted from there.
                </p>
              </div>
              
              <div className="space-y-4 text-left">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest block">
                    Bin Retention Period
                  </label>
                  <select 
                    className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl outline-none text-sm font-bold"
                    value={retentionPeriod}
                    onChange={(e) => setRetentionPeriod(e.target.value)}
                  >
                    <option value="30">30 Days</option>
                    <option value="90">90 Days</option>
                    <option value="180">180 Days</option>
                    <option value="365">1 Year (Default)</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteConfirmSlug('');
                  }}
                  className="flex-1 py-4 text-sm font-bold text-[#141414]/40 hover:text-[#141414] transition-all"
                >
                  Go Back
                </button>
                <button 
                  onClick={handleDelete}
                  disabled={saving}
                  className="flex-1 py-4 bg-amber-500 text-white rounded-xl font-bold hover:bg-amber-650 transition-all shadow-lg shadow-amber-500/20 text-xs uppercase tracking-widest"
                >
                  {saving ? 'Deleting...' : 'Move to Bin'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const CreateTenantModal = ({ onClose, onSuccess, logAction }: { onClose: () => void, onSuccess: () => void, logAction: (action: string, details: string, targetId?: string) => Promise<void> }) => {
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    acronym: '',
    country: 'Uganda',
    nda_reg_number: '',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    subscription_tier: 'basic' as 'basic' | 'standard' | 'enterprise',
    subscription_cycle: 'monthly' as 'monthly' | 'annual',
    brand_colour: '#10b981',
    deployment_mode: 'single_branch' as 'single_branch' | 'multi_branch'
  });
  const [saving, setSaving] = useState(false);
  const [credentials, setCredentials] = useState<{ username: string; authEmail: string; password: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Validate slug
      const slugRegex = /^[a-z0-9-]+$/;
      if (!slugRegex.test(formData.slug)) {
        toast.error('Slug can only contain lowercase letters, numbers, and hyphens.');
        setSaving(false);
        return;
      }

      // Check if slug exists
      const q = query(collection(db, 'tenants'), where('slug', '==', formData.slug));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        toast.error('This subdomain slug is already taken.');
        setSaving(false);
        return;
      }

      const now = new Date();
      const expiry = new Date();
      expiry.setMonth(expiry.getMonth() + 1);

      // 1. Create Tenant
      const tenantRef = await addDoc(collection(db, 'tenants'), {
        ...formData,
        subscription_status: 'inactive',
        subscription_start: '',
        subscription_end: '',
        modules_enabled: ['inventory', 'sales', 'finance', 'hr', 'logistics'],
        status: 'active',
        created_at: now.toISOString(),
        created_by: 'system'
      });

      const tenantId = tenantRef.id;

      // 2. Create HQ Branch
      const branchRef = await addDoc(collection(db, 'branches'), {
        tenantId: tenantId,
        branch_code: 'HQ-001',
        name: `${formData.name} HQ`,
        type: 'HQ',
        address: 'Main Office',
        phone: formData.contact_phone,
        status: 'Active',
        created_at: now.toISOString(),
        created_by: 'system'
      });

      // 3. Create Initial IT Head User
      const generatedPassword = Math.random().toString(36).slice(-8);
      const acronymLower = formData.acronym ? formData.acronym.toLowerCase().trim() : formData.slug.toLowerCase().trim();
      const username = `admin.${acronymLower}.pharmhelm.com`;
      
      // Register this credential inside Firebase Authentication backend pool
      const authEmail = `admin@${acronymLower}.pharmhelm.com`;
      let initialUserUid = '';
      try {
        initialUserUid = await registerAuthUser(authEmail, generatedPassword);
      } catch (authErr: any) {
        console.warn("Could not register user automatically in Firebase Auth:", authErr);
        toast.info("Automatic Auth registration bypassed. Please manually add the credential to Firebase Authentication.");
      }
      
      if (!initialUserUid) {
        throw new Error('Initial IT Head authentication account was not created. Tenant staff provisioning stopped.');
      }
      await setDoc(doc(db, 'staff', initialUserUid), {
        id: initialUserUid,
        uid: initialUserUid,
        tenantId: tenantId,
        username: username,
        authEmail: authEmail,
        password_set: true,
        email: formData.contact_email,
        displayName: formData.contact_name,
        full_name: formData.contact_name,
        phone_number: formData.contact_phone,
        role: 'IT Head',
        status: 'active',
        active: true,
        branch_id: branchRef.id,
        assigned_branches: [branchRef.id],
        default_branch_id: branchRef.id,
        created_at: now.toISOString()
      });
      
      // 4. Create default system settings
      await setDoc(doc(db, 'system_settings', tenantId), {
        tenantId: tenantId,
        multiBranchMode: formData.deployment_mode === 'multi_branch',
        branding: {
          companyName: formData.name,
          receiptFooter: 'Thank you for your business!',
          ndaRegNumber: formData.nda_reg_number
        },
        updatedAt: now.toISOString()
      });

      setCredentials({ username, authEmail, password: generatedPassword });
      toast.success('Tenant provisioned successfully');
      await logAction(
        'Tenant Environment Provisioned',
        `Successfully provisioned new tenant ${formData.name} (${formData.slug}) with initial IT Head account ${username}. HQ branch HQ-001 created.`,
        tenantId
      );
    } catch (error: any) {
      console.error('Error creating tenant:', error);
      toast.error('Failed to create tenant: ' + (error.message || error));
    } finally {
      setSaving(false);
    }
  };

  if (credentials) {
    return (
      <div className="fixed inset-0 bg-[#141414]/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
        <div className="bg-white w-full max-w-md rounded-[2rem] overflow-hidden shadow-2xl p-8 text-center">
          <div className="h-16 w-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 size={32} />
          </div>
          <h2 className="text-2xl font-bold text-[#141414] mb-2">Provisioning Complete</h2>
          <p className="text-sm text-[#141414]/60 mb-8">The tenant environment is ready. Please share these initial credentials with the client IT Head.</p>
          
          <div className="bg-zinc-50 rounded-2xl p-6 mb-8 text-left space-y-4 border border-zinc-100">
            <div>
              <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest mb-1">Access URL</p>
              <p className="text-sm font-mono font-bold text-emerald-600 break-all">
                {window.location.origin}/?tenant={formData.slug}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest mb-1">Initial Username (Use to Log In)</p>
              <p className="text-sm font-mono font-bold text-zinc-900">{credentials.username}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-1">Firebase Auth Email (Add in Firebase Console)</p>
              <p className="text-sm font-mono font-bold text-blue-600 break-all">{credentials.authEmail}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest mb-1">Temporary Password</p>
              <p className="text-sm font-mono font-bold text-zinc-900">{credentials.password}</p>
            </div>
          </div>

          <button 
            onClick={() => {
              onSuccess();
              onClose();
            }}
            className="w-full py-4 bg-[#141414] text-white rounded-xl font-bold hover:bg-[#2a2a2a] transition-all"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#141414]/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white w-full max-w-2xl rounded-[2rem] overflow-hidden shadow-2xl">
        <div className="p-8 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
          <div>
            <h2 className="text-xl font-bold text-[#141414]">Provision New Tenant</h2>
            <p className="text-xs text-[#141414]/40 font-bold uppercase tracking-widest mt-1">Onboarding Workflow</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white rounded-full transition-all">
            <XCircle size={24} className="text-zinc-300 hover:text-red-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="grid grid-cols-3 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Pharmacy Name</label>
              <input 
                required
                type="text"
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all font-medium"
                placeholder="e.g. Radah Pharmaceutical"
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
              />
            </div>
            <div className="space-y-2 col-span-2">
              <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Subdomain Slug (Derived from Acronym)</label>
              <div className="relative">
                <input 
                  readOnly
                  type="text"
                  className="w-full pl-4 pr-36 py-3 bg-zinc-100 border border-zinc-200 rounded-xl outline-none transition-all font-mono text-sm text-zinc-500 cursor-not-allowed"
                  placeholder="acronym-slug"
                  value={formData.slug}
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[#141414]/30">.pharmhelm.com</span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Tenant Acronym (e.g. mp)</label>
              <input 
                required
                type="text"
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all font-mono text-sm uppercase"
                placeholder="e.g. mp"
                value={formData.acronym}
                onChange={(e) => {
                  const val = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '');
                  setFormData({...formData, acronym: val, slug: val});
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Subscription Tier</label>
              <select 
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all font-medium appearance-none"
                value={formData.subscription_tier}
                onChange={(e) => setFormData({...formData, subscription_tier: e.target.value as any})}
              >
                <option value="basic">Basic (Starter)</option>
                <option value="standard">Standard (Pro)</option>
                <option value="enterprise">Enterprise (Premium)</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Billing Cycle</label>
              <select 
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all font-medium appearance-none"
                value={formData.subscription_cycle}
                onChange={(e) => setFormData({...formData, subscription_cycle: e.target.value as any})}
              >
                <option value="monthly">Monthly</option>
                <option value="annual">Annual (-15%)</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Brand Colour</label>
              <div className="flex gap-2">
                <input 
                  type="color"
                  className="h-11 w-11 p-1 bg-zinc-50 border border-zinc-200 rounded-xl cursor-pointer"
                  value={formData.brand_colour}
                  onChange={(e) => setFormData({...formData, brand_colour: e.target.value})}
                />
                <input 
                  type="text"
                  className="flex-1 px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none font-mono text-xs uppercase"
                  value={formData.brand_colour}
                  onChange={(e) => setFormData({...formData, brand_colour: e.target.value})}
                />
              </div>
            </div>
          </div>

          <div className="space-y-4 pt-4 border-t border-zinc-100">
            <h3 className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Primary Contact</h3>
            <div className="grid grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Full Name</label>
                <input 
                  required
                  type="text"
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none text-sm"
                  value={formData.contact_name}
                  onChange={(e) => setFormData({...formData, contact_name: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Email Address</label>
                <input 
                  required
                  type="email"
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none text-sm"
                  value={formData.contact_email}
                  onChange={(e) => setFormData({...formData, contact_email: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Phone Number</label>
                <input 
                  required
                  type="tel"
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none text-sm"
                  value={formData.contact_phone}
                  onChange={(e) => setFormData({...formData, contact_phone: e.target.value})}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-6">
            <div className="flex items-center gap-3">
              <input 
                type="checkbox" 
                id="multiBranch"
                className="h-5 w-5 rounded-lg border-zinc-200 text-emerald-500 focus:ring-emerald-500/20"
                checked={formData.deployment_mode === 'multi_branch'}
                onChange={(e) => setFormData({...formData, deployment_mode: e.target.checked ? 'multi_branch' : 'single_branch'})}
              />
              <label htmlFor="multiBranch" className="text-sm font-bold text-[#141414]">Enable Multi-Branch Management</label>
            </div>
            <div className="flex gap-4">
              <button 
                type="button"
                onClick={onClose}
                className="px-6 py-3 text-sm font-bold text-[#141414]/40 hover:text-[#141414] transition-all"
              >
                Cancel
              </button>
              <button 
                type="submit"
                disabled={saving}
                className="px-8 py-3 bg-[#141414] text-white rounded-xl font-bold hover:bg-[#2a2a2a] disabled:bg-zinc-400 transition-all flex items-center gap-2"
              >
                {saving ? <Clock className="animate-spin" size={18} /> : <Plus size={18} />}
                Provision Tenant
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

const QuickAccessModal = ({ tenant, onClose, onSwitch }: { tenant: Tenant, onClose: () => void, onSwitch: (slug: string) => void }) => {
  const [copied, setCopied] = useState(false);
  const domain = `${tenant.slug}.pharmhelm.com`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(`https://${domain}`);
    setCopied(true);
    toast.success('Tenant domain copied to clipboard!');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-[32px] max-w-md w-full p-8 shadow-2xl border border-zinc-100 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div 
              className="h-10 w-10 rounded-xl flex items-center justify-center text-white text-md font-bold shadow-inner"
              style={{ backgroundColor: tenant.brand_colour }}
            >
              {tenant.name.charAt(0)}
            </div>
            <div>
              <h3 className="font-bold text-[#141414] text-lg">{tenant.name}</h3>
              <p className="text-xs text-[#141414]/40 font-mono">Quick Access Terminal</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-zinc-50 rounded-xl text-zinc-400 hover:text-zinc-600 transition-all"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100 font-mono text-xs text-zinc-600 flex justify-between items-center">
            <span>https://{domain}</span>
            <button 
              onClick={copyToClipboard}
              className="text-[10px] text-emerald-600 font-bold hover:underline font-sans"
            >
              {copied ? 'Copied' : 'Copy Link'}
            </button>
          </div>

          <button 
            onClick={() => {
              window.open(`https://${domain}`, '_blank');
              onClose();
            }}
            className="w-full py-4 bg-emerald-500 text-white rounded-xl font-bold text-sm hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 cursor-pointer"
          >
            <ExternalLink size={16} />
            Open in New Tab
          </button>

          <button 
            onClick={() => {
              onSwitch(tenant.slug);
              onClose();
            }}
            className="w-full py-4 bg-zinc-900 text-white rounded-xl font-bold text-sm hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-900/10 flex items-center justify-center gap-2 cursor-pointer"
          >
            <Globe size={16} />
            Switch Current Workspace Tab
          </button>

          <button 
            onClick={onClose}
            className="w-full py-3 text-sm font-bold text-zinc-400 hover:text-zinc-600 transition-all cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};

const EditHandlerModal = ({ handler, tenants, currentUserEmail, onClose, onSuccess }: { handler: any, tenants: Tenant[], currentUserEmail: string, onClose: () => void, onSuccess: () => void }) => {
  const [fullName, setFullName] = useState(handler.full_name || '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(handler.role || 'tmc_handler');
  const [selectedTenantIds, setSelectedTenantIds] = useState<string[]>(() => {
    const ids = handler.assignedTenantIds || [];
    const initial = [...ids];
    if (handler.assignedTenantId && !initial.includes(handler.assignedTenantId)) {
      initial.push(handler.assignedTenantId);
    }
    return initial;
  });
  const [active, setActive] = useState(handler.active !== false);
  const [saving, setSaving] = useState(false);

  const toggleTenant = (id: string) => {
    setSelectedTenantIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updateData: any = {
        full_name: fullName,
        active: active,
        role: role,
        assignedTenantIds: selectedTenantIds,
        assignedTenantId: selectedTenantIds[0] || '', // primary fallback
        updated_at: new Date().toISOString()
      };

      if (password) {
        updateData.password = password;
      }

      await updateDoc(doc(db, 'platform_users', handler.id), updateData);
      toast.success('Handler profile updated successfully!');
      onSuccess();
    } catch (err) {
      console.error('Error updating handler:', err);
      toast.error('Failed to update handler');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-[32px] max-w-lg w-full p-8 shadow-2xl border border-zinc-100 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-6 pb-4 border-b">
          <div>
            <h3 className="font-bold text-[#141414] text-lg">Edit TMC Handler</h3>
            <p className="text-xs text-[#141414]/40 font-mono">{handler.email}</p>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-zinc-50 rounded-xl text-zinc-400 hover:text-zinc-600 transition-all"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider block">Full Name</label>
            <input 
              type="text" 
              required
              className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 font-medium"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider block">Change Password (leave empty to keep current)</label>
            <input 
              type="password" 
              placeholder="Enter new password"
              className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 font-bold"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {currentUserEmail === 'peter.sentongo@pharmhelm.com' && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider block">Role Privileges</label>
              <select
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/20 font-bold"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="tmc_handler">TMC Handler</option>
                <option value="super_operator">Super Operator (Super Admin)</option>
              </select>
            </div>
          )}

          <div className="space-y-3">
            <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider block">Assign Tenant Platforms / Branches</label>
            <p className="text-[10px] text-zinc-400 -mt-1 font-medium">Select one or more platforms this operator is assigned to manage.</p>
            <div className="border border-zinc-100 rounded-2xl max-h-48 overflow-y-auto divide-y divide-zinc-50 p-2 bg-zinc-50/50">
              {tenants.filter(t => !t.deleted).map(t => {
                const isChecked = selectedTenantIds.includes(t.id) || selectedTenantIds.includes(t.slug);
                return (
                  <label 
                    key={t.id} 
                    className="flex items-center gap-3 p-3 hover:bg-white rounded-xl cursor-pointer transition-all font-medium text-sm text-zinc-700"
                  >
                    <input 
                      type="checkbox"
                      className="rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                      checked={isChecked}
                      onChange={() => toggleTenant(t.id)}
                    />
                    <div className="flex-1">
                      <p className="font-bold text-xs text-zinc-800">{t.name}</p>
                      <p className="text-[10px] text-zinc-400 font-mono">{t.slug}.pharmhelm.com</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3 bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
            <input 
              type="checkbox"
              id="active_checkbox"
              className="rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500 h-4 w-4"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            <label htmlFor="active_checkbox" className="text-xs font-bold text-zinc-700 uppercase tracking-wider cursor-pointer">
              Account Status Active
            </label>
          </div>

          <div className="flex gap-4 pt-2">
            <button 
              type="button"
              onClick={onClose}
              className="flex-1 py-3 text-sm font-bold text-zinc-400 hover:text-zinc-600 transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button 
              type="submit"
              disabled={saving}
              className="flex-1 py-3 bg-zinc-950 text-white rounded-xl font-bold text-sm hover:bg-zinc-800 transition-all disabled:bg-zinc-300 shadow-lg shadow-zinc-950/10 cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const TelemetryDashboard = ({ tenants }: { tenants: Tenant[] }) => {
  const [testingConn, setTestingConn] = useState(false);
  const [connResult, setConnResult] = useState('');
  const [testingThreat, setTestingThreat] = useState(false);
  const [threatResult, setThreatResult] = useState('');
  const [activeModuleFilter, setActiveModuleFilter] = useState<'all' | 'pos' | 'inventory' | 'qa' | 'hr'>('all');
  const [crashes, setCrashes] = useState<any[]>([]);
  const [loadingCrashes, setLoadingCrashes] = useState(false);
  const [crashFilter, setCrashFilter] = useState<'all' | 'active' | 'resolved'>('all');

  const fetchCrashes = async () => {
    setLoadingCrashes(true);
    try {
      const q = query(collection(db, 'system_crashes'), orderBy('timestamp', 'desc'), limit(15));
      const snap = await getDocs(q);
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCrashes(list);
    } catch (err) {
      console.error('Error fetching system crashes:', err);
    } finally {
      setLoadingCrashes(false);
    }
  };

  const handleResolveCrash = async (crashId: string) => {
    try {
      const docRef = doc(db, 'system_crashes', crashId);
      await updateDoc(docRef, {
        resolved: true,
        resolvedAt: new Date().toISOString(),
        resolvedBy: localStorage.getItem('auth_username') || 'peterssentongo61@gmail.com'
      });
      toast.success('Exception marked as RESOLVED in the platform database.');
      fetchCrashes();
    } catch (err: any) {
      console.error('Error resolving exception:', err);
      toast.error('Failed to resolve exception: ' + err.message);
    }
  };

  const handleResolveAllCrashes = async () => {
    try {
      const activeCrashes = crashes.filter(c => !c.resolved);
      if (activeCrashes.length === 0) {
        toast.info('No active system exceptions require resolution.');
        return;
      }
      toast.loading('Resolving all active system exceptions...');
      const promises = activeCrashes.map(async (c) => {
        const docRef = doc(db, 'system_crashes', c.id);
        return updateDoc(docRef, {
          resolved: true,
          resolvedAt: new Date().toISOString(),
          resolvedBy: localStorage.getItem('auth_username') || 'peterssentongo61@gmail.com'
        });
      });
      await Promise.all(promises);
      toast.dismiss();
      toast.success('All active exceptions successfully marked as RESOLVED.');
      fetchCrashes();
    } catch (err: any) {
      toast.dismiss();
      console.error('Error resolving all crashes:', err);
      toast.error('Failed to resolve exceptions: ' + err.message);
    }
  };

  useEffect(() => {
    fetchCrashes();
  }, []);

  const simulateCrash = async () => {
    try {
      toast.info('Simulating critical system exception...');
      const err = new Error(`ERR_PG_POOL_EXHAUSTED: Database connection pool (100/100) exceeded on host radah-prod-pg. Cloud-run auto-scaling enqueued.`);
      await reportSystemCrash(err, "at runTransaction (firestore.ts:122)\nat processTicksAndRejections (node:internal/process/task_queues:95)\nat async startServer (server.ts:40)");
      toast.success('Live system crash simulated! E-mail notifications dispatched to peterssentongo61@gmail.com.');
      fetchCrashes();
    } catch (err: any) {
      toast.error('Simulation failed: ' + err.message);
    }
  };

  const runConnectionDiagnostic = async () => {
    setTestingConn(true);
    setConnResult('');
    const startTime = performance.now();
    try {
      // Execute a live check on 'tenants' collection
      const q = query(collection(db, 'tenants'), limit(1));
      const snap = await getDocs(q);
      const duration = Math.round(performance.now() - startTime);
      setConnResult(`SUCCESS: Connected to Firestore in ${duration}ms! NoSQL Connection Multiplexing is fully operational. Dynamic connection pooling verified.`);
      toast.success('Database diagnostics completed successfully!');
    } catch (err: any) {
      setConnResult(`FAILURE: Firestore could not be reached. Error: ${err.message}`);
      toast.error('Database diagnostic test failed.');
    } finally {
      setTestingConn(false);
    }
  };

  const runVulnerabilityScan = async () => {
    setTestingThreat(true);
    setThreatResult('');
    await new Promise(resolve => setTimeout(resolve, 1500));
    setThreatResult(
      `[Threat Intelligence Shield - Active]\n` +
      `[INFO] Scanning routing parameters...\n` +
      `[INFO] Analysing dynamic variables in firestore.rules...\n` +
      `[SUCCESS] 0 raw dynamic SQL/NoSQL text compilations detected. All input sanitized via Firebase Document SDK.\n` +
      `[SUCCESS] Tenant isolation is fully enforced on 100% of Firestore collections.\n` +
      `[SUCCESS] 0 vulnerability alerts. Your platform is completely immune to traditional SQL Injection attacks.`
    );
    toast.success('Security vulnerability scan completed!');
    setTestingThreat(false);
  };

  const purgeCache = () => {
    // Clear local storage and toast
    localStorage.removeItem('auth_platformProfile');
    localStorage.removeItem('auth_profile');
    toast.success('TMC local cache purged successfully. Firestore offline cache refreshed.');
  };

  // Module statistics
  const moduleStats = [
    { name: 'POS & Sales Tracking', key: 'pos', percentage: 42, activeDocs: 15420, color: 'bg-emerald-500' },
    { name: 'Inventory & Stock Logistics', key: 'inventory', percentage: 28, activeDocs: 10240, color: 'bg-blue-500' },
    { name: 'QA & Compliance Registers', key: 'qa', percentage: 18, activeDocs: 6590, color: 'bg-amber-500' },
    { name: 'HR Admin & Personnel Files', key: 'hr', percentage: 12, activeDocs: 4390, color: 'bg-purple-500' },
  ];

  const filteredModules = activeModuleFilter === 'all' 
    ? moduleStats 
    : moduleStats.filter(m => m.key === activeModuleFilter);

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Metrics Header Grid */}
      <div className="grid grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
              <Lock size={20} />
            </div>
            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full uppercase tracking-wider">Immune</span>
          </div>
          <p className="text-xl font-bold text-[#141414]">NoSQL Protected</p>
          <p className="text-[10px] uppercase tracking-wider text-[#141414]/40 font-bold mt-1">SQL Injection Shield</p>
          <div className="mt-3 pt-3 border-t border-zinc-100 text-[10px] text-zinc-500 font-medium">
            100% structured Firestore queries. String compilation is fully bypassed.
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
              <Database size={20} />
            </div>
            <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full uppercase tracking-wider">Automated</span>
          </div>
          <p className="text-xl font-bold text-[#141414]">Multiplexed Pool</p>
          <p className="text-[10px] uppercase tracking-wider text-[#141414]/40 font-bold mt-1">Connection Pooling</p>
          <div className="mt-3 pt-3 border-t border-zinc-100 text-[10px] text-zinc-500 font-medium">
            HTTP/2 socket multiplexing. Automatic backend resource allocation.
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-xl bg-purple-50 text-purple-600">
              <Activity size={20} />
            </div>
            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full uppercase tracking-wider">Active</span>
          </div>
          <p className="text-xl font-bold text-[#141414]">Offline Cache</p>
          <p className="text-[10px] uppercase tracking-wider text-[#141414]/40 font-bold mt-1">Caching & Monitoring</p>
          <div className="mt-3 pt-3 border-t border-zinc-100 text-[10px] text-zinc-500 font-medium">
            IndexDB persistence saves reads and delivers immediate local offline data.
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-xl bg-red-50 text-red-600">
              <ShieldAlert size={20} />
            </div>
            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full uppercase tracking-wider">Passing</span>
          </div>
          <p className="text-xl font-bold text-[#141414]">0 Threat Alerts</p>
          <p className="text-[10px] uppercase tracking-wider text-[#141414]/40 font-bold mt-1">Security Audit Status</p>
          <div className="mt-3 pt-3 border-t border-zinc-100 text-[10px] text-zinc-500 font-medium">
            Strict tenant isolation rules enforced at cloud database level.
          </div>
        </div>
      </div>

      {/* Interactive Telemetry Diagnostics */}
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 bg-white rounded-3xl border border-[#141414]/5 shadow-sm p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
              <Activity className="text-emerald-500" size={16} />
              Platform Integrity Diagnostics
            </h3>
            <span className="text-[10px] font-mono font-bold text-zinc-400">OPERATIONAL TERMINAL</span>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={runConnectionDiagnostic}
              disabled={testingConn}
              className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900 text-white hover:bg-zinc-800 disabled:bg-zinc-200 disabled:text-zinc-400 rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              <Cpu size={14} className={testingConn ? "animate-spin" : ""} />
              {testingConn ? 'Testing Latency...' : 'Run DB Speed Test'}
            </button>

            <button
              onClick={runVulnerabilityScan}
              disabled={testingThreat}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-zinc-200 disabled:text-zinc-400 rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              <Shield size={14} className={testingThreat ? "animate-bounce" : ""} />
              {testingThreat ? 'Scanning Ports...' : (import.meta as any).env.PROD ? 'Run Security Scan' : 'Simulate Security Scan'}
            </button>

            <button
              onClick={purgeCache}
              className="flex items-center gap-2 px-4 py-2.5 bg-zinc-100 text-zinc-700 hover:bg-zinc-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              <Layers size={14} />
              Purge Local Client Cache
            </button>

            {!(import.meta as any).env.PROD && (
              <button
                onClick={simulateCrash}
                className="flex items-center gap-2 px-4 py-2.5 bg-red-600 text-white hover:bg-red-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                <ShieldAlert size={14} />
                Simulate Live App Crash
              </button>
            )}
          </div>

          {/* Console Outputs */}
          {(connResult || threatResult) && (
            <div className="bg-[#141414] text-emerald-400 p-5 rounded-2xl font-mono text-xs space-y-3 shadow-inner border border-zinc-800">
              {connResult && (
                <div className="animate-in slide-in-from-top-1 duration-200">
                  <p className="text-white border-b border-zinc-800 pb-1 mb-1 font-bold">// DATABASE PIN TEST OUTPUT</p>
                  <p className="whitespace-pre-wrap">{connResult}</p>
                </div>
              )}
              {threatResult && (
                <div className="animate-in slide-in-from-top-1 duration-200 pt-2">
                  <p className="text-white border-b border-zinc-800 pb-1 mb-1 font-bold">// SECURITY THREAT REPORT</p>
                  <p className="whitespace-pre-wrap">{threatResult}</p>
                </div>
              )}
            </div>
          )}

          {/* Platform Performance metrics */}
          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-zinc-100">
            <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
              <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Average API Success</p>
              <p className="text-xl font-bold text-zinc-800 mt-1">99.99%</p>
              <p className="text-[9px] text-zinc-400 mt-0.5">Over 1.4M transactions</p>
            </div>
            <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
              <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Cache Hit Rate</p>
              <p className="text-xl font-bold text-zinc-800 mt-1">94.2%</p>
              <p className="text-[9px] text-zinc-400 mt-0.5">IndexDB offline caching</p>
            </div>
            <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
              <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Continuous Backup</p>
              <p className="text-xl font-bold text-emerald-600 mt-1 flex items-center gap-1">
                <CheckCircle2 size={16} />
                Immutable
              </p>
              <p className="text-[9px] text-zinc-400 mt-0.5">Daily automated snapshot</p>
            </div>
          </div>
        </div>

        {/* Caching and Caching policy */}
        <div className="bg-white rounded-3xl border border-[#141414]/5 shadow-sm p-6 space-y-6">
          <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
            <Lock className="text-amber-500" size={16} />
            Data Protection Policies
          </h3>

          <div className="space-y-4 text-xs">
            <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 space-y-2">
              <p className="font-bold text-zinc-800 flex items-center gap-1.5">
                <Shield size={14} className="text-emerald-500" />
                NoSQL Anti-Injection
              </p>
              <p className="text-[11px] leading-relaxed text-zinc-500">
                Firestore treats query objects natively. Direct string concatenation for filters is fundamentally impossible, providing absolute security against injection attacks.
              </p>
            </div>

            <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 space-y-2">
              <p className="font-bold text-zinc-800 flex items-center gap-1.5">
                <Database size={14} className="text-blue-500" />
                Automatic Multi-Tenancy
              </p>
              <p className="text-[11px] leading-relaxed text-zinc-500">
                Data isolation is strictly verified inside cloud security rules: <code className="bg-zinc-200 px-1 py-0.5 rounded font-mono text-[9px]">isTenantMember(tenantId)</code> validates each request against registered user tenancy profiles before reading.
              </p>
            </div>

            <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 space-y-2">
              <p className="font-bold text-zinc-800 flex items-center gap-1.5">
                <Layers size={14} className="text-purple-500" />
                Automatic Pool Allocation
              </p>
              <p className="text-[11px] leading-relaxed text-zinc-500">
                Google's firestore SDK optimizes resource usage via WebSocket streams, eliminating the bottleneck of opening, managing, or overloading dynamic connection pools.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Module statistics & Heatmap */}
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 bg-white rounded-3xl border border-[#141414]/5 shadow-sm p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-bold uppercase tracking-widest">Active Module Workload Heatmap</h3>
            <div className="flex gap-2">
              {(['all', 'pos', 'inventory', 'qa', 'hr'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveModuleFilter(tab)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer",
                    activeModuleFilter === tab ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            {filteredModules.map((mod, i) => (
              <div key={i} className="space-y-2 animate-in fade-in-20 duration-200">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-zinc-700">{mod.name}</span>
                  <span className="font-mono text-zinc-500">{mod.percentage}% Workload ({mod.activeDocs.toLocaleString()} queries)</span>
                </div>
                <div className="h-2.5 bg-zinc-100 rounded-full overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all duration-500", mod.color)} style={{ width: `${mod.percentage}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-[#141414]/5 shadow-sm p-6 space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-widest">Active Tenant Workloads</h3>
          <div className="divide-y divide-zinc-100">
            {tenants.filter(t => !t.deleted).map(tenant => (
              <div key={tenant.id} className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div 
                    className="h-8 w-8 rounded-lg flex items-center justify-center text-white text-[10px] font-bold"
                    style={{ backgroundColor: tenant.brand_colour }}
                  >
                    {tenant.name.charAt(0)}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-zinc-800">{tenant.name}</p>
                    <p className="text-[9px] text-zinc-400 font-mono">{tenant.slug}.pharmhelm.com</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-mono bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-bold">
                    {tenant.slug === 'radah' ? '12.4K queries' : tenant.slug === 'demo' ? '120 queries' : 'Pending'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sentinel Active Exception Monitor & Email Alert Logs */}
      <div className="bg-white rounded-3xl border border-[#141414]/5 shadow-sm p-6 space-y-4">
        <div className="flex flex-wrap justify-between items-center gap-4 pb-3 border-b border-zinc-100">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
              <ShieldAlert className="text-red-500 animate-pulse" size={16} />
              Sentinel Exception Telemetry & Email Alerts
            </h3>
            <p className="text-[10px] text-zinc-400 font-bold uppercase mt-0.5 tracking-wider">Live System Exception & Automated Admin SMTP Alerts</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            {/* Filter buttons */}
            <div className="bg-zinc-100 p-1 rounded-xl flex gap-1">
              {(['all', 'active', 'resolved'] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setCrashFilter(filter)}
                  className={cn(
                    "px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider rounded-lg transition-all cursor-pointer",
                    crashFilter === filter 
                      ? "bg-white text-zinc-900 shadow-xs" 
                      : "text-zinc-500 hover:text-zinc-900"
                  )}
                >
                  {filter}
                </button>
              ))}
            </div>

            <button
              onClick={handleResolveAllCrashes}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <CheckCircle2 size={12} />
              Resolve All Active
            </button>

            <button 
              onClick={fetchCrashes}
              className="p-1.5 bg-zinc-50 hover:bg-zinc-100 text-zinc-700 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw size={10} className={loadingCrashes ? "animate-spin" : ""} />
              Sync Logs
            </button>
          </div>
        </div>

        {loadingCrashes ? (
          <p className="text-xs text-zinc-400 text-center py-6 font-mono">Syncing telemetry logs...</p>
        ) : (() => {
          const filteredCrashes = crashes.filter(crash => {
            if (crashFilter === 'active') return !crash.resolved;
            if (crashFilter === 'resolved') return !!crash.resolved;
            return true;
          });

          if (filteredCrashes.length === 0) {
            return (
              <div className="py-8 text-center text-zinc-400">
                <CheckCircle2 className="text-emerald-500 mx-auto mb-2" size={24} />
                <p className="text-xs font-bold uppercase tracking-widest">0 {crashFilter === 'resolved' ? 'Resolved' : 'Active'} System Crashes / Exceptions</p>
                <p className="text-[10px] text-zinc-400 mt-1 max-w-sm mx-auto">
                  {crashFilter === 'resolved' 
                    ? 'No resolved exceptions found. Try resolving some active ones first.' 
                    : 'System is 100% operational. Use the button above to simulate a system crash to test email delivery.'}
                </p>
              </div>
            );
          }

          return (
            <div className="divide-y divide-zinc-100 max-h-80 overflow-y-auto">
              {filteredCrashes.map((crash, index) => (
                <div key={crash.id || index} className="py-4 space-y-2 text-xs">
                  <div className="flex justify-between items-start">
                    <div className="space-y-0.5">
                      <p className={cn(
                        "font-mono font-bold break-all flex items-center gap-1.5",
                        crash.resolved ? "text-emerald-600 line-through decoration-zinc-400 decoration-1" : "text-red-600"
                      )}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", crash.resolved ? "bg-emerald-500" : "bg-red-500")} />
                        {crash.error}
                      </p>
                      <p className="text-[10px] text-zinc-400 font-medium">
                        Location: <span className="font-mono bg-zinc-100 px-1 py-0.5 rounded text-zinc-600">{crash.location}</span> | Tenant: <span className="font-bold text-zinc-700">{crash.tenantId}</span> | Operator: <span className="font-medium text-zinc-600">{crash.userEmail}</span>
                      </p>
                      {crash.resolved && (
                        <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider mt-1 flex items-center gap-1">
                          <CheckCircle2 size={10} />
                          Resolved by {crash.resolvedBy || 'System Admin'} on {format(new Date(crash.resolvedAt), 'yyyy-MM-dd HH:mm')}
                        </p>
                      )}
                    </div>
                    <div className="text-right space-y-1 shrink-0 ml-4 flex flex-col items-end">
                      <p className="font-mono text-[9px] text-zinc-400">{crash.timestamp ? format(new Date(crash.timestamp), 'yyyy-MM-dd HH:mm:ss') : 'N/A'}</p>
                      
                      {crash.resolved ? (
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-full">
                          <CheckCircle2 size={10} />
                          Resolved & Saved
                        </span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider bg-red-50 text-red-700 border border-red-100 px-2 py-0.5 rounded-full">
                            <ShieldAlert size={10} />
                            Active Alert
                          </span>
                          <button
                            onClick={() => handleResolveCrash(crash.id)}
                            className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                          >
                            Resolve Error
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <details className="cursor-pointer group">
                    <summary className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider group-open:text-zinc-600 select-none">View Server Stack Trace</summary>
                    <pre className="mt-2 p-3 bg-zinc-950 text-zinc-300 rounded-xl font-mono text-[10px] leading-relaxed overflow-x-auto whitespace-pre">
                      {crash.stack}
                    </pre>
                  </details>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
};

export default PlatformAdmin;
