import React, { useState, useEffect } from 'react';
import { 
  Search, User, Phone, Mail, BadgeCheck, 
  Clock, AlertCircle, FileText
} from 'lucide-react';
import { db } from '../../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { Staff } from '../../types';
import { cn } from '../../utils/cn';

export const PersonnelRegister: React.FC = () => {
  const { profile } = useAuth();
  const [personnel, setPersonnel] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!profile?.tenantId) return;

    const q = query(
      collection(db, 'staff'),
      where('tenantId', '==', profile.tenantId),
      where('role', 'in', ['Transport & Logistics Personnel', 'Logistics Head'])
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as Staff));
      setPersonnel(data);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [profile?.tenantId]);

  const filteredPersonnel = personnel.filter(p => 
    p.full_name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search personnel..."
            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          <div className="col-span-full py-12 text-center text-slate-500">Loading personnel...</div>
        ) : filteredPersonnel.length === 0 ? (
          <div className="col-span-full py-12 text-center text-slate-500">No logistics personnel found</div>
        ) : (
          filteredPersonnel.map((person) => (
            <div key={person.uid} className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div className="h-12 w-12 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600">
                  <User className="h-6 w-6" />
                </div>
                <span className={cn(
                  "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                  person.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                )}>
                  {person.active ? 'Active' : 'Inactive'}
                </span>
              </div>
              
              <div className="space-y-1 mb-4">
                <h4 className="font-semibold text-slate-900 leading-tight">{person.full_name}</h4>
                <p className="text-sm text-indigo-600 font-medium">{person.role}</p>
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Phone className="h-4 w-4 text-slate-400" />
                  {person.phone_number}
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Mail className="h-4 w-4 text-slate-400" />
                  {person.email}
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <BadgeCheck className="h-4 w-4 text-slate-400" />
                  <span>License: {person.professional_licence_number || 'N/A'}</span>
                </div>
                {person.licence_expiry_date && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Clock className="h-4 w-4 text-slate-400" />
                    <span>Expires: {person.licence_expiry_date}</span>
                  </div>
                )}
              </div>

              <div className="mt-6 pt-6 border-t border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <FileText className="h-3.5 w-3.5" />
                  <span>3 Trips this week</span>
                </div>
                <button className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors">
                  View Profile
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
