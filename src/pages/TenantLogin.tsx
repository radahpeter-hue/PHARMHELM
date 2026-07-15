import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';
import { ThreeCapsule } from '../components/ThreeCapsule';
import { toast } from 'sonner';
import { AlertCircle } from 'lucide-react';

export default function TenantLogin() {
  const { signIn } = useAuth();
  const { tenant, error: tenantError, loading: tenantLoading } = useTenant();
  const navigate = useNavigate();
  const params = useParams<{ tenantSlug?: string }>();

  const [username, setUsername] = useState('');
  
  const getPublicLink = (path: string) => {
    const host = window.location.hostname.toLowerCase();
    if (host.includes('localhost') || host.includes('web.app') || host.includes('firebaseapp.com')) {
      return `${window.location.protocol}//${window.location.host}${path}`;
    }
    return `https://pharmhelm.com${path}`;
  };
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [greeting, setGreeting] = useState('Good morning, Pharmacist');

  const primaryColor = tenant?.brand_colour || '#0c5252';

  // Dynamic Greeting Logic & Title Setup
  useEffect(() => {
    document.title = "PharmHelm Workspace | Login";
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) {
      setGreeting('Good morning, Pharmacist');
    } else if (hour >= 12 && hour < 18) {
      setGreeting('Good afternoon, Pharmacist');
    } else {
      setGreeting('Good evening, Pharmacist');
    }
  }, []);

  // Subscription calculation
  const subStatus = tenant?.subscription_status || 'inactive';
  const subEnd = tenant?.subscription_end ? new Date(tenant.subscription_end) : null;
  const isSubExpired = subEnd ? subEnd < new Date() : true;

  let subscriptionError: string | null = null;
  let subscriptionWarning: string | null = null;

  if (tenant) {
    if (subStatus !== 'active') {
      subscriptionError = "Subscription not yet activated.";
    } else if (isSubExpired) {
      subscriptionError = "Subscription expired.";
    } else if (subEnd) {
      const diffTime = subEnd.getTime() - new Date().getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays >= 0 && diffDays <= 7) {
        subscriptionWarning = `Your subscription will expire on ${tenant.subscription_end.split('T')[0]}. Please renew.`;
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || subscriptionError) return;

    setLoading(true);
    setError(null);
    setShake(false);

    // Extract current tenant acronym/slug from hostname
    const hostname = window.location.hostname;
    const hostnameParts = hostname.split('.');
    let activeAcronym = '';

    if (hostnameParts.length > 2 && hostnameParts[hostnameParts.length - 2] === 'pharmhelm' && hostnameParts[hostnameParts.length - 1] === 'com') {
      const prefix = hostnameParts[0];
      if (prefix !== 'www' && prefix !== 'platform') {
        activeAcronym = prefix;
      }
    }

    if (!activeAcronym) {
      activeAcronym = tenant?.acronym || tenant?.slug || params.tenantSlug || '';
    }

    // Verify username suffix includes the active tenant acronym
    const cleanUsername = username.toLowerCase().trim();
    if (activeAcronym) {
      const requiredSuffix = `.${activeAcronym.toLowerCase()}.pharmhelm.com`;
      const alternativeMarker = `.${activeAcronym.toLowerCase()}.`;
      const emailSuffix = `@${activeAcronym.toLowerCase()}.pharmhelm.com`;
      const isDomainSuffixValid = 
        cleanUsername.endsWith(requiredSuffix) || 
        cleanUsername.includes(alternativeMarker) || 
        cleanUsername.endsWith(emailSuffix);
      
      if (!isDomainSuffixValid) {
        setShake(true);
        setError("Access Denied: This account does not belong to this pharmacy workspace.");
        setLoading(false);
        setTimeout(() => setShake(false), 500);
        return;
      }
    }

    try {
      // 1. Call Backend authentication through AuthContext
      await signIn(username, password, 'TENANT');
      
      // On success, play 3D capsule split animation
      setIsLoggingIn(true);
    } catch (err: any) {
      setShake(true);
      setError(err.message || "Sign in failed. Check your details and try again.");
      setLoading(false);
      setTimeout(() => setShake(false), 500);
    }
  };

  const handleAnimationComplete = () => {
    const slug = params.tenantSlug || tenant?.slug || 'radah';
    navigate(`/tenant/${slug}/app`);
  };

  if (tenantLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fbf9f8]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (tenantError === 'ACCOUNT_REMOVED') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#05192d] p-4 text-white font-sans selection:bg-[#b0f0d6] selection:text-[#003527]">
        <div className="max-w-lg w-full bg-white/5 backdrop-blur-xl p-10 rounded-[32px] border border-white/10 shadow-2xl text-center space-y-6 animate-in fade-in zoom-in duration-200">
          <div className="h-20 w-20 bg-red-950/30 rounded-3xl flex items-center justify-center mx-auto border border-red-900/50">
            <AlertCircle className="text-red-400" size={40} />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">Account Removed</h1>
          <p className="text-zinc-300 text-sm leading-relaxed font-medium">
            The PharmHelm Pro workspace for this organization has been removed. 
            If you believe this is an error or need to restore this environment, 
            please contact the platform administrator.
          </p>
          <div className="pt-2">
            <a 
              href="mailto:pharmhelmpro@gmail.com" 
              className="inline-block px-8 py-3 bg-[#064e3b] text-white font-bold text-xs uppercase tracking-widest rounded-xl hover:brightness-125 transition-all shadow-lg"
            >
              Contact Administrator
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#fbf9f8] text-[#1b1c1c] min-h-screen flex flex-col items-center selection:bg-emerald-500 selection:text-white relative overflow-x-hidden">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');
        
        body {
            font-family: 'Plus Jakarta Sans', sans-serif;
            background-color: #fbf9f8;
            overflow-x: hidden;
            min-height: max(884px, 100dvh);
        }

        .ambient-shadow {
            box-shadow: 0 24px 48px -12px rgba(12, 82, 82, 0.06);
        }

        .glass-card {
            background: rgba(255, 255, 255, 0.85);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
        }

        .pill-shape {
            border-radius: 9999px;
        }

        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        }

        .btn-hover-effect:active {
            transform: scale(0.98);
            transition: transform 0.1s ease;
        }

        .font-display-lg { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 48px; line-height: 56px; letter-spacing: -0.02em; font-weight: 700; }
        .font-headline-lg { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 32px; line-height: 40px; letter-spacing: -0.01em; font-weight: 600; }
        .font-headline-md { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 24px; line-height: 32px; font-weight: 600; }
        .font-body-md { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 16px; line-height: 24px; }
        .font-body-lg { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 18px; line-height: 28px; }
        .font-label-md { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14px; line-height: 20px; font-weight: 600; }
        .font-caption { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12px; line-height: 16px; font-weight: 500; }
      `}</style>

      {/* Top Navigation Anchor */}
      <header className="fixed top-0 w-full z-50 flex justify-between items-center px-6 md:px-16 h-16 bg-[#fbf9f8] border-b border-stone-200/50 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[32px]" style={{ color: primaryColor }}>health_metrics</span>
          <span className="font-headline-md text-headline-md font-extrabold tracking-tight" style={{ color: primaryColor }}>PharmHelm</span>
        </div>
        <div className="hidden md:flex gap-8">
          <a className="font-label-md text-label-md text-[#3f4848] hover:opacity-80 transition-opacity" href="#">Our Mission</a>
          <a className="font-label-md text-label-md text-[#3f4848] hover:opacity-80 transition-opacity" href="#">Security</a>
        </div>
      </header>

      <main className="flex-grow flex items-center justify-center w-full px-6 relative py-20 mt-16">
        {/* Botanical Background Elements */}
        <div className="absolute inset-0 z-0 overflow-hidden opacity-40 pointer-events-none">
          <div className="absolute inset-0 bg-cover bg-center blur-[4px]" style={{ backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuD9lzD8xLvXX8Liy1LI4UPWTgzdqTXDrcC7JGOzOR9Z4mddWG12_o-G5wXu_MsTUIfBh_xiDPH5KxEP7EEcKe-MKMU9P-bAAIqBFV88OQ6BysrF2BokO7Jx5bXlu5TCMKAR9n8fuqOt0Hmadiyjd9nEZ8SVjn7cPc1KIUbjo22Tz6kWK-lSkEv403-H6O2F-XfmqD4I_qAqx8WxsWxoyE9hhN09xRrw3kifIFT8DJZrIVntG4PDHX2NsQ')" }}></div>
          <div className="absolute inset-0 bg-gradient-to-b from-[#fbf9f8]/80 via-transparent to-[#fbf9f8]"></div>
        </div>

        {/* Login Container */}
        <div className="z-10 w-full max-w-[480px] space-y-6">
          <div className="text-center space-y-2 mb-4">
            <h1 className="font-display-lg text-display-lg" style={{ color: primaryColor }}>{greeting}</h1>
            
            {/* Interactive 3D Capsule */}
            <ThreeCapsule 
              brandColor={primaryColor}
              isLoggingIn={isLoggingIn}
              onAnimationComplete={handleAnimationComplete}
            />

            <p className="font-body-lg text-body-lg text-[#3f4848] max-w-[320px] mx-auto">
              Please enter your credentials to access your secure apothecary workspace.
            </p>
          </div>

          {/* Card */}
          <div className={`glass-card ambient-shadow rounded-[2rem] p-8 md:p-10 border border-white/40 transition-all duration-300 ${shake ? 'animate-shake border-red-500/50' : ''}`}>
            <form onSubmit={handleSubmit} className="space-y-6" id="loginForm">
              
              {/* Subscription Alerts */}
              {subscriptionError && (
                <div className="p-4 bg-rose-50 border border-rose-100 text-rose-700 text-xs rounded-2xl font-black text-center flex flex-col gap-1 uppercase tracking-wider">
                  <span>⚠️ ACCESS LOCKED</span>
                  <span className="text-[10px] font-medium lowercase first-letter:uppercase">{subscriptionError}</span>
                </div>
              )}

              {subscriptionWarning && (
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-2xl font-bold text-center leading-normal">
                  ⚠️ {subscriptionWarning}
                </div>
              )}

              {/* Error Box */}
              {error && (
                <div className="p-3 bg-rose-50 border border-rose-100 text-rose-600 text-xs rounded-2xl font-bold text-center uppercase tracking-wider">
                  {error}
                </div>
              )}

              {/* Email Field */}
              <div className="space-y-2">
                <label className="font-label-md text-label-md text-[#1b1c1c] ml-4" htmlFor="email">Work Email</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 text-[#707978]">alternate_email</span>
                  <input 
                    className="w-full h-14 pl-14 pr-6 bg-white border border-[#bfc8c8] focus:border-primary focus:ring-1 focus:ring-primary pill-shape transition-all outline-none font-body-md text-body-md text-[#1b1c1c]" 
                    id="email" 
                    placeholder="email@pharmhelm.com" 
                    required 
                    type="text"
                    value={username}
                    disabled={loading || !!subscriptionError}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
              </div>

              {/* Password Field */}
              <div className="space-y-2">
                <label className="font-label-md text-label-md text-[#1b1c1c] ml-4" htmlFor="password">Secure Password</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 text-[#707978]">lock</span>
                  <input 
                    className="w-full h-14 pl-14 pr-14 bg-white border border-[#bfc8c8] focus:border-primary focus:ring-1 focus:ring-primary pill-shape transition-all outline-none font-body-md text-body-md text-[#1b1c1c]" 
                    id="password" 
                    placeholder="••••••••" 
                    required 
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    disabled={loading || !!subscriptionError}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button 
                    className="absolute right-5 top-1/2 -translate-y-1/2 text-[#707978] hover:text-primary transition-colors" 
                    id="togglePassword" 
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    <span className="material-symbols-outlined">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between px-4">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input 
                    className="w-5 h-5 rounded-full border-2 border-[#bfc8c8] text-primary focus:ring-primary/20 transition-all cursor-pointer" 
                    type="checkbox"
                    defaultChecked
                  />
                  <span className="font-label-md text-label-md text-[#3f4848] group-hover:text-primary transition-colors">Keep me active</span>
                </label>
              </div>

              {/* Login Button */}
              <button 
                className="btn-hover-effect w-full h-14 text-white font-label-md text-body-md pill-shape shadow-lg flex items-center justify-center gap-2 hover:opacity-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed" 
                type="submit"
                style={{ backgroundColor: primaryColor, boxShadow: `0 10px 15px -3px rgba(12, 82, 82, 0.2)` }}
                disabled={loading || !!subscriptionError}
              >
                {loading ? (
                  <>
                    <span className="material-symbols-outlined animate-spin">progress_activity</span>
                    <span>{isLoggingIn ? 'Workspace Accessed' : 'Authenticating...'}</span>
                  </>
                ) : (
                  <>
                    <span>Sign in to Workspace</span>
                    <span className="material-symbols-outlined">arrow_forward</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Compliance Badges */}
          <div className="flex flex-wrap items-center justify-center gap-6 py-4">
            <div className="flex items-center gap-2 px-4 py-2 bg-[#ccebc7]/30 rounded-full border border-[#ccebc7]/50">
              <span className="material-symbols-outlined text-[#4a6549] text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified_user</span>
              <span className="font-caption text-caption text-[#506b4f]">HIPAA Compliant</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 bg-[#ccebc7]/30 rounded-full border border-[#ccebc7]/50">
              <span className="material-symbols-outlined text-[#4a6549] text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>encrypted</span>
              <span className="font-caption text-caption text-[#506b4f]">AES-256 Encrypted</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer Anchor */}
      <footer className="w-full max-w-[1280px] mx-auto py-8 px-6 md:px-16 flex flex-col items-center gap-2 text-center bg-transparent mt-auto relative z-10">
        <div className="font-label-md text-label-md text-primary mb-2" style={{ color: primaryColor }}>PharmHelm</div>
        <p className="font-caption text-caption text-[#3f4848]">© 2026 PharmHelm. HIPAA Compliant Enterprise Systems.</p>
        <div className="flex gap-4 mt-2">
          <a className="font-caption text-caption text-[#3f4848] hover:text-primary transition-colors" href={getPublicLink('/privacy')} target="_blank" rel="noopener noreferrer">Privacy Policy</a>
          <a className="font-caption text-caption text-[#3f4848] hover:text-primary transition-colors" href="#">Terms of Service</a>
          <a className="font-caption text-caption text-[#3f4848] hover:text-primary transition-colors font-bold" href={getPublicLink('/about')} target="_blank" rel="noopener noreferrer">About Us</a>
          <a className="font-caption text-caption text-[#3f4848] hover:text-primary transition-colors" href="#">Security Standards</a>
        </div>
      </footer>
    </div>
  );
}
