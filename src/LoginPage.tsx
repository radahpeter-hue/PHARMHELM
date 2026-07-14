import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import { Pill, Lock, Mail, Loader2 } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email, password);
    } catch (err) {
      setError('Invalid credentials. Please use the demo accounts.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-pharm-dark p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-pharm-primary/10 text-pharm-primary mb-4">
            <Pill size={32} />
          </div>
          <h1 className="text-3xl font-display font-bold text-white mb-2">PharmHelm Pro ERP</h1>
          <p className="text-white/60">Foundation Cluster — Week 1</p>
        </div>

        <div className="pharm-card p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={18} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pharm-input w-full pl-10"
                  placeholder="admin@pharmapro.io"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={18} />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pharm-input w-full pl-10"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="pharm-btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : 'Sign In'}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-white/5">
            <p className="text-xs text-white/40 mb-3 uppercase tracking-wider font-semibold">Demo Accounts</p>
            <div className="space-y-2">
              <div className="text-xs text-white/60 flex justify-between">
                <span>Super Admin:</span>
                <span className="font-mono">admin@pharmapro.io / devadmin@001#</span>
              </div>
              <div className="text-xs text-white/60 flex justify-between">
                <span>IT Head:</span>
                <span className="font-mono">it@radah.pharmflow.io / Demo1234!</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
