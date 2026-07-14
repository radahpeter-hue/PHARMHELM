import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Building2, ArrowRight, LogOut } from 'lucide-react';
import { motion } from 'motion/react';

const BranchSelector: React.FC = () => {
  const { assignedBranches, setActiveBranchId, logout, profile } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-2xl w-full"
      >
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-xl">
          <div className="flex justify-between items-start mb-8">
            <div>
              <h1 className="text-2xl font-bold text-zinc-900">Select Branch</h1>
              <p className="text-zinc-500">Welcome back, {profile?.displayName}. Please select a branch to continue.</p>
            </div>
            <button 
              onClick={logout}
              className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-xl transition-colors flex items-center gap-2 text-sm font-medium"
            >
              <LogOut size={18} />
              Sign Out
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {assignedBranches.map((branch) => (
              <button
                key={branch.id}
                onClick={() => setActiveBranchId(branch.id)}
                className="group p-6 text-left bg-white border border-zinc-200 rounded-2xl hover:border-emerald-500 hover:shadow-lg hover:shadow-emerald-500/5 transition-all"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="h-12 w-12 bg-zinc-100 group-hover:bg-emerald-50 rounded-xl flex items-center justify-center transition-colors">
                    <Building2 className="text-zinc-500 group-hover:text-emerald-600" size={24} />
                  </div>
                  <ArrowRight className="text-zinc-300 group-hover:text-emerald-500 group-hover:translate-x-1 transition-all" size={20} />
                </div>
                <h3 className="font-bold text-zinc-900 group-hover:text-emerald-700 transition-colors">{branch.name}</h3>
                <p className="text-sm text-zinc-500 mt-1">{branch.type} • {branch.branch_code}</p>
                <p className="text-xs text-zinc-400 mt-2 line-clamp-1">{branch.address}</p>
              </button>
            ))}
          </div>

          {assignedBranches.length === 0 && (
            <div className="text-center py-12">
              <div className="h-16 w-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Building2 className="text-red-500" size={32} />
              </div>
              <h3 className="text-lg font-bold text-zinc-900">No Branches Assigned</h3>
              <p className="text-zinc-500 max-w-xs mx-auto mt-2">
                Your account has not been assigned to any branches. Please contact your administrator.
              </p>
              <button 
                onClick={logout}
                className="mt-6 px-6 py-2 bg-zinc-900 text-white rounded-xl font-medium hover:bg-zinc-800 transition-colors"
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default BranchSelector;
