import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, 
  Building2, 
  UserCog, 
  Plus, 
  Search, 
  Filter, 
  MoreVertical, 
  Edit2, 
  Trash2, 
  Mail, 
  Phone, 
  MapPin, 
  ShieldCheck,
  CreditCard,
  Stethoscope,
  ChevronRight,
  X,
  FileText,
  Download,
  Activity,
  Heart,
  Calendar,
  UserPlus,
  AlertCircle,
  CheckCircle2,
  Clock,
  Truck
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { firestoreService } from '../services/firestore';
import { Client, InstitutionRegistry, Prescriber, Staff } from '../types';
import { toast } from 'sonner';
import { deduplicateStaff } from '../utils/deduplicateStaff';
import { twMerge } from 'tailwind-merge';
import { clsx, type ClassValue } from 'clsx';
import { format } from 'date-fns';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const Clients: React.FC = () => {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState<'patients' | 'institutions' | 'prescribers' | 'suppliers' | 'reports'>('patients');
  const [patients, setPatients] = useState<Client[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [institutions, setInstitutions] = useState<InstitutionRegistry[]>([]);
  const [suppliers, setSuppliers] = useState<InstitutionRegistry[]>([]);
  const [prescribers, setPrescribers] = useState<Prescriber[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [selectedItemForDetails, setSelectedItemForDetails] = useState<any>(null);
  const [labelFilters, setLabelFilters] = useState<string[]>([]);

  useEffect(() => {
    if (profile?.tenantId) {
      const unsubscribers = [firestoreService.subscribeToCollection<Client>(
        'clients',
        profile.tenantId,
        setPatients
      ), firestoreService.subscribeToCollection<Staff>(
        'staff',
        profile.tenantId,
        setStaff
      ), firestoreService.subscribeToCollection<InstitutionRegistry>(
        'institutions',
        profile.tenantId,
        setInstitutions
      ), firestoreService.subscribeToCollection<InstitutionRegistry>(
        'supplier_registry',
        profile.tenantId,
        setSuppliers
      ), firestoreService.subscribeToCollection<Prescriber>(
        'prescribers',
        profile.tenantId,
        setPrescribers
      )];

      return () => unsubscribers.forEach(unsubscribe => unsubscribe());
    }
  }, [profile?.tenantId]);

  const combinedPatients = useMemo(() => {
    const all = [
      ...patients.map(patient => ({ ...patient, isStaff: false })),
      ...staff.map(staffMember => ({
        id: staffMember.id,
        uid: staffMember.uid,
        tenantId: staffMember.tenantId,
        full_name: staffMember.full_name || staffMember.username || 'Unknown Staff',
        phone_number: staffMember.phone_number || 'N/A',
        billing_type: 'Staff / Welfare',
        care_status: staffMember.status,
        status: staffMember.status,
        isStaff: true,
      })),
    ];
    return deduplicateStaff(all);
  }, [patients, staff]);

  const handleDelete = async (collection: string, id: string) => {
    if (window.confirm('Are you sure you want to delete this entry?')) {
      try {
        await firestoreService.deleteDocument(collection, id);
        toast.success('Entry deleted successfully');
      } catch (error) {
        toast.error('Failed to delete entry');
      }
    }
  };

  const filteredData = () => {
    const term = searchTerm.toLowerCase();
    if (activeTab === 'patients') {
      return combinedPatients.filter(p => (p.full_name || '').toLowerCase().includes(term) || (p.phone_number || '').includes(term));
    } else if (activeTab === 'institutions') {
      return institutions.filter(i => i.supplier_name.toLowerCase().includes(term));
    } else if (activeTab === 'prescribers') {
      return prescribers.filter(p => p.full_name.toLowerCase().includes(term) || p.specialty.toLowerCase().includes(term));
    } else if (activeTab === 'suppliers') {
      return suppliers.filter(s => (s.supplier_name || '').toLowerCase().includes(term) || (s.supplier_id || '').toLowerCase().includes(term));
    }
    return [];
  };

  const combinedPatientsCount = combinedPatients.length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-zinc-900 tracking-tight">Clients & Partners</h1>
          <p className="text-zinc-500 text-sm font-medium">Manage patients, corporate accounts, clinical partners, and suppliers.</p>
        </div>
        <button 
          onClick={() => {
            setEditingItem(null);
            setIsModalOpen(true);
          }}
          className="bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-3 rounded-2xl font-bold transition-all flex items-center gap-2 w-fit shadow-lg shadow-zinc-900/20 uppercase text-xs tracking-widest"
        >
          <Plus size={20} />
          Add {activeTab === 'patients' ? 'Patient' : activeTab === 'institutions' ? 'Institution' : activeTab === 'suppliers' ? 'Supplier' : 'Prescriber'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 bg-zinc-100 p-1.5 rounded-2xl w-fit">
        <TabButton 
          active={activeTab === 'patients'} 
          onClick={() => setActiveTab('patients')}
          icon={Users}
          label="Patients"
          count={combinedPatientsCount}
        />
        <TabButton 
          active={activeTab === 'institutions'} 
          onClick={() => setActiveTab('institutions')}
          icon={Building2}
          label="Institutions"
          count={institutions.length}
        />
        <TabButton 
          active={activeTab === 'prescribers'} 
          onClick={() => setActiveTab('prescribers')}
          icon={UserCog}
          label="Prescribers"
          count={prescribers.length}
        />
        <TabButton 
          active={activeTab === 'suppliers'} 
          onClick={() => setActiveTab('suppliers')}
          icon={Truck}
          label="Suppliers"
          count={suppliers.length}
        />
        <TabButton 
          active={activeTab === 'reports'} 
          onClick={() => setActiveTab('reports')}
          icon={FileText}
          label="Reports Hub"
          count={4}
        />
      </div>

      {activeTab === 'reports' ? (
        <ReportsHub 
          patients={patients}
          institutions={institutions}
          prescribers={prescribers}
        />
      ) : (
        <div className="bg-white rounded-[32px] border border-zinc-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-zinc-100 flex flex-col md:flex-row gap-4 items-center">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
              <input 
                type="text"
                placeholder={`Search ${activeTab}...`}
                className="w-full pl-10 pr-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-500/20 focus:border-zinc-500 transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <button className="px-4 py-2 border border-zinc-200 rounded-xl flex items-center gap-2 text-zinc-600 hover:bg-zinc-50 transition-colors text-sm font-bold">
              <Filter size={18} />
              Filter
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50/50 border-b border-zinc-100">
                  <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Identity</th>
                  <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Contact / Location</th>
                  <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Status / Type</th>
                  <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em] text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filteredData().map((item: any) => (
                  <tr 
                    key={item.id} 
                    className="hover:bg-zinc-50/50 transition-colors group cursor-pointer"
                    onClick={() => setSelectedItemForDetails(item)}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "h-10 w-10 rounded-xl flex items-center justify-center",
                          activeTab === 'patients' ? "bg-blue-50 text-blue-600" : 
                          activeTab === 'institutions' ? "bg-emerald-50 text-emerald-600" : 
                          activeTab === 'suppliers' ? "bg-amber-50 text-amber-600" :
                          "bg-purple-50 text-purple-600"
                        )}>
                          {activeTab === 'patients' ? <Users size={20} /> : 
                           activeTab === 'institutions' ? <Building2 size={20} /> : 
                           activeTab === 'suppliers' ? <Truck size={20} /> :
                           <Stethoscope size={20} />}
                        </div>
                        <div>
                          <p className="font-bold text-zinc-900">
                            {activeTab === 'institutions' ? item.supplier_name : 
                             activeTab === 'suppliers' ? item.supplier_name : 
                             item.full_name}
                          </p>
                          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">
                            {activeTab === 'patients' ? (
                              <>
                                DOB: {item.date_of_birth || 'N/A'}
                                {item.year_of_birth && ` • Age: ${new Date().getFullYear() - item.year_of_birth}`}
                              </>
                            ) : 
                             activeTab === 'institutions' ? item.commercial_category : 
                             activeTab === 'suppliers' ? item.commercial_category :
                             item.specialty}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 text-xs text-zinc-600">
                          {activeTab === 'suppliers' ? (
                            <>Code: {item.supplier_id || 'N/A'}</>
                          ) : (
                            <>
                              <Phone size={12} className="text-zinc-400" />
                              {item.phone_number}
                            </>
                          )}
                        </div>
                        {activeTab === 'suppliers' && item.payment_terms && (
                          <div className="text-[10px] text-zinc-400">
                            Payment Terms: {item.payment_terms}
                          </div>
                        )}
                        {item.address && (
                          <div className="flex items-center gap-2 text-[10px] text-zinc-400">
                            <MapPin size={10} />
                            {item.address}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-2">
                        {activeTab === 'suppliers' ? (
                          <span className={cn(
                            "px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider w-fit",
                            item.is_suspended ? "bg-red-50 text-red-600 border border-red-100" : "bg-emerald-50 text-emerald-600 border border-emerald-100"
                          )}>
                            {item.is_suspended ? "Suspended" : "Active"}
                          </span>
                        ) : (
                          <span className={cn(
                            "px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider w-fit",
                            item.status === 'active' || item.care_status === 'active' ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : "bg-zinc-100 text-zinc-500"
                          )}>
                            {item.status || item.care_status}
                          </span>
                        )}
                        {activeTab === 'patients' && (
                          <span className="text-[10px] font-bold text-zinc-400 uppercase">
                            {item.billing_type}
                          </span>
                        )}
                        {activeTab === 'suppliers' && item.nda_licence_status && (
                          <span className="text-[10px] font-bold text-zinc-400 uppercase">
                            NDA Licence: {item.nda_licence_status}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => {
                            if (item.isStaff) {
                              toast.info('Staff customer details are managed in HR Admin.');
                              return;
                            }
                            setEditingItem(item);
                            setIsModalOpen(true);
                          }}
                          className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => {
                            if (item.isStaff) {
                              toast.info('Staff customers are linked to HR records and cannot be deleted here.');
                              return;
                            }
                            handleDelete(activeTab === 'patients' ? 'clients' : activeTab === 'institutions' ? 'institutions' : activeTab === 'suppliers' ? 'supplier_registry' : 'prescribers', item.id);
                          }}
                          title={item.isStaff ? 'Manage this staff record in HR Admin' : 'Delete entry'}
                          className={cn(
                            "p-2 rounded-lg transition-all",
                            item.isStaff ? "text-zinc-300 cursor-help" : "text-zinc-400 hover:text-red-500 hover:bg-red-50"
                          )}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isModalOpen && (
        <RegistryModal 
          type={activeTab}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          item={editingItem}
          institutions={institutions}
        />
      )}

      {selectedItemForDetails && (
        <DetailsModal
          isOpen={!!selectedItemForDetails}
          onClose={() => setSelectedItemForDetails(null)}
          item={selectedItemForDetails}
          type={activeTab}
          institutions={institutions}
          onEdit={(item) => {
            setEditingItem(item);
            setIsModalOpen(true);
          }}
        />
      )}
    </div>
  );
};

// Sub-components
const TabButton: React.FC<{ active: boolean; onClick: () => void; icon: any; label: string; count: number }> = ({ active, onClick, icon: Icon, label, count }) => (
  <button 
    onClick={onClick}
    className={cn(
      "flex items-center gap-3 px-4 py-2 rounded-xl transition-all",
      active ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:bg-white/50"
    )}
  >
    <Icon size={18} className={active ? "text-zinc-900" : "text-zinc-400"} />
    <span className="text-sm font-bold">{label}</span>
    <span className={cn(
      "px-1.5 py-0.5 rounded-md text-[10px] font-black",
      active ? "bg-zinc-900 text-white" : "bg-zinc-200 text-zinc-500"
    )}>
      {count}
    </span>
  </button>
);

const RegistryModal: React.FC<{ type: string; isOpen: boolean; onClose: () => void; item: any; institutions: InstitutionRegistry[] }> = ({ type, isOpen, onClose, item, institutions }) => {
  const { profile } = useAuth();
  const [formData, setFormData] = useState<any>(item || {
    labels: [],
    is_chronic_care: false,
    care_status: 'active',
    billing_type: 'self-pay',
    status: 'active',
    role: 'primary_care',
    subtype: 'hospital/clinic',
    commercial_category: 'Wholesale',
    nda_licence_status: 'valid',
    is_suspended: false,
    whtExempt: false
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.tenantId) return;

    const collection = type === 'patients' ? 'clients' : type === 'institutions' ? 'institutions' : type === 'suppliers' ? 'supplier_registry' : 'prescribers';
    
    try {
      if (item?.id) {
        await firestoreService.updateDocument(collection, item.id, formData);
        toast.success('Updated successfully');
      } else {
        await firestoreService.addDocument(collection, {
          ...formData,
          tenantId: profile.tenantId,
        });
        toast.success('Added successfully');
      }
      onClose();
    } catch (error) {
      toast.error('Failed to save');
    }
  };

  const toggleLabel = (label: string) => {
    const currentLabels = formData.labels || [];
    if (currentLabels.includes(label)) {
      setFormData({ ...formData, labels: currentLabels.filter((l: string) => l !== label) });
    } else {
      setFormData({ ...formData, labels: [...currentLabels, label] });
    }
  };

  const labels = ['vip', 'delivery', 'price sensitive', 'credit liability', 'corporate', 'insurance'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white w-full max-w-3xl rounded-[32px] shadow-2xl overflow-hidden my-8">
        <div className="px-8 py-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
          <div>
            <h2 className="text-xl font-black text-zinc-900 uppercase tracking-tight">
              {item ? 'Edit' : 'Add New'} {type.slice(0, -1)}
            </h2>
            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Registry Function</p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 transition-colors">
            <X size={24} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-8 space-y-8 max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {type === 'patients' && (
              <>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Full Name *</label>
                  <input required type="text" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.full_name || ''} onChange={(e) => setFormData({ ...formData, full_name: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Phone Number *</label>
                  <input required type="text" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.phone_number || ''} onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Sex</label>
                  <select className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.sex || ''} onChange={(e) => setFormData({ ...formData, sex: e.target.value })}>
                    <option value="">Select...</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Year of Birth (Optional)</label>
                  <input 
                    type="number" 
                    placeholder="e.g. 1990"
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" 
                    value={formData.year_of_birth || ''} 
                    onChange={(e) => setFormData({ ...formData, year_of_birth: e.target.value ? Number(e.target.value) : undefined })} 
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Care Status</label>
                  <select className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.care_status || 'active'} onChange={(e) => setFormData({ ...formData, care_status: e.target.value })}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="blacklisted">Blacklisted</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Billing Type</label>
                  <select className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.billing_type || 'self-pay'} onChange={(e) => setFormData({ ...formData, billing_type: e.target.value })}>
                    <option value="self-pay">Self-Pay</option>
                    <option value="institutional-pay">Institutional-Pay</option>
                  </select>
                </div>
                {formData.billing_type === 'institutional-pay' && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Institution to Bill</label>
                    <select required className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.institution_to_bill_id || ''} onChange={(e) => setFormData({ ...formData, institution_to_bill_id: e.target.value })}>
                      <option value="">Select Institution...</option>
                      {institutions.filter(i => i.role === 'billable' || i.role === 'both').map(i => (
                        <option key={i.id} value={i.id}>{i.supplier_name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Institution of Care</label>
                  <select className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.institution_of_care_id || ''} onChange={(e) => setFormData({ ...formData, institution_of_care_id: e.target.value })}>
                    <option value="">None</option>
                    {institutions.map(i => (
                      <option key={i.id} value={i.id}>{i.supplier_name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Client Labels</label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {labels.map(label => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => toggleLabel(label)}
                        className={cn(
                          "px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all",
                          formData.labels?.includes(label) 
                            ? "bg-zinc-900 text-white border-zinc-900" 
                            : "bg-white text-zinc-400 border-zinc-200 hover:border-zinc-400"
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Notes (History / Delivery Instructions)</label>
                  <textarea className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none resize-none" rows={3} value={formData.notes || ''} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} />
                </div>

                <div className="md:col-span-2 p-6 bg-emerald-50/50 rounded-3xl border border-emerald-100 space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Heart className="text-emerald-600" size={20} />
                      <h3 className="text-xs font-black text-emerald-900 uppercase tracking-widest">Chronic Care Program</h3>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={formData.is_chronic_care} onChange={(e) => setFormData({ ...formData, is_chronic_care: e.target.checked })} />
                      <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                    </label>
                  </div>

                  {formData.is_chronic_care && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-top-2 duration-300">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">Chronic Condition</label>
                        <input type="text" className="w-full px-4 py-2 bg-white border border-emerald-200 rounded-xl outline-none" value={formData.chronic_condition || ''} onChange={(e) => setFormData({ ...formData, chronic_condition: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">Refill Cycle (Days)</label>
                        <input type="number" className="w-full px-4 py-2 bg-white border border-emerald-200 rounded-xl outline-none" value={formData.refill_cycle_days || 30} onChange={(e) => setFormData({ ...formData, refill_cycle_days: Number(e.target.value) })} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">Payment Preference</label>
                        <select className="w-full px-4 py-2 bg-white border border-emerald-200 rounded-xl outline-none" value={formData.payment_preference || ''} onChange={(e) => setFormData({ ...formData, payment_preference: e.target.value })}>
                          <option value="">Select...</option>
                          <option value="Cash">Cash</option>
                          <option value="Mobile Money">Mobile Money</option>
                          <option value="Insurance">Insurance</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">Next of Kin Name</label>
                        <input type="text" className="w-full px-4 py-2 bg-white border border-emerald-200 rounded-xl outline-none" value={formData.next_of_kin_name || ''} onChange={(e) => setFormData({ ...formData, next_of_kin_name: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">Next of Kin Contact</label>
                        <input type="text" className="w-full px-4 py-2 bg-white border border-emerald-200 rounded-xl outline-none" value={formData.next_of_kin_contact || ''} onChange={(e) => setFormData({ ...formData, next_of_kin_contact: e.target.value })} />
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {type === 'institutions' && (
              <>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Institution Name *</label>
                  <input required type="text" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.supplier_name || ''} onChange={(e) => setFormData({ ...formData, supplier_name: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Institution Phone</label>
                  <input type="text" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.institution_phone || ''} onChange={(e) => setFormData({ ...formData, institution_phone: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Institution Email</label>
                  <input type="email" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.institution_email || ''} onChange={(e) => setFormData({ ...formData, institution_email: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Subtype</label>
                  <select className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.subtype || 'hospital/clinic'} onChange={(e) => setFormData({ ...formData, subtype: e.target.value })}>
                    <option value="hospital/clinic">Hospital/Clinic</option>
                    <option value="corporate">Corporate Institution</option>
                    <option value="NGO">NGO</option>
                    <option value="school">School</option>
                    <option value="insurance">Insurance Company</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Status</label>
                  <select className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.status || 'active'} onChange={(e) => setFormData({ ...formData, status: e.target.value })}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="blacklisted">Blacklisted</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Institutional Role</label>
                  <select className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.role || 'primary_care'} onChange={(e) => setFormData({ ...formData, role: e.target.value })}>
                    <option value="primary_care">Primary Care Only</option>
                    <option value="billable">Billable to Clients</option>
                    <option value="both">Both</option>
                  </select>
                </div>

                {(formData.role === 'billable' || formData.role === 'both') && (
                  <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6 p-6 bg-zinc-50 rounded-3xl border border-zinc-100">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Payment Terms</label>
                      <input type="text" placeholder="e.g. Net 30" className="w-full px-4 py-2 bg-white border border-zinc-200 rounded-xl outline-none" value={formData.payment_terms || ''} onChange={(e) => setFormData({ ...formData, payment_terms: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Credit Limit (UGX)</label>
                      <input type="number" className="w-full px-4 py-2 bg-white border border-zinc-200 rounded-xl outline-none" value={formData.credit_limit || 0} onChange={(e) => setFormData({ ...formData, credit_limit: Number(e.target.value) })} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Payment Cycle</label>
                      <input type="text" placeholder="e.g. Monthly" className="w-full px-4 py-2 bg-white border border-zinc-200 rounded-xl outline-none" value={formData.payment_cycle || ''} onChange={(e) => setFormData({ ...formData, payment_cycle: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Billing Address</label>
                      <input type="text" className="w-full px-4 py-2 bg-white border border-zinc-200 rounded-xl outline-none" value={formData.billing_address || ''} onChange={(e) => setFormData({ ...formData, billing_address: e.target.value })} />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Delivery Address</label>
                      <input type="text" className="w-full px-4 py-2 bg-white border border-zinc-200 rounded-xl outline-none" value={formData.delivery_address || ''} onChange={(e) => setFormData({ ...formData, delivery_address: e.target.value })} />
                    </div>
                  </div>
                )}

                <div className="md:col-span-2 space-y-4">
                  <h3 className="text-xs font-black text-zinc-900 uppercase tracking-widest border-b border-zinc-100 pb-2">Contact Personnel</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Name</label>
                      <input type="text" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.contact_person_name || ''} onChange={(e) => setFormData({ ...formData, contact_person_name: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Role</label>
                      <input type="text" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.contact_person_role || ''} onChange={(e) => setFormData({ ...formData, contact_person_role: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Phone</label>
                      <input type="text" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.contact_person_phone || ''} onChange={(e) => setFormData({ ...formData, contact_person_phone: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Email</label>
                      <input type="email" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.contact_person_email || ''} onChange={(e) => setFormData({ ...formData, contact_person_email: e.target.value })} />
                    </div>
                  </div>
                </div>
              </>
            )}

            {type === 'prescribers' && (
              <>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Full Name *</label>
                  <input required type="text" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.full_name || ''} onChange={(e) => setFormData({ ...formData, full_name: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Specialty *</label>
                  <input required type="text" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.specialty || ''} onChange={(e) => setFormData({ ...formData, specialty: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Phone Number</label>
                  <input type="text" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.phone_number || ''} onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Email Address</label>
                  <input type="email" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.email || ''} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Linked Institution</label>
                  <select className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.institution_id || ''} onChange={(e) => setFormData({ ...formData, institution_id: e.target.value })}>
                    <option value="">None</option>
                    {institutions.map(i => (
                      <option key={i.id} value={i.id}>{i.supplier_name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">License Number</label>
                  <input type="text" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.professional_licence_number || ''} onChange={(e) => setFormData({ ...formData, professional_licence_number: e.target.value })} />
                </div>
              </>
            )}

            {type === 'suppliers' && (
              <>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Supplier Name *</label>
                  <input required type="text" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.supplier_name || ''} onChange={(e) => setFormData({ ...formData, supplier_name: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Supplier ID / Code *</label>
                  <input required type="text" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.supplier_id || ''} onChange={(e) => setFormData({ ...formData, supplier_id: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Commercial Category</label>
                  <select className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.commercial_category || 'Wholesale'} onChange={(e) => setFormData({ ...formData, commercial_category: e.target.value })}>
                    <option value="Wholesale">Wholesale</option>
                    <option value="Manufacturer">Manufacturer</option>
                    <option value="Importer">Importer</option>
                    <option value="Local Distributor">Local Distributor</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">NDA Wholesale Licence No.</label>
                  <input type="text" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.nda_wholesale_licence_number || ''} onChange={(e) => setFormData({ ...formData, nda_wholesale_licence_number: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Licence Expiry Date</label>
                  <input type="date" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.nda_licence_expiry_date || ''} onChange={(e) => setFormData({ ...formData, nda_licence_expiry_date: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Licence Status</label>
                  <select className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.nda_licence_status || 'valid'} onChange={(e) => setFormData({ ...formData, nda_licence_status: e.target.value })}>
                    <option value="valid">Valid</option>
                    <option value="expiring_soon">Expiring Soon</option>
                    <option value="expired">Expired</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Supplier TIN</label>
                  <input type="text" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.tin || ''} onChange={(e) => setFormData({ ...formData, tin: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Payment Terms</label>
                  <input type="text" placeholder="e.g. Net 30" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.payment_terms || ''} onChange={(e) => setFormData({ ...formData, payment_terms: e.target.value })} />
                </div>
                <div className="flex items-center gap-2 pt-4">
                  <input type="checkbox" id="whtExempt" className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500/20" checked={formData.whtExempt || false} onChange={(e) => setFormData({ ...formData, whtExempt: e.target.checked })} />
                  <label htmlFor="whtExempt" className="text-xs font-bold text-zinc-500 uppercase tracking-widest">WHT Exempt (6%)</label>
                </div>
                <div className="flex items-center gap-2 pt-4">
                  <input type="checkbox" id="is_suspended" className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500/20" checked={formData.is_suspended || false} onChange={(e) => setFormData({ ...formData, is_suspended: e.target.checked })} />
                  <label htmlFor="is_suspended" className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Suspend Supplier</label>
                </div>
              </>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Address / Location</label>
            <textarea className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none resize-none" rows={2} value={formData.address || ''} onChange={(e) => setFormData({ ...formData, address: e.target.value })} />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="px-6 py-2 border border-zinc-200 rounded-xl font-bold text-zinc-600 hover:bg-zinc-50 transition-colors uppercase text-[10px] tracking-widest">Cancel</button>
            <button type="submit" className="px-8 py-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-bold transition-all shadow-lg shadow-zinc-900/20 uppercase text-[10px] tracking-widest">
              {item ? 'Update Entry' : 'Register Entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const DetailsModal: React.FC<{ isOpen: boolean; onClose: () => void; item: any; type: string; institutions: InstitutionRegistry[]; onEdit: (item: any) => void }> = ({ isOpen, onClose, item, type, institutions, onEdit }) => {
  if (!item) return null;

  const getInstitutionName = (id: string) => institutions.find(i => i.id === id)?.supplier_name || 'N/A';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="px-8 py-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
          <div className="flex items-center gap-4">
            <div className={cn(
              "h-12 w-12 rounded-2xl flex items-center justify-center",
              type === 'patients' ? "bg-blue-100 text-blue-600" : 
              type === 'institutions' ? "bg-emerald-100 text-emerald-600" : 
              type === 'suppliers' ? "bg-amber-100 text-amber-600" :
              "bg-purple-100 text-purple-600"
            )}>
              {type === 'patients' ? <Users size={24} /> : 
               type === 'institutions' ? <Building2 size={24} /> : 
               type === 'suppliers' ? <Truck size={24} /> :
               <Stethoscope size={24} />}
            </div>
            <div>
              <h2 className="text-xl font-black text-zinc-900 uppercase tracking-tight">
                {type === 'institutions' ? item.supplier_name : 
                 type === 'suppliers' ? item.supplier_name : 
                 item.full_name}
              </h2>
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{type.slice(0, -1)} Profile</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => {
                onEdit(item);
                onClose();
              }}
              className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-xl transition-all"
            >
              <Edit2 size={20} />
            </button>
            <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-600 transition-colors">
              <X size={24} />
            </button>
          </div>
        </div>

        <div className="p-8 space-y-8 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
            <div className="space-y-1">
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Status</p>
              <span className={cn(
                "px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider w-fit block",
                type === 'suppliers' ? (
                  item.is_suspended ? "bg-red-50 text-red-600 border border-red-100" : "bg-emerald-50 text-emerald-600 border border-emerald-100"
                ) : (
                  (item.status || item.care_status) === 'active' ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : "bg-zinc-100 text-zinc-500"
                )
              )}>
                {type === 'suppliers' ? (item.is_suspended ? "Suspended" : "Active") : (item.status || item.care_status)}
              </span>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{type === 'suppliers' ? 'Code / ID' : 'Phone'}</p>
              <p className="font-bold text-zinc-900">
                {type === 'suppliers' ? item.supplier_id : (type === 'institutions' ? (item.institution_phone || item.phone_number) : item.phone_number)}
              </p>
            </div>
            {(item.email || item.institution_email) && type !== 'suppliers' && (
              <div className="space-y-1">
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Email</p>
                <p className="font-bold text-zinc-900">{type === 'institutions' ? (item.institution_email || item.email) : item.email}</p>
              </div>
            )}
            {type === 'patients' && (
              <>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Sex</p>
                  <p className="font-bold text-zinc-900">{item.sex || 'N/A'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Age</p>
                  <p className="font-bold text-zinc-900">
                    {item.year_of_birth ? `${new Date().getFullYear() - item.year_of_birth} Years` : 'N/A'}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Billing Type</p>
                  <p className="font-bold text-zinc-900 capitalize">{item.billing_type}</p>
                </div>
                {item.billing_type === 'institutional-pay' && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Bill To</p>
                    <p className="font-bold text-zinc-900">{getInstitutionName(item.institution_to_bill_id)}</p>
                  </div>
                )}
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Care Institution</p>
                  <p className="font-bold text-zinc-900">{getInstitutionName(item.institution_of_care_id)}</p>
                </div>
              </>
            )}
            {type === 'suppliers' && (
              <>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Category</p>
                  <p className="font-bold text-zinc-900 capitalize">{item.commercial_category || 'Wholesale'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Payment Terms</p>
                  <p className="font-bold text-zinc-900">{item.payment_terms || 'Immediate'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">TIN</p>
                  <p className="font-bold text-zinc-900">{item.tin || 'N/A'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">WHT Exempt</p>
                  <p className="font-bold text-zinc-900">{item.whtExempt ? 'Yes' : 'No'}</p>
                </div>
                <div className="space-y-1 col-span-2">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">NDA License</p>
                  <p className="font-bold text-zinc-900">{item.nda_wholesale_licence_number || 'N/A'} ({item.nda_licence_status || 'valid'})</p>
                </div>
              </>
            )}
            {type === 'institutions' && (
              <>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Subtype</p>
                  <p className="font-bold text-zinc-900 capitalize">{item.subtype}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Role</p>
                  <p className="font-bold text-zinc-900 capitalize">{item.role?.replace('_', ' ')}</p>
                </div>
                {item.credit_limit > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Credit Limit</p>
                    <p className="font-bold text-zinc-900">{item.credit_limit.toLocaleString()} UGX</p>
                  </div>
                )}
              </>
            )}
            {type === 'prescribers' && (
              <>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Specialty</p>
                  <p className="font-bold text-zinc-900">{item.specialty}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Workplace</p>
                  <p className="font-bold text-zinc-900">{getInstitutionName(item.institution_id)}</p>
                </div>
              </>
            )}
          </div>

          {item.address && (
            <div className="space-y-1">
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Address / Location</p>
              <p className="text-sm text-zinc-600">{item.address}</p>
            </div>
          )}

          {type === 'patients' && item.labels?.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Client Labels</p>
              <div className="flex flex-wrap gap-2">
                {item.labels.map((label: string) => (
                  <span key={label} className="px-2 py-1 bg-zinc-100 text-zinc-600 rounded-lg text-[10px] font-black uppercase tracking-widest">
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {type === 'patients' && item.is_chronic_care && (
            <div className="p-6 bg-emerald-50 rounded-3xl border border-emerald-100 space-y-4">
              <div className="flex items-center gap-2">
                <Heart className="text-emerald-600" size={18} />
                <h3 className="text-xs font-black text-emerald-900 uppercase tracking-widest">Chronic Care Details</h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">Condition</p>
                  <p className="text-xs font-bold text-emerald-900">{item.chronic_condition || 'N/A'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">Refill Cycle</p>
                  <p className="text-xs font-bold text-emerald-900">{item.refill_cycle_days} Days</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">Next of Kin</p>
                  <p className="text-xs font-bold text-emerald-900">{item.next_of_kin_name || 'N/A'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">NOK Contact</p>
                  <p className="text-xs font-bold text-emerald-900">{item.next_of_kin_contact || 'N/A'}</p>
                </div>
              </div>
            </div>
          )}

          {type === 'institutions' && (item.contact_person_name || item.contact_person_phone) && (
            <div className="p-6 bg-zinc-50 rounded-3xl border border-zinc-100 space-y-4">
              <h3 className="text-xs font-black text-zinc-900 uppercase tracking-widest">Contact Personnel</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Name</p>
                  <p className="text-xs font-bold text-zinc-900">{item.contact_person_name || 'N/A'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Role</p>
                  <p className="text-xs font-bold text-zinc-900">{item.contact_person_role || 'N/A'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Phone</p>
                  <p className="text-xs font-bold text-zinc-900">{item.contact_person_phone || 'N/A'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Email</p>
                  <p className="text-xs font-bold text-zinc-900">{item.contact_person_email || 'N/A'}</p>
                </div>
              </div>
            </div>
          )}

          {item.notes && (
            <div className="space-y-1">
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Notes</p>
              <p className="text-xs text-zinc-600 leading-relaxed">{item.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ReportsHub: React.FC<{ patients: Client[]; institutions: InstitutionRegistry[]; prescribers: Prescriber[] }> = ({ patients, institutions, prescribers }) => {
  const { profile, activeBranchId } = useAuth();
  const [sales, setSales] = useState<any[]>([]);
  const [supplierCredits, setSupplierCredits] = useState<any[]>([]);
  const [productBatches, setProductBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Active modal state
  const [activeReportModal, setActiveReportModal] = useState<'credit_ledger' | 'accounts_performance' | null>(null);

  // Sub-tabs within modals
  const [creditSubTab, setCreditSubTab] = useState<'to_branch' | 'by_branch'>('to_branch');
  const [perfSubTab, setPerfSubTab] = useState<'clients' | 'prescribers' | 'suppliers'>('clients');

  // Date Filters
  const [fromDate, setFromDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(1); // Start of current month
    return d.toISOString().split('T')[0];
  });
  const [toDate, setToDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });

  // Fetch sales, credit ledger, and batches
  useEffect(() => {
    if (profile?.tenantId) {
      setLoading(true);
      const unsubSales = firestoreService.subscribeToCollection<any>(
        'sales',
        profile.tenantId,
        (data) => {
          setSales(data);
        }
      );
      const unsubLedger = firestoreService.subscribeToCollection<any>(
        'credit_ledger',
        profile.tenantId,
        (data) => {
          setSupplierCredits(data);
        }
      );
      
      const fetchBatches = async () => {
        try {
          const batchesData = await firestoreService.getCollectionGroup<any>(
            'product_batches',
            profile.tenantId!,
            activeBranchId || undefined
          );
          setProductBatches(batchesData);
        } catch (error) {
          console.error('Error fetching product batches:', error);
        } finally {
          setLoading(false);
        }
      };

      fetchBatches();

      return () => {
        unsubSales();
        unsubLedger();
      };
    }
  }, [profile?.tenantId, activeBranchId]);

  // Helper: safely parse dates from various formats (string, Timestamp)
  const getParsedDate = (field: any) => {
    if (!field) return new Date();
    if (field.seconds) return new Date(field.seconds * 1000);
    return new Date(field);
  };

  // 1. Credit Ledger Calculations (Branch specific & Date filtered)
  const branchClientCredits = useMemo(() => {
    return sales.filter(s => {
      // Branch check
      if (activeBranchId && s.branchId !== activeBranchId) return false;
      // Date check
      const saleDate = getParsedDate(s.timestamp || s.createdAt);
      const start = new Date(fromDate);
      start.setHours(0,0,0,0);
      const end = new Date(toDate);
      end.setHours(23,59,59,999);
      if (saleDate < start || saleDate > end) return false;
      // Credit check
      return s.paymentMethod === 'institutional_credit' || s.paymentMethod === 'credit';
    });
  }, [sales, activeBranchId, fromDate, toDate]);

  const branchSupplierCredits = useMemo(() => {
    return supplierCredits.filter(c => {
      // Branch check
      if (activeBranchId && c.branchId !== activeBranchId) return false;
      // Date check
      const creditDate = getParsedDate(c.createdAt || c.creditAccruedAt);
      const start = new Date(fromDate);
      start.setHours(0,0,0,0);
      const end = new Date(toDate);
      end.setHours(23,59,59,999);
      return creditDate >= start && creditDate <= end;
    });
  }, [supplierCredits, activeBranchId, fromDate, toDate]);

  // 2. Accounts Performance Calculations
  const filteredSalesInPeriod = useMemo(() => {
    return sales.filter(s => {
      if (activeBranchId && s.branchId !== activeBranchId) return false;
      const saleDate = getParsedDate(s.timestamp || s.createdAt);
      const start = new Date(fromDate);
      start.setHours(0,0,0,0);
      const end = new Date(toDate);
      end.setHours(23,59,59,999);
      return saleDate >= start && saleDate <= end;
    });
  }, [sales, activeBranchId, fromDate, toDate]);

  // Client Accounts Performance (Revenue)
  const clientPerformance = useMemo(() => {
    const clientsMap: { [key: string]: { name: string; category: string; phone: string; revenue: number; orders: number } } = {};
    
    filteredSalesInPeriod.forEach(s => {
      const id = s.clientId || s.patientId || s.patientName || 'Walk-in Clients';
      const name = s.patientName || s.institutionName || 'Walk-in Client';
      
      if (!clientsMap[id]) {
        // Try to find full patient record
        const pRecord = patients.find(p => p.id === s.clientId || p.id === s.patientId);
        clientsMap[id] = {
          name,
          category: pRecord ? (pRecord.labels || []).join(', ') : (s.institutionName ? 'Institution' : 'Walk-in'),
          phone: pRecord?.phone_number || pRecord?.phone || '-',
          revenue: 0,
          orders: 0
        };
      }
      
      clientsMap[id].revenue += s.total || s.subtotal || 0;
      clientsMap[id].orders += 1;
    });

    return Object.values(clientsMap).sort((a, b) => b.revenue - a.revenue);
  }, [filteredSalesInPeriod, patients]);

  // Prescriber Accounts Performance
  const prescriberPerformance = useMemo(() => {
    const presMap: { [key: string]: { name: string; clinic: string; revenue: number; referrals: number } } = {};
    
    filteredSalesInPeriod.forEach(s => {
      if (!s.prescriberName && !s.prescriberId) return;
      const id = s.prescriberId || s.prescriberName || 'Unknown Prescriber';
      const name = s.prescriberName || 'Unknown Prescriber';

      if (!presMap[id]) {
        const pRecord = prescribers.find(p => p.id === s.prescriberId);
        presMap[id] = {
          name,
          clinic: pRecord?.clinic_affiliation || 'Independent / Clinic',
          revenue: 0,
          referrals: 0
        };
      }

      presMap[id].revenue += s.total || s.subtotal || 0;
      presMap[id].referrals += 1;
    });

    return Object.values(presMap).sort((a, b) => b.revenue - a.revenue);
  }, [filteredSalesInPeriod, prescribers]);

  // Supplier Accounts Performance (COGS and Profits)
  const supplierPerformance = useMemo(() => {
    const supMap: { [key: string]: { name: string; cogs: number; revenue: number; profit: number; itemsCount: number } } = {};

    filteredSalesInPeriod.forEach(s => {
      (s.items || []).forEach((item: any) => {
        // Try to find batch to extract supplier
        const batch = productBatches.find(b => b.id === item.batchId);
        const supplierName = batch?.supplierName || batch?.supplier || item.supplierName || 'General Sourced';
        
        if (!supMap[supplierName]) {
          supMap[supplierName] = {
            name: supplierName,
            cogs: 0,
            revenue: 0,
            profit: 0,
            itemsCount: 0
          };
        }

        const rev = item.total || (item.quantity * (item.unitPrice || 0));
        const costPrice = item.costPrice || item.purchasePrice || 0;
        const cogsVal = item.quantity * costPrice;

        supMap[supplierName].revenue += rev;
        supMap[supplierName].cogs += cogsVal;
        supMap[supplierName].profit += (rev - cogsVal);
        supMap[supplierName].itemsCount += item.quantity;
      });
    });

    return Object.values(supMap).sort((a, b) => b.profit - a.profit);
  }, [filteredSalesInPeriod, productBatches]);

  // General CSV Export Helper inside ReportsHub
  const downloadReport = (title: string, headers: string[], rows: any[][]) => {
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" 
      + [headers.join(','), ...rows.map(e => e.map(val => `"${(val ?? '').toString().replace(/"/g, '""')}"`).join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${title.toLowerCase().replace(/\s+/g, '_')}_${format(new Date(), 'yyyyMMdd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`${title} downloaded successfully`);
  };

  // Unified actions for report cards
  const reports = [
    {
      title: "Client Label Matrix",
      description: "Detailed list of clients categorized by their assigned labels.",
      icon: Filter,
      color: "text-blue-600",
      bg: "bg-blue-50",
      action: () => downloadReport(
        "Client Label Matrix", 
        ['Name', 'Phone', 'Labels', 'Care Status'],
        patients.map(p => [p.full_name || p.name || 'N/A', p.phone_number || p.phone || 'N/A', (p.labels || []).join(" | "), p.care_status || 'N/A'])
      )
    },
    {
      title: "Chronic Care Database",
      description: "Comprehensive list of patients enrolled in the chronic care program.",
      icon: Heart,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
      action: () => downloadReport(
        "Chronic Care Database", 
        ['Name', 'Condition', 'Refill Cycle Days', 'Next Of Kin'],
        patients.filter(p => p?.is_chronic_care).map(p => [p.full_name || p.name || 'N/A', p.chronic_condition || 'N/A', p.refill_cycle_days || 'N/A', p.next_of_kin_name || 'N/A'])
      )
    },
    {
      title: "Credit Ledger",
      description: "Audited ledger of credits owed to and owed by this branch with date filters.",
      icon: CreditCard,
      color: "text-amber-600",
      bg: "bg-amber-50",
      action: () => setActiveReportModal('credit_ledger')
    },
    {
      title: "Accounts Performance",
      description: "Revenue, COGS, and profit contribution margins of clients, prescribers, and suppliers.",
      icon: Activity,
      color: "text-purple-600",
      bg: "bg-purple-50",
      action: () => setActiveReportModal('accounts_performance')
    }
  ];

  // Specific Exports
  const exportCreditLedger = () => {
    if (creditSubTab === 'to_branch') {
      const headers = ['Date', 'Debtor (Customer/Institution)', 'Receipt Reference', 'Credit Amount (UGX)', 'Audited Status'];
      const rows = branchClientCredits.map(s => [
        format(getParsedDate(s.timestamp), 'yyyy-MM-dd'),
        s.institutionName || s.patientName || 'Walk-in Client',
        s.receiptNumber,
        s.total,
        s.status === 'completed' ? 'Outstanding' : 'Paid'
      ]);
      downloadReport("Credits_Owed_To_Branch", headers, rows);
    } else {
      const headers = ['Date', 'Creditor (Supplier)', 'Invoice Reference', 'Original Credit (UGX)', 'Remaining Balance (UGX)', 'Audited Status'];
      const rows = branchSupplierCredits.map(c => [
        format(getParsedDate(c.createdAt || c.creditAccruedAt), 'yyyy-MM-dd'),
        c.supplierName || 'Unknown',
        c.invoiceRef || '-',
        c.originalCreditAmount || 0,
        c.remainingCreditBalance || 0,
        c.status || 'outstanding'
      ]);
      downloadReport("Credits_Owed_By_Branch", headers, rows);
    }
  };

  const exportAccountsPerformance = () => {
    if (perfSubTab === 'clients') {
      const headers = ['Client Account Name', 'Category', 'Phone Number', 'Revenue (UGX)', 'Orders Count'];
      const rows = clientPerformance.map(c => [c.name, c.category, c.phone, c.revenue, c.orders]);
      downloadReport("Client_Accounts_Performance", headers, rows);
    } else if (perfSubTab === 'prescribers') {
      const headers = ['Prescriber Name', 'Affiliated Clinic', 'Attached Revenue (UGX)', 'Referral Count'];
      const rows = prescriberPerformance.map(p => [p.name, p.clinic, p.revenue, p.referrals]);
      downloadReport("Prescriber_Accounts_Performance", headers, rows);
    } else {
      const headers = ['Supplier Account Name', 'COGS Contributed (UGX)', 'Sales Revenue Generated (UGX)', 'Profits Realized (UGX)', 'Margin %'];
      const rows = supplierPerformance.map(s => [
        s.name,
        s.cogs,
        s.revenue,
        s.profit,
        s.revenue > 0 ? `${((s.profit / s.revenue) * 100).toFixed(1)}%` : '0%'
      ]);
      downloadReport("Supplier_Accounts_Performance", headers, rows);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {reports.map((report, idx) => (
          <div key={idx} className="bg-white p-8 rounded-[32px] border border-zinc-200 shadow-sm hover:shadow-md transition-all group relative">
            <div className="flex items-start justify-between mb-6">
              <div className={cn("p-4 rounded-2xl", report.bg, report.color)}>
                <report.icon size={24} />
              </div>
              <button 
                onClick={report.action}
                className="p-3 bg-zinc-50 hover:bg-zinc-100 text-zinc-600 hover:text-zinc-900 rounded-xl transition-all flex items-center gap-1.5 text-xs font-black uppercase tracking-widest"
              >
                <Download size={16} />
                Open / Export
              </button>
            </div>
            <h3 className="text-lg font-black text-zinc-900 uppercase tracking-tight mb-2">{report.title}</h3>
            <p className="text-sm text-zinc-500 font-medium leading-relaxed mb-4">{report.description}</p>
          </div>
        ))}
      </div>

      {/* MODAL 1: Credit Ledger Modal */}
      {activeReportModal === 'credit_ledger' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-5xl rounded-[32px] border border-zinc-200 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-150">
            {/* Header */}
            <div className="p-8 border-b border-zinc-100 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black text-zinc-950 uppercase tracking-tight flex items-center gap-2">
                  <CreditCard className="text-amber-500" size={24} />
                  CRM Credit Ledger Hub
                </h2>
                <p className="text-xs text-zinc-500 mt-1">Branch specific credit auditing & reconciliation statement.</p>
              </div>
              <button 
                onClick={() => setActiveReportModal(null)}
                className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-full transition-all"
              >
                <X size={20} />
              </button>
            </div>

            {/* Controls & Filters */}
            <div className="p-8 bg-zinc-50 border-b border-zinc-100 flex flex-col md:flex-row gap-6 justify-between items-start md:items-center">
              {/* Tabs */}
              <div className="flex gap-2 bg-zinc-200/60 p-1.5 rounded-2xl">
                <button
                  onClick={() => setCreditSubTab('to_branch')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
                    creditSubTab === 'to_branch' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-900"
                  )}
                >
                  Owed TO our branch
                </button>
                <button
                  onClick={() => setCreditSubTab('by_branch')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
                    creditSubTab === 'by_branch' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-900"
                  )}
                >
                  Owed BY our branch
                </button>
              </div>

              {/* Date Filters */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">From</span>
                  <input 
                    type="date" 
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="px-3 py-1.5 bg-white border border-zinc-200 rounded-xl text-xs font-bold text-zinc-800 outline-none focus:ring-2 focus:ring-zinc-200"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">To</span>
                  <input 
                    type="date" 
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="px-3 py-1.5 bg-white border border-zinc-200 rounded-xl text-xs font-bold text-zinc-800 outline-none focus:ring-2 focus:ring-zinc-200"
                  />
                </div>
                <button 
                  onClick={exportCreditLedger}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] uppercase tracking-widest rounded-xl flex items-center gap-1.5 shadow-sm shadow-emerald-100 transition-all ml-2"
                >
                  <Download size={14} />
                  Export
                </button>
              </div>
            </div>

            {/* Table Area */}
            <div className="flex-1 overflow-y-auto p-8">
              {loading ? (
                <div className="h-64 flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
                </div>
              ) : creditSubTab === 'to_branch' ? (
                /* TO our branch table */
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-100">
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Date</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Debtor (Client / Institution)</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Ref Receipt</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Owed Balance</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Audited Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {branchClientCredits.map(c => (
                      <tr key={c.id} className="hover:bg-zinc-50/50 transition-colors">
                        <td className="px-6 py-4 text-xs font-medium text-zinc-500">{format(getParsedDate(c.timestamp || c.createdAt), 'MMM dd, yyyy')}</td>
                        <td className="px-6 py-4 font-bold text-zinc-900">{c.institutionName || c.patientName || 'Walk-in Client'}</td>
                        <td className="px-6 py-4 text-xs font-mono text-zinc-500">{c.receiptNumber}</td>
                        <td className="px-6 py-4 text-xs font-black text-right text-amber-600">{(c.total || c.subtotal || 0).toLocaleString()} UGX</td>
                        <td className="px-6 py-4 text-xs font-bold text-zinc-900">
                          <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 text-[10px] font-black uppercase tracking-widest">
                            {c.status === 'completed' ? 'Outstanding' : 'Paid'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {branchClientCredits.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-zinc-400 italic">
                          No client credits found in this date range.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : (
                /* BY our branch table */
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-100">
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Date</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Creditor (Supplier)</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Invoice Ref</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Original Credit</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Remaining Balance</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Audited Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {branchSupplierCredits.map(c => (
                      <tr key={c.id} className="hover:bg-zinc-50/50 transition-colors">
                        <td className="px-6 py-4 text-xs font-medium text-zinc-500">{format(getParsedDate(c.createdAt || c.creditAccruedAt), 'MMM dd, yyyy')}</td>
                        <td className="px-6 py-4 font-bold text-zinc-900">{c.supplierName || 'Unknown'}</td>
                        <td className="px-6 py-4 text-xs font-mono text-zinc-500">{c.invoiceRef || '-'}</td>
                        <td className="px-6 py-4 text-xs font-bold text-right text-zinc-600">{(c.originalCreditAmount || 0).toLocaleString()} UGX</td>
                        <td className="px-6 py-4 text-xs font-black text-right text-red-600">{(c.remainingCreditBalance || 0).toLocaleString()} UGX</td>
                        <td className="px-6 py-4 text-xs font-bold text-zinc-900">
                          <span className={cn(
                            "px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest",
                            c.status === 'paid' ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                          )}>
                            {c.status || 'outstanding'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {branchSupplierCredits.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-zinc-400 italic">
                          No supplier credits found in this date range.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Accounts Performance Modal */}
      {activeReportModal === 'accounts_performance' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-5xl rounded-[32px] border border-zinc-200 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-150">
            {/* Header */}
            <div className="p-8 border-b border-zinc-100 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black text-zinc-950 uppercase tracking-tight flex items-center gap-2">
                  <Activity className="text-purple-500" size={24} />
                  CRM Accounts Performance Hub
                </h2>
                <p className="text-xs text-zinc-500 mt-1">Transaction volume, revenue tracking, and margins contribution analysis.</p>
              </div>
              <button 
                onClick={() => setActiveReportModal(null)}
                className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-full transition-all"
              >
                <X size={20} />
              </button>
            </div>

            {/* Controls & Filters */}
            <div className="p-8 bg-zinc-50 border-b border-zinc-100 flex flex-col md:flex-row gap-6 justify-between items-start md:items-center">
              {/* Category selector */}
              <div className="flex gap-2 bg-zinc-200/60 p-1.5 rounded-2xl">
                <button
                  onClick={() => setPerfSubTab('clients')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
                    perfSubTab === 'clients' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-900"
                  )}
                >
                  Client Performance
                </button>
                <button
                  onClick={() => setPerfSubTab('prescribers')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
                    perfSubTab === 'prescribers' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-900"
                  )}
                >
                  Prescriber Performance
                </button>
                <button
                  onClick={() => setPerfSubTab('suppliers')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
                    perfSubTab === 'suppliers' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-900"
                  )}
                >
                  Supplier Performance
                </button>
              </div>

              {/* Date Filters */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">From</span>
                  <input 
                    type="date" 
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="px-3 py-1.5 bg-white border border-zinc-200 rounded-xl text-xs font-bold text-zinc-800 outline-none focus:ring-2 focus:ring-zinc-200"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">To</span>
                  <input 
                    type="date" 
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="px-3 py-1.5 bg-white border border-zinc-200 rounded-xl text-xs font-bold text-zinc-800 outline-none focus:ring-2 focus:ring-zinc-200"
                  />
                </div>
                <button 
                  onClick={exportAccountsPerformance}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] uppercase tracking-widest rounded-xl flex items-center gap-1.5 shadow-sm shadow-emerald-100 transition-all ml-2"
                >
                  <Download size={14} />
                  Export
                </button>
              </div>
            </div>

            {/* Table Area */}
            <div className="flex-1 overflow-y-auto p-8">
              {loading ? (
                <div className="h-64 flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
                </div>
              ) : perfSubTab === 'clients' ? (
                /* Client performance */
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-100">
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Client Name</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Category</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Phone</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Revenue Contributed</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Orders Count</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {clientPerformance.map((c, i) => (
                      <tr key={i} className="hover:bg-zinc-50/50 transition-colors">
                        <td className="px-6 py-4 font-bold text-zinc-900">{c.name}</td>
                        <td className="px-6 py-4 text-xs font-bold text-zinc-500">{c.category}</td>
                        <td className="px-6 py-4 text-xs text-zinc-500">{c.phone}</td>
                        <td className="px-6 py-4 text-xs font-black text-right text-emerald-600">{c.revenue.toLocaleString()} UGX</td>
                        <td className="px-6 py-4 text-xs font-bold text-right text-zinc-900">{c.orders}</td>
                      </tr>
                    ))}
                    {clientPerformance.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-zinc-400 italic">
                          No client performance records found in this date range.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : perfSubTab === 'prescribers' ? (
                /* Prescriber performance */
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-100">
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Prescriber Name</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Affiliated Clinic</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Attached Revenue</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Referral Sales Count</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {prescriberPerformance.map((p, i) => (
                      <tr key={i} className="hover:bg-zinc-50/50 transition-colors">
                        <td className="px-6 py-4 font-bold text-zinc-900">{p.name}</td>
                        <td className="px-6 py-4 text-xs text-zinc-500">{p.clinic}</td>
                        <td className="px-6 py-4 text-xs font-black text-right text-purple-600">{p.revenue.toLocaleString()} UGX</td>
                        <td className="px-6 py-4 text-xs font-bold text-right text-zinc-900">{p.referrals}</td>
                      </tr>
                    ))}
                    {prescriberPerformance.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-6 py-12 text-center text-zinc-400 italic">
                          No prescriber performance records found in this date range.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : (
                /* Supplier performance */
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-100">
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Supplier Name</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Cost of Goods (COGS)</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Sales Revenue</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Realized Net Profits</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Margin %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {supplierPerformance.map((s, i) => {
                      const marginPct = s.revenue > 0 ? ((s.profit / s.revenue) * 100) : 0;
                      return (
                        <tr key={i} className="hover:bg-zinc-50/50 transition-colors">
                          <td className="px-6 py-4 font-bold text-zinc-900">{s.name}</td>
                          <td className="px-6 py-4 text-xs font-medium text-right text-zinc-600">{s.cogs.toLocaleString()} UGX</td>
                          <td className="px-6 py-4 text-xs font-medium text-right text-zinc-800">{s.revenue.toLocaleString()} UGX</td>
                          <td className="px-6 py-4 text-xs font-black text-right text-emerald-600">{s.profit.toLocaleString()} UGX</td>
                          <td className="px-6 py-4 text-xs font-black text-right text-zinc-900">{marginPct.toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                    {supplierPerformance.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-zinc-400 italic">
                          No supplier performance records found in this date range.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Clients;
