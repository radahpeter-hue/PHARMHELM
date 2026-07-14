import React, { useState, useEffect } from 'react';
import { 
  AlertTriangle, ShieldAlert, Search, Plus, Filter, 
  User, Calendar, FileText, MoreVertical, Edit2, 
  Trash2, X, CheckCircle2, AlertCircle, Info
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';
import { Staff, DisciplinaryIncident } from '../../types';
import { toast } from 'sonner';
import { cn } from '../../utils/cn';

export const PerformanceDiscipline: React.FC = () => {
  const { profile } = useAuth();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [incidents, setIncidents] = useState<DisciplinaryIncident[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIncident, setEditingIncident] = useState<DisciplinaryIncident | null>(null);

  useEffect(() => {
    if (profile?.tenantId) {
      firestoreService.subscribeToCollection<Staff>('staff', profile.tenantId, setStaff);
      return firestoreService.subscribeToCollection<DisciplinaryIncident>(
        'disciplinary_incidents',
        profile.tenantId,
        setIncidents
      );
    }
  }, [profile?.tenantId]);

  const filteredIncidents = incidents.filter(inc => {
    const staffMember = staff.find(s => s.id === inc.staffId);
    return staffMember?.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
           inc.incident_type.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this incident record?')) {
      try {
        await firestoreService.deleteDocument('disciplinary_incidents', id);
        toast.success('Incident record deleted');
      } catch (error) {
        toast.error('Failed to delete incident record');
      }
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'low': return 'bg-blue-50 text-blue-600 border-blue-100';
      case 'medium': return 'bg-amber-50 text-amber-600 border-amber-100';
      case 'high': return 'bg-rose-50 text-rose-600 border-rose-100';
      case 'critical': return 'bg-rose-600 text-white border-rose-700';
      default: return 'bg-slate-50 text-slate-600 border-slate-100';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard 
          label="Total Incidents" 
          value={incidents.length} 
          icon={AlertTriangle} 
          color="text-slate-600" 
          bgColor="bg-slate-50" 
        />
        <StatCard 
          label="Gross Misconduct" 
          value={incidents.filter(i => i.incident_type === 'Gross Misconduct').length} 
          icon={ShieldAlert} 
          color="text-rose-600" 
          bgColor="bg-rose-50" 
        />
        <StatCard 
          label="Open Issues" 
          value={incidents.filter(i => i.status === 'open').length} 
          icon={Info} 
          color="text-amber-600" 
          bgColor="bg-amber-50" 
        />
        <StatCard 
          label="Resolved" 
          value={incidents.filter(i => i.status === 'resolved').length} 
          icon={CheckCircle2} 
          color="text-emerald-600" 
          bgColor="bg-emerald-50" 
        />
      </div>

      {/* Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Search by staff or incident type..." 
            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button 
          onClick={() => {
            setEditingIncident(null);
            setIsModalOpen(true);
          }}
          className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 shadow-lg shadow-slate-200 uppercase text-[10px] tracking-widest"
        >
          <Plus size={18} />
          Log Incident
        </button>
      </div>

      {/* Incidents List */}
      <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100 bg-slate-50/50">
                <th className="px-6 py-4">Staff Member</th>
                <th className="px-6 py-4">Incident Details</th>
                <th className="px-6 py-4">Severity & Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredIncidents.map((inc) => {
                const member = staff.find(s => s.id === inc.staffId);
                return (
                  <tr key={inc.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
                          <User size={20} />
                        </div>
                        <div>
                          <p className="font-bold text-slate-900">{member?.full_name || 'Unknown'}</p>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{member?.role}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold text-slate-700">{inc.incident_type}</p>
                      <p className="text-xs text-slate-500 flex items-center gap-1">
                        <Calendar size={12} className="text-slate-400" />
                        {new Date(inc.date).toLocaleDateString()}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-2">
                        <span className={cn(
                          "px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border w-fit",
                          getSeverityColor(inc.severity)
                        )}>
                          {inc.severity}
                        </span>
                        <span className={cn(
                          "px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border w-fit",
                          inc.status === 'resolved' ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-amber-50 text-amber-600 border-amber-100"
                        )}>
                          {inc.status}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => {
                            setEditingIncident(inc);
                            setIsModalOpen(true);
                          }}
                          className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => handleDelete(inc.id)}
                          className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <IncidentModal 
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          incident={editingIncident}
          staff={staff}
        />
      )}
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: number; icon: any; color: string; bgColor: string }> = ({ label, value, icon: Icon, color, bgColor }) => (
  <div className="bg-white p-6 rounded-[24px] border border-slate-200 shadow-sm">
    <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center mb-4", bgColor, color)}>
      <Icon size={20} />
    </div>
    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
    <p className="text-2xl font-bold text-slate-900">{value}</p>
  </div>
);

const IncidentModal: React.FC<{ isOpen: boolean; onClose: () => void; incident: DisciplinaryIncident | null; staff: Staff[] }> = ({ isOpen, onClose, incident, staff }) => {
  const { profile } = useAuth();
  const [formData, setFormData] = useState<Partial<DisciplinaryIncident>>(incident || {
    staffId: '',
    date: new Date().toISOString().split('T')[0],
    incident_type: 'Minor',
    description: '',
    action_taken: '',
    status: 'open'
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.tenantId) return;

    try {
      if (incident?.id) {
        await firestoreService.updateDocument('disciplinary_incidents', incident.id, formData);
        toast.success('Incident record updated');
      } else {
        await firestoreService.addDocument('disciplinary_incidents', {
          ...formData,
          tenantId: profile.tenantId
        });
        toast.success('Incident logged successfully');
      }
      onClose();
    } catch (error) {
      toast.error('Failed to save incident record');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">
            {incident ? 'Edit Incident Record' : 'Log New Incident'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={24} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Staff Member *</label>
              <select required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl" value={formData.staffId || ''} onChange={(e) => setFormData({ ...formData, staffId: e.target.value })}>
                <option value="">Select Staff...</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Incident Date *</label>
              <input required type="date" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl" value={formData.date || ''} onChange={(e) => setFormData({ ...formData, date: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Incident Type *</label>
              <select required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl" value={formData.incident_type || 'Minor'} onChange={(e) => setFormData({ ...formData, incident_type: e.target.value as any })}>
                <option value="Minor">Minor</option>
                <option value="Major">Major</option>
                <option value="Gross Misconduct">Gross Misconduct</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Description *</label>
            <textarea required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl resize-none" rows={3} value={formData.description || ''} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Action Taken</label>
              <input type="text" placeholder="e.g. Verbal warning" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl" value={formData.action_taken || ''} onChange={(e) => setFormData({ ...formData, action_taken: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Status</label>
              <select className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl" value={formData.status || 'open'} onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}>
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
                <option value="appealed">Appealed</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="px-6 py-2 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50 transition-colors uppercase text-[10px] tracking-widest">Cancel</button>
            <button type="submit" className="px-8 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold transition-all shadow-lg shadow-slate-200 uppercase text-[10px] tracking-widest">
              {incident ? 'Update Record' : 'Log Incident'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
