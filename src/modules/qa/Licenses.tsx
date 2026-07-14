import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Plus, 
  History, 
  Filter, 
  Download, 
  Search, 
  Calendar, 
  AlertCircle, 
  CheckCircle2, 
  ExternalLink, 
  ShieldCheck, 
  Building2,
  UserCheck,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';
import { PremisesLicense, PersonnelLicense, Staff, Branch } from '../../types';
import { toast } from 'sonner';
import { format, differenceInDays } from 'date-fns';

export const Licenses = () => {
  const { profile, activeBranch, tenantId } = useAuth();
  const [premisesLicenses, setPremisesLicenses] = useState<PremisesLicense[]>([]);
  const [personnelLicenses, setPersonnelLicenses] = useState<PersonnelLicense[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'premises' | 'personnel'>('premises');
  const [isAdding, setIsAdding] = useState(false);

  // Form states
  const [licenseType, setLicenseType] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [issuingAuthority, setIssuingAuthority] = useState('');
  const [staffId, setStaffId] = useState('');

  useEffect(() => {
    if (!tenantId || !activeBranch) return;

    const unsubscribePremises = firestoreService.subscribeToCollection<PremisesLicense>(
      'premises_licenses',
      tenantId,
      (entries) => {
        const branchEntries = entries.filter(e => e.branchId === activeBranch.id);
        setPremisesLicenses(branchEntries.sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()));
      }
    );

    const unsubscribePersonnel = firestoreService.subscribeToCollection<PersonnelLicense>(
      'personnel_licenses',
      tenantId,
      (entries) => {
        setPersonnelLicenses(entries.sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()));
      }
    );

    const unsubscribeStaff = firestoreService.subscribeToCollection<Staff>(
      'staff',
      tenantId,
      (entries) => {
        setStaff(entries);
      }
    );

    const unsubscribeBranches = firestoreService.subscribeToCollection<Branch>(
      'branches',
      tenantId,
      (entries) => {
        setBranches(entries);
      }
    );

    setLoading(false);

    return () => {
      unsubscribePremises();
      unsubscribePersonnel();
      unsubscribeStaff();
      unsubscribeBranches();
    };
  }, [tenantId, activeBranch]);

  const getStatus = (expiryDate: string) => {
    const daysLeft = differenceInDays(new Date(expiryDate), new Date());
    if (daysLeft < 0) return 'Expired';
    if (daysLeft <= 30) return 'Critical';
    if (daysLeft <= 90) return 'Warning';
    return 'Valid';
  };

  const handleAddLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !activeBranch || !profile) return;

    try {
      if (activeTab === 'premises') {
        const newLicense: Omit<PremisesLicense, 'id'> = {
          tenantId,
          branchId: activeBranch.id,
          name: licenseType,
          licenseType: licenseType as any,
          licenseNumber,
          expiryDate,
          issuingAuthority,
          status: getStatus(expiryDate) as any
        };
        await firestoreService.addDocument('premises_licenses', newLicense);
      } else {
        const staffMember = staff.find(s => s.id === staffId);
        const newLicense: Omit<PersonnelLicense, 'id'> = {
          tenantId,
          staffId,
          staffName: staffMember?.full_name || staffMember?.displayName || 'Unknown',
          licenseType: licenseType as any,
          licenseNumber,
          expiryDate,
          status: getStatus(expiryDate) as any
        };
        await firestoreService.addDocument('personnel_licenses', newLicense);
      }

      toast.success('License record saved successfully');
      setIsAdding(false);
      resetForm();
    } catch (error) {
      toast.error('Failed to save license record');
    }
  };

  const resetForm = () => {
    setLicenseType('');
    setLicenseNumber('');
    setExpiryDate('');
    setIssuingAuthority('');
    setStaffId('');
  };

  const registryPremises = branches
    .filter(b => b.license_number && b.license_expiry)
    .map(b => ({
      id: `registry-${b.id}`,
      tenantId: b.tenantId,
      branchId: b.id,
      name: b.name,
      licenseType: 'Main Branch Licence',
      licenseNumber: b.license_number!,
      expiryDate: b.license_expiry!,
      issuingAuthority: 'National Drug Authority',
      status: getStatus(b.license_expiry!),
      isRegistry: true
    }));

  const registryPersonnel = staff
    .filter(s => s.licenseNumber && s.licenseExpiryDate)
    .map(s => ({
      id: `registry-${s.id}`,
      tenantId: s.tenantId,
      staffId: s.id,
      staffName: s.full_name || s.displayName || 'Unknown',
      licenseType: s.cadre || 'Professional Licence',
      licenseNumber: s.licenseNumber!,
      expiryDate: s.licenseExpiryDate!,
      status: getStatus(s.licenseExpiryDate!),
      isRegistry: true
    }));

  const mergedPremises = [...premisesLicenses, ...registryPremises].sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
  const mergedPersonnel = [...personnelLicenses, ...registryPersonnel].sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());

  const filteredPremises = mergedPremises.filter(l => 
    l.licenseNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    l.licenseType.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (l as any).name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredPersonnel = mergedPersonnel.filter(l => 
    l.staffName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    l.licenseNumber.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const allLicenses = [...mergedPremises, ...mergedPersonnel];
  const criticalCount = allLicenses.filter(l => getStatus(l.expiryDate) === 'Critical' || getStatus(l.expiryDate) === 'Expired').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-lg w-fit">
          <button
            onClick={() => setActiveTab('premises')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              activeTab === 'premises' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Premises Licenses
          </button>
          <button
            onClick={() => setActiveTab('personnel')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              activeTab === 'personnel' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Personnel Licenses
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search licenses..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all w-64"
            />
          </div>
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Add Record</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-50 rounded-lg">
              <ShieldCheck className="w-5 h-5 text-blue-600" />
            </div>
            <span className="text-sm font-medium text-gray-500">Total Records</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{allLicenses.length}</p>
          <p className="text-xs text-gray-500 mt-1">Across all categories</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-green-50 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            </div>
            <span className="text-sm font-medium text-gray-500">Valid</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {allLicenses.filter(l => getStatus(l.expiryDate) === 'Valid').length}
          </p>
          <p className="text-xs text-gray-500 mt-1">Fully compliant</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-amber-50 rounded-lg">
              <AlertCircle className="w-5 h-5 text-amber-600" />
            </div>
            <span className="text-sm font-medium text-gray-500">Warning</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {allLicenses.filter(l => getStatus(l.expiryDate) === 'Warning').length}
          </p>
          <p className="text-xs text-gray-500 mt-1">Expiring in 90 days</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-red-50 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-600" />
            </div>
            <span className="text-sm font-medium text-gray-500">Critical / Expired</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{criticalCount}</p>
          <p className="text-xs text-gray-500 mt-1">Immediate action required</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            {activeTab === 'premises' ? <Building2 className="w-4 h-4 text-gray-400" /> : <UserCheck className="w-4 h-4 text-gray-400" />}
            {activeTab === 'premises' ? 'Premises License Registry' : 'Personnel License Registry'}
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500 font-medium">
                {activeTab === 'personnel' && <th className="px-6 py-3">Staff Member</th>}
                <th className="px-6 py-3">License Type</th>
                <th className="px-6 py-3">License Number</th>
                {activeTab === 'premises' && <th className="px-6 py-3">Issuing Authority</th>}
                <th className="px-6 py-3">Expiry Date</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Document</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(activeTab === 'premises' ? filteredPremises : filteredPersonnel).map((license) => {
                const status = getStatus(license.expiryDate);
                return (
                  <tr key={license.id} className="text-sm hover:bg-gray-50 transition-colors">
                    {activeTab === 'personnel' && (
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 font-bold text-[10px]">
                            {(license as PersonnelLicense).staffName.charAt(0)}
                          </div>
                          <span className="font-medium text-gray-900">{(license as PersonnelLicense).staffName}</span>
                        </div>
                      </td>
                    )}
                    <td className="px-6 py-4 font-medium text-gray-900">
                      <div className="flex flex-col gap-1">
                        <span>{license.licenseType}</span>
                        {(license as any).isRegistry && (
                          <span className="text-[9px] font-black uppercase tracking-tighter text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded w-fit">
                            Registry Sync
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-gray-600">{license.licenseNumber}</td>
                    {activeTab === 'premises' && <td className="px-6 py-4 text-gray-600">{(license as PremisesLicense).issuingAuthority}</td>}
                    <td className="px-6 py-4 text-gray-600">{license.expiryDate}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        status === 'Valid' ? 'bg-green-100 text-green-800' :
                        status === 'Warning' ? 'bg-amber-100 text-amber-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {license.documentUrl ? (
                        <a 
                          href={license.documentUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium transition-colors"
                        >
                          <ExternalLink className="w-4 h-4" />
                          View
                        </a>
                      ) : (
                        <span className="text-gray-400 italic">No document</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {(activeTab === 'premises' ? filteredPremises : filteredPersonnel).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    No license records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 bg-blue-50">
                <h3 className="text-xl font-bold text-blue-900 flex items-center gap-2">
                  <Plus className="w-5 h-5" />
                  Add {activeTab === 'premises' ? 'Premises' : 'Personnel'} License
                </h3>
              </div>

              <form onSubmit={handleAddLicense} className="p-6 space-y-4">
                {activeTab === 'personnel' && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">Staff Member</label>
                    <select
                      required
                      value={staffId}
                      onChange={(e) => setStaffId(e.target.value)}
                      className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    >
                      <option value="">Select staff member...</option>
                      {staff.map(s => (
                        <option key={s.id} value={s.id}>{s.fullName}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">License Type</label>
                  <select
                    required
                    value={licenseType}
                    onChange={(e) => setLicenseType(e.target.value)}
                    className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  >
                    <option value="">Select license type...</option>
                    {activeTab === 'premises' ? (
                      <>
                        <option value="NDA Premises Licence">NDA Premises Licence</option>
                        <option value="Certificate of Suitability of Premises">Certificate of Suitability of Premises</option>
                        <option value="Business Registration / Trading Licence">Business Registration / Trading Licence</option>
                        <option value="Pharmacy Council Registration">Pharmacy Council Registration</option>
                        <option value="Other">Other</option>
                      </>
                    ) : (
                      <>
                        <option value="Pharmacist Annual Practising Licence">Pharmacist Annual Practising Licence</option>
                        <option value="Dispenser Annual Practising Licence">Dispenser Annual Practising Licence</option>
                        <option value="NDA Registration">NDA Registration</option>
                        <option value="Other">Other</option>
                      </>
                    )}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">License Number</label>
                  <input
                    type="text"
                    required
                    value={licenseNumber}
                    onChange={(e) => setLicenseNumber(e.target.value)}
                    className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    placeholder="Enter license number"
                  />
                </div>

                {activeTab === 'premises' && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">Issuing Authority</label>
                    <input
                      type="text"
                      required
                      value={issuingAuthority}
                      onChange={(e) => setIssuingAuthority(e.target.value)}
                      className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      placeholder="e.g. National Drug Authority"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Expiry Date</label>
                  <input
                    type="date"
                    required
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsAdding(false)}
                    className="flex-1 px-4 py-2 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                  >
                    Save Record
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
