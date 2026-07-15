import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User, signInWithPopup, signOut, AuthError, signInAnonymously, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, getDocs, query, where, writeBatch, onSnapshot, addDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from '../firebase';
import { Staff, Branch, SystemSettings, PlatformUser } from '../types';
import { toast } from 'sonner';
import { useTenant } from './TenantContext';
import { sanitizeInput } from '../utils/sanitize';

export interface ModulePermission {
  access: 'none' | 'view' | 'operate' | 'all';
}

export interface RolePermissions {
  sales: ModulePermission;
  inventory: ModulePermission;
  clients: ModulePermission;
  stock: ModulePermission;
  procurement: ModulePermission;
  finance: ModulePermission;
  qa: ModulePermission;
  hr: ModulePermission;
  welfare: ModulePermission;
  predictive: ModulePermission;
  analytics: ModulePermission;
  marketing: ModulePermission;
  settings: ModulePermission;
}

export const ROLE_REGISTRY: Record<string, RolePermissions> = {
  owner: {
    sales: { access: 'all' },
    inventory: { access: 'all' },
    clients: { access: 'all' },
    stock: { access: 'all' },
    procurement: { access: 'all' },
    finance: { access: 'all' },
    qa: { access: 'all' },
    hr: { access: 'all' },
    welfare: { access: 'all' },
    predictive: { access: 'all' },
    analytics: { access: 'all' },
    marketing: { access: 'all' },
    settings: { access: 'all' }
  },
  CEO: {
    sales: { access: 'all' },
    inventory: { access: 'all' },
    clients: { access: 'all' },
    stock: { access: 'all' },
    procurement: { access: 'all' },
    finance: { access: 'all' },
    qa: { access: 'all' },
    hr: { access: 'all' },
    welfare: { access: 'all' },
    predictive: { access: 'all' },
    analytics: { access: 'all' },
    marketing: { access: 'all' },
    settings: { access: 'all' }
  },
  admin: {
    sales: { access: 'operate' },
    inventory: { access: 'operate' },
    clients: { access: 'operate' },
    stock: { access: 'operate' },
    procurement: { access: 'view' },
    finance: { access: 'view' },
    qa: { access: 'operate' },
    hr: { access: 'none' },
    welfare: { access: 'all' },
    predictive: { access: 'view' },
    analytics: { access: 'view' },
    marketing: { access: 'view' },
    settings: { access: 'operate' }
  },
  pharmacist: {
    sales: { access: 'operate' },
    inventory: { access: 'operate' },
    clients: { access: 'operate' },
    stock: { access: 'operate' },
    procurement: { access: 'none' },
    finance: { access: 'none' },
    qa: { access: 'operate' },
    hr: { access: 'none' },
    welfare: { access: 'all' },
    predictive: { access: 'none' },
    analytics: { access: 'none' },
    marketing: { access: 'none' },
    settings: { access: 'none' }
  },
  cashier: {
    sales: { access: 'operate' },
    inventory: { access: 'view' },
    clients: { access: 'operate' },
    stock: { access: 'none' },
    procurement: { access: 'none' },
    finance: { access: 'none' },
    qa: { access: 'none' },
    hr: { access: 'none' },
    welfare: { access: 'all' },
    predictive: { access: 'none' },
    analytics: { access: 'none' },
    marketing: { access: 'none' },
    settings: { access: 'none' }
  },
  'IT Head': {
    sales: { access: 'all' },
    inventory: { access: 'all' },
    clients: { access: 'all' },
    stock: { access: 'all' },
    procurement: { access: 'all' },
    finance: { access: 'all' },
    qa: { access: 'all' },
    hr: { access: 'all' },
    welfare: { access: 'all' },
    predictive: { access: 'all' },
    analytics: { access: 'all' },
    marketing: { access: 'all' },
    settings: { access: 'all' }
  },
  'Marketing Head': {
    sales: { access: 'view' },
    inventory: { access: 'view' },
    clients: { access: 'all' },
    stock: { access: 'none' },
    procurement: { access: 'none' },
    finance: { access: 'none' },
    qa: { access: 'none' },
    hr: { access: 'none' },
    welfare: { access: 'all' },
    predictive: { access: 'none' },
    analytics: { access: 'view' },
    marketing: { access: 'all' },
    settings: { access: 'none' }
  },
  'Marketing Personnel': {
    sales: { access: 'view' },
    inventory: { access: 'none' },
    clients: { access: 'view' },
    stock: { access: 'none' },
    procurement: { access: 'none' },
    finance: { access: 'none' },
    qa: { access: 'none' },
    hr: { access: 'none' },
    welfare: { access: 'all' },
    predictive: { access: 'none' },
    analytics: { access: 'none' },
    marketing: { access: 'operate' },
    settings: { access: 'none' }
  },
  'HR Head': {
    sales: { access: 'none' },
    inventory: { access: 'none' },
    clients: { access: 'none' },
    stock: { access: 'none' },
    procurement: { access: 'none' },
    finance: { access: 'none' },
    qa: { access: 'none' },
    hr: { access: 'all' },
    welfare: { access: 'all' },
    predictive: { access: 'none' },
    analytics: { access: 'none' },
    marketing: { access: 'none' },
    settings: { access: 'none' }
  }
};

interface AuthContextType {
  user: User | null;
  profile: Staff | null;
  platformProfile: PlatformUser | null;
  loading: boolean;
  signingIn: boolean;
  activeBranchId: string | null;
  activeBranch: Branch | null;
  tenantId: string | null;
  multiBranchMode: boolean;
  assignedBranches: Branch[];
  permissions: RolePermissions | null;
  hasPermission: (module: keyof RolePermissions, requiredLevel?: 'view' | 'operate' | 'all') => boolean;
  setActiveBranchId: (id: string) => void;
  signIn: (username?: string, password?: string) => Promise<void>;
  signInWithBypass: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { tenant, isPlatformAdmin, loading: tenantLoading, error: tenantError } = useTenant();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Staff | null>(null);
  const [platformProfile, setPlatformProfile] = useState<PlatformUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(localStorage.getItem('activeBranchId'));
  const [activeBranch, setActiveBranch] = useState<Branch | null>(null);
  const [multiBranchMode, setMultiBranchMode] = useState(false);
  const [assignedBranches, setAssignedBranches] = useState<Branch[]>([]);
  const [permissions, setPermissions] = useState<RolePermissions | null>(null);

  const hasPermission = (module: keyof RolePermissions, requiredLevel: 'view' | 'operate' | 'all' = 'view') => {
    if (!permissions) return false;
    const userAccess = permissions[module]?.access || 'none';
    if (userAccess === 'all') return true;
    if (requiredLevel === 'view') {
      return userAccess === 'view' || userAccess === 'operate';
    }
    if (requiredLevel === 'operate') {
      return userAccess === 'operate';
    }
    return false;
  };

  const seedDemoData = async (tenantId: string, userId: string) => {
    const branchesRef = collection(db, 'branches');
    const q = query(branchesRef, where('tenantId', '==', tenantId));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      const batch = writeBatch(db);
      const demoBranches = [
        { id: 'brn_main', name: 'Radah Main Branch', type: 'Branch', branch_code: 'BRN-001', address: 'Kampala Central', phone: '+256 700 000 001', status: 'Active', tenantId, created_at: new Date().toISOString(), created_by: userId },
        { id: 'brn_kawempe', name: 'Radah Kawempe Branch', type: 'Branch', branch_code: 'BRN-002', address: 'Kawempe Division', phone: '+256 700 000 002', status: 'Active', tenantId, created_at: new Date().toISOString(), created_by: userId },
        { id: 'brn_hq', name: 'Radah HQ & Store', type: 'HQ', branch_code: 'BRN-003', address: 'Industrial Area', phone: '+256 700 000 003', status: 'Active', tenantId, created_at: new Date().toISOString(), created_by: userId },
      ];

      demoBranches.forEach(b => {
        batch.set(doc(db, 'branches', b.id), b);
      });

      // Update user with assigned branches
      const staffRef = doc(db, 'staff', userId);
      batch.update(staffRef, {
        assigned_branches: demoBranches.map(b => b.id),
        default_branch_id: null
      });

      // Ensure multi-branch mode is ON for demo
      const settingsRef = doc(db, 'system_settings', tenantId);
      batch.set(settingsRef, {
        tenantId,
        multiBranchMode: true,
        updatedAt: new Date().toISOString(),
        updatedBy: userId
      }, { merge: true });

      await batch.commit();
      return demoBranches;
    }
    return snapshot.docs.map(d => d.data() as Branch);
  };

  useEffect(() => {
    const userEmail = localStorage.getItem('auth_bypass_email') || user?.email;
    if (userEmail === 'peterssentongo61@gmail.com' && tenantError?.includes('not found')) {
      const runSeed = async () => {
        const { seedInitialData } = await import('../services/seedService');
        await seedInitialData();
        // Refresh to re-detect tenant
        window.location.reload();
      };
      runSeed();
    }
  }, [user, tenantError]);

  const updateActiveBranch = (branches: Branch[], isMultiBranch: boolean, currentProfile: Staff) => {
    if (branches.length > 0) {
      if (!isMultiBranch) {
        const firstB = branches[0];
        setActiveBranchId(firstB.id);
        setActiveBranch(firstB);
        localStorage.setItem('activeBranchId', firstB.id);
        return;
      }

      const isPrimaryAdmin = currentProfile.username.startsWith('admin.');
      
      if (isPrimaryAdmin) {
        const hqBranch = branches.find(br => br.type === 'HQ' || br.branch_code === 'HQ-001') || branches[0];
        setActiveBranchId(hqBranch.id);
        setActiveBranch(hqBranch);
        localStorage.setItem('activeBranchId', hqBranch.id);
      } else {
        const assignedIds = currentProfile.assigned_branches || [];
        if (assignedIds.length === 1) {
          const b = branches.find(br => br.id === assignedIds[0]);
          if (b) {
            setActiveBranchId(b.id);
            setActiveBranch(b);
            localStorage.setItem('activeBranchId', b.id);
          } else {
            const fallback = branches[0];
            setActiveBranchId(fallback.id);
            setActiveBranch(fallback);
            localStorage.setItem('activeBranchId', fallback.id);
          }
        } else if (assignedIds.length > 1) {
          const savedBranchId = localStorage.getItem('activeBranchId');
          const b = branches.find(br => br.id === savedBranchId && assignedIds.includes(br.id));
          if (b) {
            setActiveBranchId(b.id);
            setActiveBranch(b);
          } else {
            setActiveBranchId(null);
            setActiveBranch(null);
            localStorage.removeItem('activeBranchId');
          }
        } else {
          const fallback = branches.find(br => br.type === 'HQ') || branches[0];
          setActiveBranchId(fallback.id);
          setActiveBranch(fallback);
          localStorage.setItem('activeBranchId', fallback.id);
        }
      }
    }
  };

  useEffect(() => {
    if (tenantLoading) return;

    const unsubscribe = onAuthStateChanged(auth, async (incomingUser) => {
      try {
        setUser(incomingUser);
        if (incomingUser) {
          const userEmail = incomingUser.email || '';

          if (isPlatformAdmin) {
            // Platform Admin (TMC) Logic
            const docRef = doc(db, 'platform_users', incomingUser.uid);
            let docSnap = await getDoc(docRef);
            
            let platformProfileData: PlatformUser | null = null;
            if (docSnap.exists()) {
              platformProfileData = docSnap.data() as PlatformUser;
            } else if (userEmail) {
              const cleanEmail = userEmail.toLowerCase().trim();
              const q = query(
                collection(db, 'platform_users'),
                where('email', '==', cleanEmail)
              );
              const snap = await getDocs(q);
              if (!snap.empty) {
                platformProfileData = { id: snap.docs[0].id, ...snap.docs[0].data() } as PlatformUser;
                // Auto-link Auth UID in Firestore for faster future lookups
                try {
                  await setDoc(docRef, { ...platformProfileData, active: true }, { merge: true });
                } catch (e) {
                  console.warn("Could not link platform user Auth UID:", e);
                }
              } else if (
                cleanEmail === 'peterssentongo61@gmail.com' ||
                cleanEmail === 'peter.sentongo@pharmhelm.com' ||
                cleanEmail === 'peter.sentong@pharmhelm.com' ||
                cleanEmail === 'peter.sentongo@pharmhelm'
              ) {
                // Auto-provision Super Admin platform user for Peter
                const newPlatformUser: PlatformUser = {
                  id: incomingUser.uid,
                  full_name: 'Peter Sentongo (Super Admin)',
                  name: 'Peter Sentongo',
                  email: cleanEmail,
                  role: 'super_operator',
                  active: true,
                  created_at: new Date().toISOString()
                };
                try {
                  await setDoc(docRef, newPlatformUser);
                  platformProfileData = newPlatformUser;
                } catch (e) {
                  console.warn("Could not auto-provision platform user:", e);
                }
              }
            }

            if (platformProfileData && platformProfileData.active) {
              setPlatformProfile(platformProfileData);
              localStorage.setItem('auth_platformProfile', JSON.stringify(platformProfileData));
              setProfile(null);
              setLoading(false);
              return;
            }
            toast.error('Unauthorized: Not an active platform administrator.');
            await signOut(auth);
            setLoading(false);
            return;
          }

          // Tenant Logic
          if (!tenant) {
            setLoading(false);
            return;
          }

          let currentProfile: Staff | null = null;

          // Check if user is platform administrator accessing this tenant
          let isSuperOperator = false;
          let isTmcHandler = false;
          let handlerAssignedTenants: string[] = [];
          let platformUserFullname = '';

          try {
            const platformUserQuery = query(
              collection(db, 'platform_users'),
              where('email', '==', userEmail.toLowerCase().trim())
            );
            const platformUserSnap = await getDocs(platformUserQuery);
            if (!platformUserSnap.empty) {
              const pData = platformUserSnap.docs[0].data() as PlatformUser;
              platformUserFullname = pData.full_name;
              if (pData.role === 'super_operator' || pData.role === 'super_admin') {
                isSuperOperator = true;
              } else if (pData.role === 'tmc_handler') {
                isTmcHandler = true;
                const assignedIds = pData.assignedTenantIds || [];
                if (pData.assignedTenantId && !assignedIds.includes(pData.assignedTenantId)) {
                  assignedIds.push(pData.assignedTenantId);
                }
                handlerAssignedTenants = assignedIds;
              }
            }
          } catch (e) {
            console.warn("Could not check platform admin profile:", e);
          }

          const hasAccessAsPlatformUser = isSuperOperator || (isTmcHandler && (handlerAssignedTenants.includes(tenant.id) || handlerAssignedTenants.includes(tenant.slug)));

          if (hasAccessAsPlatformUser) {
            const operatorProfile: Staff = {
              id: incomingUser.uid,
              uid: incomingUser.uid,
              tenantId: tenant.id,
              username: incomingUser.email ? incomingUser.email.split('@')[0] : 'platform_operator',
              password_set: true,
              branch_id: '',
              assigned_branches: [],
              default_branch_id: null,
              email: userEmail,
              displayName: platformUserFullname || 'Platform Administrator',
              full_name: platformUserFullname || 'Platform Administrator',
              phone_number: '',
              role: 'owner',
              status: 'active',
              active: true,
              created_at: new Date().toISOString()
            };
            currentProfile = operatorProfile;
            
            try {
              await setDoc(doc(db, 'staff', incomingUser.uid), operatorProfile, { merge: true });
            } catch (e) {
              console.warn("Could not write bypass profile to Firestore:", e);
            }
          } else {
            // Post-Login Tenant & Subscription Guard
            try {
              const idTokenResult = await incomingUser.getIdTokenResult();
              const tokenTenantId = idTokenResult.claims.tenantId;
              
              if (tokenTenantId && tokenTenantId !== tenant.id) {
                toast.error("Access Denied: This account does not belong to this pharmacy.");
                await signOut(auth);
                setLoading(false);
                return;
              }

              // Validate subscription status
              const subStatus = tenant.subscription_status || 'inactive';
              const subEnd = tenant.subscription_end ? new Date(tenant.subscription_end) : null;
              const isSubExpired = subEnd ? subEnd < new Date() : true;

              if (subStatus !== 'active') {
                toast.error("Access Denied: Subscription not yet activated.");
                await signOut(auth);
                setLoading(false);
                return;
              }
              if (isSubExpired) {
                toast.error("Access Denied: Subscription expired.");
                await signOut(auth);
                setLoading(false);
                return;
              }
            } catch (e) {
              console.warn("Could not check custom claims/subscription:", e);
            }

            // Standard Tenant Staff
            const staffDocRef = doc(db, 'staff', incomingUser.uid);
            const staffSnap = await getDoc(staffDocRef);
            if (staffSnap.exists()) {
              const staffData = staffSnap.data() as Staff;
              if (staffData.tenantId === tenant.id && (staffData.status === 'active' || staffData.active)) {
                currentProfile = { ...staffData, id: staffSnap.id };
              } else {
                toast.error('Access denied: Staff account inactive or not assigned to this workspace.');
                await signOut(auth);
                setLoading(false);
                return;
              }
            } else if (userEmail) {
              // Try email-based query or authEmail query if UID not matched directly
              // Note: tenantId filter is removed to allow query execution before UID linkage under firestore rules
              let qStaff = query(
                collection(db, 'staff'),
                where('authEmail', '==', userEmail.toLowerCase().trim())
              );
              let snapStaff = await getDocs(qStaff);
              if (snapStaff.empty) {
                qStaff = query(
                  collection(db, 'staff'),
                  where('email', '==', userEmail.toLowerCase().trim())
                );
                snapStaff = await getDocs(qStaff);
              }
              if (snapStaff.empty) {
                // Try username matching the entered login identifier format (e.g. admin.mp.pharmhelm.com)
                const parts = userEmail.split('@');
                const handle = parts[0];
                const acronym = tenant.acronym ? tenant.acronym.toLowerCase().trim() : (tenant.slug || 'radah');
                const fullUsername = `admin.${acronym}.pharmhelm.com`;
                qStaff = query(
                  collection(db, 'staff'),
                  where('username', '==', fullUsername)
                );
                snapStaff = await getDocs(qStaff);
              }
              // Verify tenantId membership client-side
              const matchedDocs = snapStaff.docs.filter(d => (d.data() as Staff).tenantId === tenant.id);
              if (matchedDocs.length > 0) {
                const staffDocMatched = matchedDocs[0];
                const staffData = staffDocMatched.data() as Staff;
                if (staffData.status === 'active' || staffData.active) {
                  currentProfile = { ...staffData, id: staffDocMatched.id };
                  // Link Auth UID in Firestore for faster future lookups
                  try {
                    await setDoc(doc(db, 'staff', incomingUser.uid), { ...staffData, id: incomingUser.uid, uid: incomingUser.uid }, { merge: true });
                  } catch (e) {
                    console.warn("Could not link staff UID:", e);
                  }
                }
              }
            }

            if (!currentProfile) {
              toast.error('Unauthorized: No staff profile found.');
              await signOut(auth);
              setLoading(false);
              return;
            }
          }

          if (currentProfile) {
            setProfile(currentProfile);
            localStorage.setItem('auth_profile', JSON.stringify(currentProfile));
            setPlatformProfile(null);

            // Inject permissions based on Role Registry schema definitions (merging primary and secondary roles)
            const primaryRole = currentProfile.role || 'staff';
            const secondaryRolesList = currentProfile.secondaryRoles || [];
            const allUserRoles = [primaryRole, ...secondaryRolesList];

            const mergedPerms: RolePermissions = {
              sales: { access: 'none' },
              inventory: { access: 'none' },
              clients: { access: 'none' },
              stock: { access: 'none' },
              procurement: { access: 'none' },
              finance: { access: 'none' },
              qa: { access: 'none' },
              hr: { access: 'none' },
              welfare: { access: 'all' },
              predictive: { access: 'none' },
              analytics: { access: 'none' },
              marketing: { access: 'none' },
              settings: { access: 'none' }
            };

            const accessPriority: Record<string, number> = { none: 0, view: 1, operate: 2, all: 3 };

            allUserRoles.forEach(role => {
              const registryKey = Object.keys(ROLE_REGISTRY).find(k => k.toLowerCase() === role.toLowerCase()) || role;
              const rolePerms = ROLE_REGISTRY[registryKey];
              if (rolePerms) {
                Object.keys(rolePerms).forEach(modKey => {
                  const module = modKey as keyof RolePermissions;
                  const currentAccess = mergedPerms[module]?.access || 'none';
                  const roleAccess = rolePerms[module]?.access || 'none';
                  if (accessPriority[roleAccess] > accessPriority[currentAccess]) {
                    mergedPerms[module] = { access: roleAccess };
                  }
                });
              }
            });

            // Specific request: give CEO, Owner, and Admin roles access everywhere in the system
            const hasCeoRole = allUserRoles.some(role => {
              const r = role.toLowerCase();
              return r === 'ceo' || r === 'ceo / md' || r === 'owner' || r === 'admin';
            });
            if (hasCeoRole) {
              Object.keys(mergedPerms).forEach(modKey => {
                const module = modKey as keyof RolePermissions;
                mergedPerms[module] = { access: 'all' };
              });
            }

            setPermissions(mergedPerms);

            // Load settings
            let isMultiBranch = false;
            try {
              const settingsSnap = await getDoc(doc(db, 'system_settings', currentProfile.tenantId));
              const settings = settingsSnap.data();
              isMultiBranch = settings?.multiBranchMode || false;
            } catch (e) {
              console.warn("Failed to fetch system settings:", e);
            }
            setMultiBranchMode(isMultiBranch);

            // Fetch branches
            const allRoles = [currentProfile.role || 'staff', ...(currentProfile.secondaryRoles || [])];
            const isAllBranchRole = allRoles.some(r => ['owner', 'CEO', 'CEO / MD', 'IT Head', 'IT Support Staff', 'admin', 'Marketing Head', 'Marketing Personnel'].includes(r));
            if (isAllBranchRole) {
              const bSnap = await getDocs(query(collection(db, 'branches'), where('tenantId', '==', tenant.id)));
              const branches = bSnap.docs.map(d => ({ ...d.data(), id: d.id } as Branch));
              setAssignedBranches(branches);
              updateActiveBranch(branches, isMultiBranch, currentProfile);
            } else {
              const bSnap = await getDocs(query(collection(db, 'branches'), where('tenantId', '==', tenant.id)));
              const allBranches = bSnap.docs.map(d => ({ ...d.data(), id: d.id } as Branch));
              const filtered = allBranches.filter(b => currentProfile!.assigned_branches?.includes(b.id));
              setAssignedBranches(filtered);
              updateActiveBranch(filtered, isMultiBranch, currentProfile);
            }
          }
        } else {
          setProfile(null);
          setPlatformProfile(null);
          setActiveBranchId(null);
          setActiveBranch(null);
          setAssignedBranches([]);
          localStorage.removeItem('activeBranchId');
          localStorage.removeItem('auth_profile');
          localStorage.removeItem('auth_platformProfile');
        }
      } catch (err) {
        console.error("Auth listener error:", err);
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, [tenant, isPlatformAdmin, tenantLoading]);

  const handleSetActiveBranchId = (id: string) => {
    setActiveBranchId(id);
    localStorage.setItem('activeBranchId', id);
    const b = assignedBranches.find(br => br.id === id);
    if (b) setActiveBranch(b);
  };

  const signIn = async (emailOrUsername?: string, password?: string, accountType: 'TMC' | 'TENANT' = 'TENANT') => {
    if (signingIn) return;
    if (!emailOrUsername || !password) {
      throw new Error("Credentials required.");
    }

    setSigningIn(true);
    
    // Uniform security error message
    const genericError = "Sign in failed. Check your details and try again.";

    try {
      let targetEmail = emailOrUsername.toLowerCase().trim();

      // Support standardized dot-notation and synthetic internal routing naming conventions
      if (!targetEmail.includes('@')) {
        if (targetEmail.endsWith('.pharmhelm.com')) {
          const clean = targetEmail.slice(0, -14);
          const lastDot = clean.lastIndexOf('.');
          if (lastDot !== -1) {
            const handle = clean.substring(0, lastDot);
            const acronym = clean.substring(lastDot + 1);
            targetEmail = `${handle}@${acronym}.pharmhelm.com`;
          } else {
            const acronym = tenant?.acronym ? tenant.acronym.toLowerCase().trim() : (tenant?.slug || 'radah');
            targetEmail = `${clean}@${acronym}.pharmhelm.com`;
          }
        } else {
          if (accountType === 'TMC') {
            targetEmail = `${targetEmail}@pharmhelm.com`;
          } else {
            const acronym = tenant?.acronym ? tenant.acronym.toLowerCase().trim() : (tenant?.slug || 'radah');
            targetEmail = `${targetEmail}@${acronym}.pharmhelm.com`;
          }
        }
      } else if (targetEmail.endsWith('@pharmhelm')) {
        targetEmail = `${targetEmail}.com`;
      }

      // 1. Perform client-side Firebase Auth sign-in
      const userCredential = await signInWithEmailAndPassword(auth, targetEmail, password);
      const authenticatedUser = userCredential.user;

      // 1.5 Post-Login Tenant Guard: Immediately intercept and validate claims
      const idTokenResult = await authenticatedUser.getIdTokenResult(true);
      const tokenTenantId = idTokenResult.claims.tenantId;

      const isAdminEmail = 
        targetEmail === 'peterssentongo61@gmail.com' ||
        targetEmail === 'peter.sentongo@pharmhelm.com' ||
        targetEmail === 'peter.sentong@pharmhelm.com' ||
        targetEmail === 'peter.sentongo@pharmhelm';

      // 2. Validate profile and active status in Firestore
      if (accountType === 'TMC') {
        const docRef = doc(db, 'platform_users', authenticatedUser.uid);
        let docSnap = await getDoc(docRef);
        
        let platformProfileData: PlatformUser | null = null;
        if (docSnap.exists()) {
          platformProfileData = docSnap.data() as PlatformUser;
        } else {
          const q = query(collection(db, 'platform_users'), where('email', '==', targetEmail));
          const snap = await getDocs(q);
          if (!snap.empty) {
            platformProfileData = { id: snap.docs[0].id, ...snap.docs[0].data() } as PlatformUser;
          }
        }

        if (!platformProfileData && isAdminEmail) {
          // Provision a temporary profile to satisfy sign-in validation step
          platformProfileData = {
            id: authenticatedUser.uid,
            full_name: 'Peter Sentongo (Super Admin)',
            email: targetEmail,
            role: 'super_operator',
            active: true,
            created_at: new Date().toISOString()
          };
        }

        if (!platformProfileData || !platformProfileData.active) {
          await signOut(auth);
          throw new Error("Account is inactive or suspended.");
        }
      } else {
        if (!tenant) {
          await signOut(auth);
          throw new Error("Tenant workspace not detected.");
        }

        // Apply Subscription and Tenant Guard checks for standard users
        const isPlatformBypass = isAdminEmail;
        if (!isPlatformBypass) {
          const subStatus = tenant.subscription_status || 'inactive';
          const subEnd = tenant.subscription_end ? new Date(tenant.subscription_end) : null;
          const isSubExpired = subEnd ? subEnd < new Date() : true;

          if (subStatus !== 'active') {
            await signOut(auth);
            throw new Error("Subscription not yet activated.");
          }
          if (isSubExpired) {
            await signOut(auth);
            throw new Error("Subscription expired.");
          }

          if (tokenTenantId && tokenTenantId !== tenant.id) {
            await signOut(auth);
            throw new Error("Access Denied: This account does not belong to this pharmacy.");
          }
        }

        const docRef = doc(db, 'staff', authenticatedUser.uid);
        let docSnap = await getDoc(docRef);
        
        let staffProfileData: Staff | null = null;
        if (docSnap.exists()) {
          staffProfileData = docSnap.data() as Staff;
        } else {
          // Search by authEmail or loginHandle or username
          // Note: tenantId filters are removed here to pass security rules checks during initial query
          let matchedDoc: any = null;
          const q = query(
            collection(db, 'staff'),
            where('authEmail', '==', targetEmail)
          );
          const snap = await getDocs(q);
          if (!snap.empty) {
            matchedDoc = snap.docs[0];
          } else {
            const parts = targetEmail.split('@');
            const handle = parts[0];
            const q2 = query(
              collection(db, 'staff'),
              where('username', '==', handle)
            );
            const snap2 = await getDocs(q2);
            if (!snap2.empty) {
              matchedDoc = snap2.docs[0];
            } else {
              const q3 = query(
                collection(db, 'staff'),
                where('username', '==', emailOrUsername.toLowerCase().trim())
              );
              const snap3 = await getDocs(q3);
              if (!snap3.empty) {
                matchedDoc = snap3.docs[0];
              }
            }
          }
          if (matchedDoc) {
            const sData = matchedDoc.data() as Staff;
            if (sData.tenantId === tenant.id) {
              staffProfileData = { id: matchedDoc.id, ...sData } as Staff;
            }
          }
        }

        if (!staffProfileData || staffProfileData.tenantId !== tenant.id) {
          await signOut(auth);
          throw new Error("Access Denied: This account does not belong to this pharmacy.");
        }

        if (!staffProfileData.active && staffProfileData.status !== 'active') {
          await signOut(auth);
          throw new Error("Account is inactive or suspended.");
        }
      }

      // 3. Verify email verification on production hostnames (skipped for whitelisted admin emails & synthetic domains)
      const isProductionHostname = window.location.hostname === 'pharmhelm.com' || !window.location.hostname.includes('localhost');
      const isSyntheticEmail = targetEmail.endsWith('.pharmhelm.com') && !isAdminEmail;

      if (isProductionHostname && !authenticatedUser.emailVerified && !isAdminEmail && !isSyntheticEmail) {
        try {
          await addDoc(collection(db, 'global_audit_logs'), {
            action: accountType === 'TMC' ? 'TMC_LOGIN_FAILED' : 'STAFF_LOGIN_FAILED',
            category: 'SECURITY',
            description: `Blocked login: email not verified for ${targetEmail}`,
            timestamp: new Date().toISOString(),
            tenantId: tenant?.id || 'platform',
            actor: targetEmail,
            ipAddress: 'client-side',
            device: window.navigator.userAgent
          });
        } catch (e) {}

        await signOut(auth);
        throw new Error("Please verify your email address before logging in.");
      }

      // 4. Log successful login to global audit logs
      try {
        await addDoc(collection(db, 'global_audit_logs'), {
          action: accountType === 'TMC' ? 'TMC_LOGIN_SUCCESS' : 'STAFF_LOGIN_SUCCESS',
          category: 'SECURITY',
          description: `Successful login for ${targetEmail}.`,
          timestamp: new Date().toISOString(),
          tenantId: tenant?.id || 'platform',
          actor: targetEmail,
          ipAddress: 'client-side',
          device: window.navigator.userAgent
        });
      } catch (e) {}

    } catch (err: any) {
      console.error("Sign in failed:", err);
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-email') {
        throw new Error(genericError);
      }
      throw err;
    } finally {
      setSigningIn(false);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      toast.error('Failed to sign out.');
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      profile, 
      platformProfile,
      loading: loading || tenantLoading, 
      signingIn, 
      activeBranchId, 
      activeBranch,
      tenantId: profile?.tenantId || tenant?.id || null,
      multiBranchMode,
      assignedBranches,
      permissions,
      hasPermission,
      setActiveBranchId: handleSetActiveBranchId,
      signIn, 
      signInWithBypass: async () => {}, // Disabled in prod
      logout 
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
