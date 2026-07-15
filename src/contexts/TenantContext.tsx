import React, { createContext, useContext, useState, useEffect } from 'react';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { Tenant } from '../types';

interface TenantContextType {
  tenant: Tenant | null;
  isPlatformAdmin: boolean;
  loading: boolean;
  error: string | null;
  tenantSlug: string | null;
  setTenantSlugAndMode: (slug: string | null) => void;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);

  const setTenantSlugAndMode = (slug: string | null) => {
    if (slug) {
      sessionStorage.setItem('pharmhelm_tenant_slug', slug);
      localStorage.setItem('pharmhelm_tenant_slug', slug);
    } else {
      sessionStorage.setItem('pharmhelm_tenant_slug', 'platform');
      localStorage.setItem('pharmhelm_tenant_slug', 'platform');
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('tenant');
    window.history.replaceState({}, '', url.toString());
    window.location.reload();
  };

  useEffect(() => {
    const detectTenant = async () => {
      try {
        const hostname = window.location.hostname;
        const pathname = window.location.pathname;
        const baseDomain = 'pharmhelm.com'; 
        
        let slug: string | null = null;
        let platformAdmin = false;

        // Check if hostname is the Platform Console main domain
        // Check if hostname is the Platform Console main domain
        if (hostname === baseDomain || hostname === `www.${baseDomain}`) {
          platformAdmin = true;
        } else {
          const parts = hostname.split('.');
          // E.g. radah.pharmhelm.com
          if (parts.length > 2 && parts[parts.length - 2] === 'pharmhelm' && parts[parts.length - 1] === 'com') {
            slug = parts[0];
          } else {
            // Path-based tenant detection (useful for local development and previews)
            const pathParts = pathname.split('/');
            if (pathParts[1] === 'tenant' && pathParts[2]) {
              slug = pathParts[2];
            } else if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
              // Fallback query parameter or stored selection in dev/local
              const urlParams = new URLSearchParams(window.location.search);
              slug = urlParams.get('tenant') || localStorage.getItem('pharmhelm_tenant_slug') || 'radah';
            }
          }
        }

        if (platformAdmin) {
          setIsPlatformAdmin(true);
          setTenant(null);
          setTenantSlug(null);
          setLoading(false);
          return;
        }

        if (!slug || slug === 'platform' || slug === 'www') {
          setIsPlatformAdmin(true);
          setTenant(null);
          setTenantSlug(null);
          setLoading(false);
          return;
        }

        setTenantSlug(slug);
        setIsPlatformAdmin(false);

        // Fetch tenant data from Firestore
        const tenantsRef = collection(db, 'tenants');
        const q = query(tenantsRef, where('slug', '==', slug));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
          setError(`Tenant '${slug}' not found.`);
          setTenant(null);
        } else {
          const tenantData = querySnapshot.docs[0].data() as Tenant;
          
          // Check subscription status and date boundaries
          const todayStr = new Date().toISOString().split('T')[0];
          const isStatusActive = tenantData.subscription_status === 'active' || tenantData.subscription_status === 'trial';
          const isDateValid = (!tenantData.subscription_start || todayStr >= tenantData.subscription_start) &&
                              (!tenantData.subscription_end || todayStr <= tenantData.subscription_end);

          if (tenantData.status === 'deleted' || (tenantData as any).deleted === true) {
            setError('ACCOUNT_REMOVED');
            setTenant(null);
          } else if (!isStatusActive || !isDateValid) {
            setError('SUBSCRIPTION_EXPIRED');
            setTenant({ ...tenantData, id: querySnapshot.docs[0].id });
          } else if (tenantData.status === 'suspended') {
            setError('Access denied: Account suspended.');
            setTenant(null);
          } else {
            setTenant({ ...tenantData, id: querySnapshot.docs[0].id });
            setError(null);
          }
        }
      } catch (err) {
        console.error('Error detecting tenant:', err);
        setError('Failed to load tenant configuration.');
      } finally {
        setLoading(false);
      }
    };

    detectTenant();
  }, []);

  return (
    <TenantContext.Provider value={{ tenant, isPlatformAdmin, loading, error, tenantSlug, setTenantSlugAndMode }}>
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (context === undefined) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
};
