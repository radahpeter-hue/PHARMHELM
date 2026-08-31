import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';

export default function TmcLogin() {
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const getPublicLink = (path: string) => {
    const host = window.location.hostname.toLowerCase();
    if (host.includes('localhost') || host.includes('web.app') || host.includes('firebaseapp.com')) {
      return `${window.location.protocol}//${window.location.host}${path}`;
    }
    return `https://pharmhelm.com${path}`;
  };
  const termsOfUseLink = window.location.hostname.includes('localhost') || window.location.hostname.includes('web.app') || window.location.hostname.includes('firebaseapp.com')
    ? getPublicLink('/terms-of-use')
    : 'https://termsofuse.pharmhelm.com';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [greeting, setGreeting] = useState('Good morning, Administrator');

  // Dynamic Greeting Logic & Title Setup
  useEffect(() => {
    document.title = "PharmHelm Tenant Management Console | Login";
    const hour = new Date().getHours();
    if (hour >= 12 && hour < 17) {
      setGreeting('Good afternoon, Administrator');
    } else if (hour >= 17 || hour < 4) {
      setGreeting('Good evening, Administrator');
    } else {
      setGreeting('Good morning, Administrator');
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);
    setShake(false);

    try {
      await signIn(email, password, 'TMC');
      setIsLoggingIn(true);
      toast.success("Administrator session verified successfully.");
      
      // Delay navigation to let the user see the success state
      setTimeout(() => {
        navigate('/tmc/dashboard');
      }, 1500);
    } catch (err: any) {
      setShake(true);
      setError(err.message || "Sign in failed. Check your details and try again.");
      setLoading(false);
      setTimeout(() => setShake(false), 500);
    }
  };

  return (
    <div className="font-body-md text-body-md flex min-h-screen items-center justify-center relative w-full overflow-hidden bg-[#f5fbf9]">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=Hanken+Grotesk:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');
        
        .glass-panel {
            backdrop-filter: blur(20px);
            background: rgba(255, 255, 255, 0.7);
            border: 1px solid rgba(112, 121, 121, 0.1);
        }
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        }
        .capsule-float {
            animation: float 6s ease-in-out infinite;
        }
        @keyframes float {
            0%, 100% { transform: translateY(0px) rotate(0deg); }
            50% { transform: translateY(-20px) rotate(5deg); }
        }
        .subtle-grid {
            background-image: radial-gradient(circle at 1px 1px, rgba(47, 103, 106, 0.05) 1px, transparent 0);
            background-size: 40px 40px;
        }
        
        /* Font and color overrides to match the premium design exactly */
        .font-headline-md { font-family: 'Hanken Grotesk', sans-serif; font-size: 24px; line-height: 32px; font-weight: 600; }
        .font-headline-lg { font-family: 'Hanken Grotesk', sans-serif; font-size: 32px; line-height: 40px; font-weight: 600; }
        .font-headline-sm { font-family: 'Hanken Grotesk', sans-serif; font-size: 20px; line-height: 28px; font-weight: 500; }
        .font-body-md { font-family: 'Geist', sans-serif; font-size: 14px; line-height: 20px; }
        .font-body-lg { font-family: 'Geist', sans-serif; font-size: 16px; line-height: 24px; }
        .font-label-caps { font-family: 'Hanken Grotesk', sans-serif; font-size: 12px; line-height: 16px; letter-spacing: 0.05em; font-weight: 700; text-transform: uppercase; }
        .font-code-sm { font-family: 'JetBrains Mono', monospace; font-size: 13px; line-height: 18px; }
      `}</style>

      {/* Background Decoration */}
      <div className="absolute inset-0 z-0 subtle-grid overflow-hidden pointer-events-none">
        <div className="absolute -top-[20%] -right-[10%] w-[600px] h-[600px] bg-[#cae9de]/20 rounded-full blur-[120px]"></div>
        <div className="absolute -bottom-[20%] -left-[10%] w-[500px] h-[500px] bg-[#0d4c4f]/5 rounded-full blur-[100px]"></div>
      </div>

      {/* Main Content Canvas */}
      <main className="relative z-10 flex flex-col md:flex-row w-full max-w-5xl mx-4 md:mx-auto glass-panel rounded-[2rem] shadow-2xl overflow-hidden min-h-[640px]">
        {/* Left Side: Visual/Context */}
        <div className="hidden md:flex flex-col flex-1 bg-[#003436] text-white p-10 relative overflow-hidden">
          <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] pointer-events-none"></div>
          <header className="flex items-center gap-3 mb-auto">
            <span className="material-symbols-outlined text-3xl text-[#b5ecf0]">science</span>
            <h1 className="font-headline-md text-headline-md font-bold tracking-tight text-white">PharmHelm</h1>
          </header>
          
          <div className="my-auto text-center">
            {/* 3D Capsule Graphic Placeholder */}
            <div className="relative inline-block capsule-float mb-8">
              <div className="w-48 h-48 rounded-full bg-[#0d4c4f]/30 blur-2xl absolute -inset-4"></div>
              <img 
                className="relative z-10 w-40 h-40 object-contain mx-auto" 
                alt="3D Pharmaceutical Capsule"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuC6PVM1ffTGiytlLkam4dCik4bViawGo81jjpDEyltYqcYuzqRRq5uf6dRKTC6cjN_nb3Glx6iYJwypkAVY9HYVXondxugpPVOF5U4RcK3uYfoUNTPGQCcyyEpNiAqeb-_aAXYu4VoHYMlMUAe6np1lwUyv9w1T24HPk1DQASwWAMsblEZ-nsVBA5g18UUnafGVlF5OSdokwcKzG-Z3SYo5D_B-tvYehmCTIRNKXASBVeLYA8Uo83szmw"
              />
            </div>
            <h2 className="font-headline-lg text-headline-lg mb-4 text-white">Tenant Management</h2>
            <p className="font-body-lg text-body-lg text-[#b5ecf0]/80 max-w-xs mx-auto">
              Secure administrative portal for pharmacy enrollment and developer operations.
            </p>
          </div>

          <footer className="mt-auto pt-8 border-t border-white/10 flex flex-wrap gap-4">
            <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/10">
              <span className="material-symbols-outlined text-sm text-[#b5ecf0]">verified_user</span>
              <span className="text-[10px] font-label-caps uppercase tracking-widest text-[#b5ecf0]">System Integrity Verified</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/10">
              <span className="material-symbols-outlined text-sm text-[#b5ecf0]">encrypted</span>
              <span className="text-[10px] font-label-caps uppercase tracking-widest text-[#b5ecf0]">Developer Access Encrypted</span>
            </div>
          </footer>
        </div>

        {/* Right Side: Login Form */}
        <div className="flex-1 p-10 flex flex-col justify-center bg-white/60">
          <div className="max-w-sm mx-auto w-full">
            {/* Mobile Logo */}
            <div className="md:hidden flex items-center gap-2 mb-8">
              <span className="material-symbols-outlined text-[#003436]">science</span>
              <span className="font-headline-sm text-headline-sm font-bold text-[#003436]">PharmHelm</span>
            </div>

            <div className="mb-10">
              <h3 className="font-headline-lg text-headline-lg text-[#171d1c] mb-2">{greeting}</h3>
              <p className="text-[#404849] font-body-md">Please verify your credentials to access the console.</p>
            </div>

            <form onSubmit={handleSubmit} className={`space-y-6 transition-all duration-300 ${shake ? 'animate-shake' : ''}`} id="loginForm">
              
              {/* Error messages block */}
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-600 text-xs rounded-2xl font-bold text-center uppercase tracking-wider">
                  {error}
                </div>
              )}

              {/* Email Field */}
              <div className="space-y-2">
                <label className="font-label-caps text-label-caps text-[#404849] block ml-4" htmlFor="email">Administrator Email</label>
                <div className="relative group">
                  <span className="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 text-[#707979] group-focus-within:text-[#003436] transition-colors">alternate_email</span>
                  <input 
                    className="w-full pl-14 pr-6 py-4 rounded-full bg-white border border-[#bfc8c8] hover:border-[#707979] focus:border-[#003436] focus:ring-1 focus:ring-[#003436] outline-none transition-all font-code-sm text-code-sm text-[#171d1c]" 
                    id="email" 
                    placeholder="admin@pharmhelm.systems" 
                    required 
                    type="email"
                    value={email}
                    disabled={loading}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              {/* Password/Token Field */}
              <div className="space-y-2">
                <div className="flex justify-between items-center px-4">
                  <label className="font-label-caps text-label-caps text-[#404849]" htmlFor="token">Security Token</label>
                  <button 
                    type="button" 
                    onClick={() => toast.info("Please contact security desk for token reset.")} 
                    className="text-[11px] font-label-caps text-[#003436] hover:underline uppercase"
                  >
                    Reset
                  </button>
                </div>
                <div className="relative group">
                  <span className="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 text-[#707979] group-focus-within:text-[#003436] transition-colors">key</span>
                  <input 
                    className="w-full pl-14 pr-14 py-4 rounded-full bg-white border border-[#bfc8c8] hover:border-[#707979] focus:border-[#003436] focus:ring-1 focus:ring-[#003436] outline-none transition-all font-code-sm text-code-sm text-[#171d1c]" 
                    id="token" 
                    placeholder="••••••••••••••••" 
                    required 
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    disabled={loading}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button 
                    className="absolute right-5 top-1/2 -translate-y-1/2 text-[#707979] hover:text-[#404849] transition-colors p-1" 
                    onClick={() => setShowPassword(!showPassword)} 
                    type="button"
                  >
                    <span className="material-symbols-outlined" id="eyeIcon">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Checkbox Actions */}
              <div className="flex items-center justify-between px-2">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div className="relative flex items-center">
                    <input className="peer hidden" type="checkbox" defaultChecked />
                    <div className="w-5 h-5 rounded-md border-2 border-[#707979] group-hover:border-[#003436] peer-checked:bg-[#003436] peer-checked:border-[#003436] transition-all flex items-center justify-center">
                      <span className="material-symbols-outlined text-[14px] text-white hidden peer-checked:block">check</span>
                    </div>
                  </div>
                  <span className="font-body-md text-[#404849] select-none">Keep me active</span>
                </label>
                <span className="text-[11px] font-code-sm text-[#bfc8c8]">v2.4.0-STABLE</span>
              </div>

              {/* Submit Button */}
              <button 
                className="w-full py-4 rounded-full bg-[#003436] text-white font-headline-sm text-headline-sm font-semibold hover:bg-[#0d4c4f] hover:shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed" 
                type="submit"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="animate-spin material-symbols-outlined">progress_activity</span>
                    <span>{isLoggingIn ? 'Verified' : 'Authenticating...'}</span>
                  </>
                ) : (
                  <>
                    <span>Sign In</span>
                    <span className="material-symbols-outlined text-sm">arrow_forward</span>
                  </>
                )}
              </button>
            </form>

            {/* Footer Links */}
            <div className="mt-12 flex items-center justify-center gap-6">
              <a className="text-[12px] text-[#404849] hover:text-[#003436] transition-colors" href={termsOfUseLink} target="_blank" rel="noopener noreferrer">Terms of Service</a>
              <div className="w-1.5 h-1.5 rounded-full bg-[#bfc8c8]"></div>
              <a className="text-[12px] text-[#404849] hover:text-[#003436] transition-colors" href="#">Documentation</a>
              <div className="w-1.5 h-1.5 rounded-full bg-[#bfc8c8]"></div>
              <a className="text-[12px] text-[#404849] hover:text-[#003436] transition-colors" href="#">Security Standards</a>
              <div className="w-1.5 h-1.5 rounded-full bg-[#bfc8c8]"></div>
              <a className="text-[12px] text-[#404849] hover:text-[#003436] transition-colors" href="#">Support</a>
              <div className="w-1.5 h-1.5 rounded-full bg-[#bfc8c8]"></div>
              <a className="text-[12px] text-[#404849] hover:text-[#003436] transition-colors font-bold" href={getPublicLink('/about')} target="_blank" rel="noopener noreferrer">About Us</a>
            </div>
          </div>
        </div>
      </main>

      {/* Mobile-Only Badges (Visible at bottom on small screens) */}
      <div className="fixed bottom-4 left-0 right-0 md:hidden flex justify-center gap-2 z-10">
        <div className="px-3 py-1 bg-[#003436]/10 rounded-full border border-[#003436]/20 flex items-center gap-1 backdrop-blur-sm">
          <span className="material-symbols-outlined text-[12px] text-[#003436]">verified_user</span>
          <span className="text-[9px] font-label-caps uppercase text-[#003436]">Integrity Verified</span>
        </div>
        <div className="px-3 py-1 bg-[#003436]/10 rounded-full border border-[#003436]/20 flex items-center gap-1 backdrop-blur-sm">
          <span className="material-symbols-outlined text-[12px] text-[#003436]">encrypted</span>
          <span className="text-[9px] font-label-caps uppercase text-[#003436]">Encrypted</span>
        </div>
      </div>
    </div>
  );
}
