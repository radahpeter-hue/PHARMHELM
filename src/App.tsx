import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from 'react-router-dom';
import Layout from './components/Layout';
import BranchSelector from './components/BranchSelector';
import { useAuth } from './contexts/AuthContext';
import { useTenant } from './contexts/TenantContext';
import { AlertCircle } from 'lucide-react';
import { Toaster } from 'sonner';

import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import Sales from './pages/Sales';
import StockInOut from './pages/StockInOut';
import Procurement from './pages/Procurement';
import Finance from './pages/Finance';
import QACompliance from './pages/QACompliance';
import HRAdmin from './pages/HRAdmin';
import Clients from './pages/Clients';
import Logistics from './pages/Logistics';
import Welfare from './pages/Welfare';
import Predictive from './pages/Predictive';
import Analytics from './pages/Analytics';
import Marketing from './pages/Marketing';
import SettingsPage from './pages/Settings';
import PlatformAdmin from './pages/PlatformAdmin';
import TmcLogin from './pages/TmcLogin';
import TenantLogin from './pages/TenantLogin';

// Protected Route for TMC
const TmcProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, platformProfile, loading } = useAuth();
  const { isPlatformAdmin } = useTenant();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  // TMC users must have a valid session and profile
  if (!user || !isPlatformAdmin || !platformProfile) {
    return <Navigate to="/tmc/login" replace />;
  }

  return <>{children}</>;
};

// Protected Route for Tenants
const TenantProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile, loading, activeBranchId, multiBranchMode } = useAuth();
  const { tenant, error: tenantError, loading: tenantLoading } = useTenant();
  const params = useParams<{ tenantSlug?: string }>();

  if (loading || tenantLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  // Handle Subscription / Access errors
  if (tenantError) {
    const isExpired = tenantError === 'SUBSCRIPTION_EXPIRED';
    if (isExpired) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-[#E4E3E0] p-4 font-sans">
          <div className="max-w-lg w-full bg-white p-10 rounded-3xl border border-zinc-200/50 shadow-xl text-center">
            <div className="h-20 w-20 bg-amber-50 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-amber-100">
              <AlertCircle className="text-amber-600" size={40} />
            </div>
            <h1 className="text-2xl font-bold text-zinc-900 mb-3">Subscription Inactive</h1>
            <p className="text-zinc-600 text-sm leading-relaxed mb-8">
              Thank you for being part of the <strong>PharmHelm Pro ERP</strong> network. 
              The subscription for this pharmacy branch environment is currently inactive. 
              Please contact your administrator to activate your plan.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-3xl border border-red-100 shadow-xl text-center">
          <div className="h-16 w-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="text-red-500" size={32} />
          </div>
          <h1 className="text-xl font-bold text-zinc-900 mb-2">Access Denied</h1>
          <p className="text-zinc-500 mb-8">{tenantError}</p>
        </div>
      </div>
    );
  }

  // Route back to login if unauthenticated
  const currentSlug = params.tenantSlug || tenant?.slug || 'radah';
  if (!user || !profile) {
    return <Navigate to={`/tenant/${currentSlug}/login`} replace />;
  }

  // Force branch selector if in multi-branch mode and no active branch is set
  if (multiBranchMode && !activeBranchId) {
    return <BranchSelector />;
  }

  return <Layout>{children}</Layout>;
};

// Subdomain guard for TMC portal to redirect subdomain traffic to Tenant portals
const TmcSubdomainGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const hostname = window.location.hostname;
  const parts = hostname.split('.');
  let isSubdomainTenant = false;
  let extractedSlug = '';

  if (parts.length > 2 && parts[parts.length - 2] === 'pharmhelm' && parts[parts.length - 1] === 'com') {
    const prefix = parts[0];
    if (prefix !== 'www' && prefix !== 'platform') {
      isSubdomainTenant = true;
      extractedSlug = prefix;
    }
  }

  if (isSubdomainTenant) {
    return <Navigate to={`/tenant/${extractedSlug}/login`} replace />;
  }

  return <>{children}</>;
};

// Root Router Component
export default function App() {
  const { isPlatformAdmin, tenantSlug } = useTenant();
  const { user } = useAuth();

  const hostname = window.location.hostname;
  const parts = hostname.split('.');
  let isSubdomainTenant = false;
  let extractedSlug = '';

  if (parts.length > 2 && parts[parts.length - 2] === 'pharmhelm' && parts[parts.length - 1] === 'com') {
    const prefix = parts[0];
    if (prefix !== 'www' && prefix !== 'platform') {
      isSubdomainTenant = true;
      extractedSlug = prefix;
    }
  }

  // Root redirect handler based on active domains
  const getRootRedirect = () => {
    if (isSubdomainTenant) {
      const slug = extractedSlug;
      return user ? <Navigate to={`/tenant/${slug}/app`} replace /> : <Navigate to={`/tenant/${slug}/login`} replace />;
    }

    if (isPlatformAdmin) {
      return user ? <Navigate to="/tmc/dashboard" replace /> : <Navigate to="/tmc/login" replace />;
    } else {
      const slug = tenantSlug || 'radah';
      return user ? <Navigate to={`/tenant/${slug}/app`} replace /> : <Navigate to={`/tenant/${slug}/login`} replace />;
    }
  };

  return (
    <Router>
      <Toaster position="top-center" />
      <Routes>
        {/* Portal Entry Redirection */}
        <Route path="/" element={getRootRedirect()} />

        {/* TMC Portal */}
        <Route path="/tmc/login" element={<TmcSubdomainGuard><TmcLogin /></TmcSubdomainGuard>} />
        <Route path="/tmc/dashboard" element={<TmcSubdomainGuard><TmcProtectedRoute><PlatformAdmin /></TmcProtectedRoute></TmcSubdomainGuard>} />

        {/* Tenant Portal */}
        <Route path="/tenant/:tenantSlug/login" element={<TenantLogin />} />
        
        {/* Tenant Application Nested Routes */}
        <Route path="/tenant/:tenantSlug/app" element={<TenantProtectedRoute><Dashboard /></TenantProtectedRoute>} />
        <Route path="/tenant/:tenantSlug/app/sales" element={<TenantProtectedRoute><Sales /></TenantProtectedRoute>} />
        <Route path="/tenant/:tenantSlug/app/inventory" element={<TenantProtectedRoute><Inventory /></TenantProtectedRoute>} />
        <Route path="/tenant/:tenantSlug/app/clients" element={<TenantProtectedRoute><Clients /></TenantProtectedRoute>} />
        <Route path="/tenant/:tenantSlug/app/stock" element={<TenantProtectedRoute><StockInOut /></TenantProtectedRoute>} />
        <Route path="/tenant/:tenantSlug/app/procurement" element={<TenantProtectedRoute><Procurement /></TenantProtectedRoute>} />
        <Route path="/tenant/:tenantSlug/app/logistics" element={<TenantProtectedRoute><Logistics /></TenantProtectedRoute>} />
        <Route path="/tenant/:tenantSlug/app/finance" element={<TenantProtectedRoute><Finance /></TenantProtectedRoute>} />
        <Route path="/tenant/:tenantSlug/app/qa" element={<TenantProtectedRoute><QACompliance /></TenantProtectedRoute>} />
        <Route path="/tenant/:tenantSlug/app/hr" element={<TenantProtectedRoute><HRAdmin /></TenantProtectedRoute>} />
        <Route path="/tenant/:tenantSlug/app/welfare" element={<TenantProtectedRoute><Welfare /></TenantProtectedRoute>} />
        <Route path="/tenant/:tenantSlug/app/predictive" element={<TenantProtectedRoute><Predictive /></TenantProtectedRoute>} />
        <Route path="/tenant/:tenantSlug/app/analytics" element={<TenantProtectedRoute><Analytics /></TenantProtectedRoute>} />
        <Route path="/tenant/:tenantSlug/app/marketing" element={<TenantProtectedRoute><Marketing /></TenantProtectedRoute>} />
        <Route path="/tenant/:tenantSlug/app/settings" element={<TenantProtectedRoute><SettingsPage /></TenantProtectedRoute>} />

        {/* Catch-all fallback */}
        <Route path="*" element={getRootRedirect()} />
      </Routes>
    </Router>
  );
}
