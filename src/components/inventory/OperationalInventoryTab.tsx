import React, { useState, useEffect } from 'react';
import { where } from 'firebase/firestore';
import { Plus, Search, Package, Settings, History, Trash2, Edit2, X } from 'lucide-react';
import { OperationalInventory, OperationalInventoryMaster, OperationalInventoryUsage, OperationalInventoryMaintenance } from '../../types';
import { firestoreService } from '../../services/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { hasAnyRole } from '../../utils/roles';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { isLegacyOperationalInventorySeed } from '../../utils/operationalInventory';
import { operationalTypeForLegacyType } from '../../services/inventoryClassification';
import { saveOperationalLocationItem } from '../../services/operationalInventoryMasterService';
import { logOperationalUsage } from '../../services/operationalInventoryUsageService';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const OperationalInventoryTab: React.FC = () => {
  const { profile, activeBranchId } = useAuth();
  const [activeSubTab, setActiveSubTab] = useState<'registry' | 'usage'>('registry');
  const [inventory, setInventory] = useState<OperationalInventory[]>([]);
  const [usageLogs, setUsageLogs] = useState<OperationalInventoryUsage[]>([]);
  const [maintenanceLogs, setMaintenanceLogs] = useState<OperationalInventoryMaintenance[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUsageModalOpen, setIsUsageModalOpen] = useState(false);
  const [isMaintenanceModalOpen, setIsMaintenanceModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<OperationalInventory | null>(null);
  const [selectedItemForDetails, setSelectedItemForDetails] = useState<OperationalInventory | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const isCEO = hasAnyRole(profile, ['CEO', 'CEO / MD', 'owner']);

  useEffect(() => {
    if (profile?.tenantId && activeBranchId) {
      const branchScope = [where('branchId', '==', activeBranchId)];
      const unsubscribeInv = firestoreService.subscribeToCollectionByQuery<OperationalInventory>(
        'operational_inventory',
        profile.tenantId,
        branchScope,
        data => setInventory(data.filter(item => !isLegacyOperationalInventorySeed(item)))
      );
      const unsubscribeUsage = firestoreService.subscribeToCollectionByQuery<OperationalInventoryUsage>(
        'operational_inventory_usage',
        profile.tenantId,
        branchScope,
        setUsageLogs
      );
      const unsubscribeMaintenance = firestoreService.subscribeToCollectionByQuery<OperationalInventoryMaintenance>(
        'operational_inventory_maintenance',
        profile.tenantId,
        branchScope,
        setMaintenanceLogs
      );
      return () => {
        unsubscribeInv();
        unsubscribeUsage();
        unsubscribeMaintenance();
      };
    }
    setInventory([]);
    setUsageLogs([]);
    setMaintenanceLogs([]);
  }, [profile?.tenantId, activeBranchId]);

  const filteredInventory = inventory.filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
    (item.branchId === activeBranchId || !item.branchId || !activeBranchId)
  );

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this item?')) {
      try {
        await firestoreService.deleteDocument('operational_inventory', id);
        toast.success('Item deleted successfully');
      } catch (error) {
        toast.error('Failed to delete item');
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 p-1 bg-zinc-100 rounded-2xl w-fit">
          <button
            onClick={() => setActiveSubTab('registry')}
            className={cn(
              "px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
              activeSubTab === 'registry' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
            )}
          >
            Inventory Registry
          </button>
          <button
            onClick={() => setActiveSubTab('usage')}
            className={cn(
              "px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
              activeSubTab === 'usage' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
            )}
          >
            Usage Logs
          </button>
        </div>
        <div className="flex gap-3">
          {activeSubTab === 'registry' ? (
            <button 
              onClick={() => {
                setEditingItem(null);
                setIsModalOpen(true);
              }}
              className="px-4 py-2 bg-zinc-900 text-white rounded-xl font-bold text-xs uppercase tracking-widest flex items-center gap-2"
            >
              <Plus size={16} />
              Add Item
            </button>
          ) : (
            <button 
              onClick={() => setIsUsageModalOpen(true)}
              className="px-4 py-2 bg-zinc-900 text-white rounded-xl font-bold text-xs uppercase tracking-widest flex items-center gap-2"
            >
              <Plus size={16} />
              Log Usage
            </button>
          )}
        </div>
      </div>

      {activeSubTab === 'registry' ? (
        <div className="bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-zinc-100">
            <div className="relative w-full max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
              <input 
                type="text"
                placeholder="Search operational inventory..."
                className="w-full pl-10 pr-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50/50 border-b border-zinc-100">
                  <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Item Name</th>
                  <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Type</th>
                  <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">In Stock</th>
                  <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Cost/Pack</th>
                  <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Supplier</th>
                  <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filteredInventory.map(item => (
                  <tr 
                    key={item.id} 
                    className="hover:bg-zinc-50/50 transition-colors group cursor-pointer"
                    onClick={() => setSelectedItemForDetails(item)}
                  >
                    <td className="px-6 py-4">
                      <p className="font-bold text-zinc-900">{item.name}</p>
                      {item.uniqueId && <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{item.uniqueId}</p>}
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest",
                        item.type === 'fixed' ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                      )}>
                        {item.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-bold text-zinc-900">
                      {item.quantityInStock} {item.unitOfIssue}
                    </td>
                    <td className="px-6 py-4 text-xs font-medium text-zinc-600">
                      {(item.costPerPack || 0).toLocaleString()} UGX
                    </td>
                    <td className="px-6 py-4 text-xs text-zinc-500">
                      {item.supplier || 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => {
                            setEditingItem(item);
                            setIsModalOpen(true);
                          }}
                          className="p-2 text-zinc-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-all"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => handleDelete(item.id)}
                          className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
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
      ) : (
        <div className="bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50/50 border-b border-zinc-100">
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Time</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Item</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Department / Purpose</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Qty Issued</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {usageLogs
                .filter(l => l.branchId === activeBranchId)
                .map(log => {
                const item = inventory.find(i => i.id === log.inventoryId);
                return (
                  <tr key={log.id} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="px-6 py-4 text-xs font-medium text-zinc-600">
                      {format(new Date(log.timestamp), 'MMM dd, HH:mm')}
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-bold text-zinc-900">{item?.name || 'Unknown'}</p>
                    </td>
                    <td className="px-6 py-4 text-xs text-zinc-600"><strong>{log.department || log.period}</strong>{log.purpose && <p className="mt-1 text-[10px] text-zinc-400">{log.purpose}{log.recipient ? ` · For ${log.recipient}` : ''}</p>}</td>
                    <td className="px-6 py-4 text-xs font-black text-zinc-900 text-right">
                      {log.issuedAmount}
                    </td>
                    <td className="px-6 py-4 text-xs font-bold text-zinc-900 text-right">
                      {(log.cost || 0).toLocaleString()} UGX
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isModalOpen && (
        <InventoryItemModal 
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          item={editingItem}
        />
      )}

      {isUsageModalOpen && (
        <UsageLogModal 
          isOpen={isUsageModalOpen}
          onClose={() => setIsUsageModalOpen(false)}
          inventory={filteredInventory}
        />
      )}

      {selectedItemForDetails && (
        <DetailsModal 
          isOpen={!!selectedItemForDetails}
          onClose={() => setSelectedItemForDetails(null)}
          item={selectedItemForDetails}
          usageLogs={usageLogs.filter(l => l.inventoryId === selectedItemForDetails.id)}
          maintenanceLogs={maintenanceLogs.filter(l => l.inventoryId === selectedItemForDetails.id)}
          onAddMaintenance={() => setIsMaintenanceModalOpen(true)}
        />
      )}

      {isMaintenanceModalOpen && selectedItemForDetails && (
        <MaintenanceLogModal
          isOpen={isMaintenanceModalOpen}
          onClose={() => setIsMaintenanceModalOpen(false)}
          item={selectedItemForDetails}
        />
      )}
    </div>
  );
};

const DetailsModal: React.FC<{ 
  isOpen: boolean; 
  onClose: () => void; 
  item: OperationalInventory; 
  usageLogs: OperationalInventoryUsage[];
  maintenanceLogs: OperationalInventoryMaintenance[];
  onAddMaintenance: () => void;
}> = ({ isOpen, onClose, item, usageLogs, maintenanceLogs, onAddMaintenance }) => {
  const timeInSystem = item.purchaseDate ? Math.floor((new Date().getTime() - new Date(item.purchaseDate).getTime()) / (1000 * 60 * 60 * 24)) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden">
        <div className="px-8 py-6 border-b border-zinc-100 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-zinc-900 uppercase tracking-tight">{item.name}</h2>
            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Operational Inventory Details</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-xl transition-all">
            <X size={20} className="text-zinc-400" />
          </button>
        </div>
        <div className="p-8 space-y-8 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-3 gap-6">
            <div className="space-y-1">
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Type</p>
              <p className="font-bold text-zinc-900 capitalize">{item.type}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Category</p>
              <p className="font-bold text-zinc-900">{item.category || 'N/A'}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">In Stock</p>
              <p className="font-bold text-zinc-900">{item.quantityInStock} {item.unitOfIssue}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Supplier</p>
              <p className="font-bold text-zinc-900">{item.supplier || 'N/A'}</p>
            </div>
            {item.type === 'non-fixed' && (
              <>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Units Per Pack</p>
                  <p className="font-bold text-zinc-900">{item.unitPerPack}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Cost Per Pack</p>
                  <p className="font-bold text-zinc-900">{(item.costPerPack || 0).toLocaleString()} UGX</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Cost Per Unit</p>
                  <p className="font-bold text-zinc-900">{((item.costPerPack || 0) / (item.unitPerPack || 1)).toLocaleString()} UGX</p>
                </div>
              </>
            )}
            {item.type === 'fixed' && (
              <>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Status</p>
                  <p className="font-bold text-zinc-900">{item.status || 'N/A'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Condition</p>
                  <p className="font-bold text-zinc-900">{item.condition || 'N/A'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Time in System</p>
                  <p className="font-bold text-zinc-900">{timeInSystem} days</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Warranty Expiry</p>
                  <p className="font-bold text-zinc-900">{item.warrantyExpiry ? format(new Date(item.warrantyExpiry), 'MMM dd, yyyy') : 'N/A'}</p>
                </div>
              </>
            )}
            {item.uniqueId && (
              <div className="space-y-1">
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Unique ID</p>
                <p className="font-bold text-zinc-900">{item.uniqueId}</p>
              </div>
            )}
            {item.purchaseDate && (
              <div className="space-y-1">
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Purchase Date</p>
                <p className="font-bold text-zinc-900">{format(new Date(item.purchaseDate), 'MMM dd, yyyy')}</p>
              </div>
            )}
            {item.cost && (
              <div className="space-y-1">
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Total Cost</p>
                <p className="font-bold text-zinc-900">{(item.cost || 0).toLocaleString()} UGX</p>
              </div>
            )}
          </div>

          {item.description && (
            <div className="space-y-1">
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Description</p>
              <p className="text-xs text-zinc-600 leading-relaxed">{item.description}</p>
            </div>
          )}

          {item.type === 'fixed' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                <h3 className="text-xs font-black text-zinc-900 uppercase tracking-widest">Maintenance & Repair Log</h3>
                <button onClick={onAddMaintenance} className="text-[10px] font-black text-zinc-900 uppercase tracking-widest hover:underline">Add Entry</button>
              </div>
              <div className="space-y-3">
                {maintenanceLogs.length > 0 ? (
                  maintenanceLogs.map(log => (
                    <div key={log.id} className="p-3 bg-zinc-50 rounded-2xl border border-zinc-100">
                      <div className="flex justify-between items-start mb-1">
                        <p className="text-xs font-bold text-zinc-900">{format(new Date(log.date), 'MMM dd, yyyy')}</p>
                        <p className="text-xs font-black text-zinc-900">{(log.cost || 0).toLocaleString()} UGX</p>
                      </div>
                      <p className="text-[10px] text-zinc-600 mb-1">{log.description}</p>
                      <p className="text-[8px] font-black text-zinc-400 uppercase tracking-widest">Logged by {log.staffName}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-zinc-500 italic py-4 text-center">No maintenance logs found.</p>
                )}
              </div>
            </div>
          )}

          <div className="space-y-4">
            <h3 className="text-xs font-black text-zinc-900 uppercase tracking-widest border-b border-zinc-100 pb-2">Recent Usage History</h3>
            <div className="space-y-3">
              {usageLogs.length > 0 ? (
                usageLogs.slice(0, 5).map(log => (
                  <div key={log.id} className="flex items-center justify-between p-3 bg-zinc-50 rounded-2xl border border-zinc-100">
                    <div>
                      <p className="text-xs font-bold text-zinc-900">{format(new Date(log.timestamp), 'MMM dd, yyyy HH:mm')}</p>
                      <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{log.period} Log {log.staffName ? `• ${log.staffName}` : ''}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-black text-zinc-900">{log.issuedAmount} {item.unitOfIssue}</p>
                      <p className="text-[10px] font-bold text-zinc-500">{(log.cost || 0).toLocaleString()} UGX</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-zinc-500 italic py-4 text-center">No usage logs found for this item.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Sub-modals for Operational Inventory
const InventoryItemModal: React.FC<{ isOpen: boolean; onClose: () => void; item: OperationalInventory | null }> = ({ isOpen, onClose, item }) => {
  const { profile, activeBranchId } = useAuth();
  const [masters, setMasters] = useState<OperationalInventoryMaster[]>([]);
  const [linkExisting, setLinkExisting] = useState(false);
  const [selectedMasterId, setSelectedMasterId] = useState('');
  const [formData, setFormData] = useState<Partial<OperationalInventory>>({
    name: '',
    type: 'non-fixed',
    category: '',
    unitPerPack: 1,
    costPerPack: 0,
    unitOfIssue: '',
    supplier: '',
    quantityInStock: 0,
    uniqueId: '',
    description: '',
    condition: 'New',
    status: 'In Use',
    ...item
  });

  useEffect(() => {
    if (!profile?.tenantId) return;
    return firestoreService.subscribeToCollection<OperationalInventoryMaster>(
      'operational_inventory_masters', profile.tenantId, setMasters
    );
  }, [profile?.tenantId]);

  useEffect(() => {
    if (!isOpen) return;
    setFormData({
      name: '', type: 'non-fixed', category: '', unitPerPack: 1, costPerPack: 0,
      unitOfIssue: '', supplier: '', quantityInStock: 0, uniqueId: '', description: '',
      condition: 'New', status: 'In Use', ...item
    });
    setSelectedMasterId(item?.masterItemId || '');
    setLinkExisting(Boolean(item?.masterItemId));
  }, [isOpen, item]);

  const selectMaster = (masterId: string) => {
    setSelectedMasterId(masterId);
    const master = masters.find(row => row.id === masterId);
    if (!master) return;
    setFormData(current => ({
      ...current,
      name: master.name,
      type: master.type,
      category: master.category || '',
      unitPerPack: master.unitPerPack,
      unitOfIssue: master.unitOfIssue,
      supplier: master.supplier || '',
      uniqueId: master.uniqueId,
      description: master.description || '',
      operationalType: master.operationalType,
      inventoryClass: 'OPERATIONAL'
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.tenantId) return;

    try {
      const branchId = activeBranchId || profile.branchId;
      if (!branchId) throw new Error('Select a branch or HQ location before registering the item.');
      const data = { 
        ...formData, 
        inventoryClass: 'OPERATIONAL' as const,
        operationalType: operationalTypeForLegacyType(formData.type || 'non-fixed'),
        tenantId: profile.tenantId, 
        branchId
      };

      // Auto-generate ID if missing
      if (!data.uniqueId && !(linkExisting && selectedMasterId)) {
        const prefix = data.type === 'fixed' ? 'AST' : 'OPS';
        const randomNum = Math.floor(100000 + Math.random() * 900000);
        data.uniqueId = `${prefix}-${randomNum}`;
      }

      // Enforce quantity = 1 for fixed assets
      if (data.type === 'fixed') {
        data.quantityInStock = 1;
      }

      if (item?.id) {
        await saveOperationalLocationItem({
          tenantId: profile.tenantId,
          branchId,
          actor: { uid: profile.uid, name: profile.displayName },
          itemId: item.id,
          masterItemId: linkExisting && selectedMasterId ? selectedMasterId : item.masterItemId || item.id,
          data
        });
        toast.success('Item updated');
      } else {
        await saveOperationalLocationItem({
          tenantId: profile.tenantId,
          branchId,
          actor: { uid: profile.uid, name: profile.displayName },
          ...(linkExisting && selectedMasterId ? { masterItemId: selectedMasterId } : {}),
          data
        });
        // Registering an item is not a financial acquisition. Fixed asset
        // acquisition events are emitted only when an Operational GRN finalizes.
        toast.success('Item added');
      }
      onClose();
    } catch (error) {
      toast.error('Failed to save item');
    }
  };

  const nonFixedCategories = ['Stationery', 'Packaging', 'Cleaning & Hygiene', 'Kitchen & Canteen', 'Other'];
  const fixedCategories = ['Furniture & Fittings', 'IT Equipment', 'Office Equipment', 'Kitchen Equipment', 'Security Equipment', 'Medical Equipment', 'Other'];
  const identityLocked = Boolean((!item && linkExisting) || (item?.masterItemId && item.masterItemId !== item.id) || (item && !item.masterItemId && linkExisting));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl overflow-hidden">
        <div className="px-8 py-6 border-b border-zinc-100">
          <h2 className="text-xl font-black text-zinc-900 uppercase tracking-tight">{item ? 'Edit Item' : 'Add Item'}</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-8 space-y-6 max-h-[80vh] overflow-y-auto">
          {(!item || !item.masterItemId) && (
            <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-sky-900">Tenant-wide Operational item identity</p>
              <div className="flex flex-wrap gap-4 text-xs font-bold text-sky-900">
                <label className="flex items-center gap-2"><input type="radio" checked={!linkExisting} onChange={() => { setLinkExisting(false); setSelectedMasterId(''); }} />Register a new item</label>
                <label className="flex items-center gap-2"><input type="radio" checked={linkExisting} onChange={() => setLinkExisting(true)} />Link this location to an existing item</label>
              </div>
              {linkExisting && (
                <select required value={selectedMasterId} onChange={event => selectMaster(event.target.value)} className="w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm">
                  <option value="">Select tenant Operational item</option>
                  {masters.map(master => <option key={master.id} value={master.id}>{master.name} · {master.uniqueId}</option>)}
                </select>
              )}
              <p className="text-[10px] text-sky-700">Use the same item identity at HQ and branches. Each location keeps its own on-hand balance.</p>
            </div>
          )}
          {identityLocked && <p className="rounded-xl bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-800">This location is linked to the tenant-wide item identity. Its name, subtype and issue unit are controlled by that shared identity.</p>}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Item Name</label>
              <input required disabled={identityLocked} className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none disabled:opacity-60" value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Type</label>
              <select disabled={Boolean(item) || identityLocked} className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none disabled:opacity-60" value={formData.type || 'non-fixed'} onChange={e => setFormData({...formData, type: e.target.value as any, category: ''})}>
                <option value="fixed">Fixed</option>
                <option value="non-fixed">Non-fixed</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Category</label>
              <select required disabled={identityLocked} className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none disabled:opacity-60" value={formData.category || ''} onChange={e => setFormData({...formData, category: e.target.value})}>
                <option value="">Select Category</option>
                {(formData.type === 'fixed' ? fixedCategories : nonFixedCategories).map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Unit of Issue</label>
              <input required disabled={identityLocked} className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none disabled:opacity-60" value={formData.unitOfIssue || ''} onChange={e => setFormData({...formData, unitOfIssue: e.target.value})} placeholder="e.g., sheet, roll, bag" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Supplier</label>
              <input disabled={identityLocked} className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none disabled:opacity-60" value={formData.supplier || ''} onChange={e => setFormData({...formData, supplier: e.target.value})} />
            </div>

            {formData.type === 'fixed' ? (
              <>
                <div className="col-span-2 space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Description</label>
                  <textarea className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none resize-none h-20" value={formData.description || ''} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="Model, color, details..." />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Purchase Date</label>
                  <input required type="date" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.purchaseDate || ''} onChange={e => setFormData({...formData, purchaseDate: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Purchase Cost (UGX)</label>
                  <input required type="number" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.cost ?? 0} onChange={e => setFormData({...formData, cost: Number(e.target.value)})} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Condition</label>
                  <select className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.condition || 'New'} onChange={e => setFormData({...formData, condition: e.target.value as any})}>
                    <option value="New">New</option>
                    <option value="Used - Good">Used - Good</option>
                    <option value="Used - Fair">Used - Fair</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Status</label>
                  <select className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.status || 'In Use'} onChange={e => setFormData({...formData, status: e.target.value as any})}>
                    <option value="In Use">In Use</option>
                    <option value="Under Repair">Under Repair</option>
                    <option value="Decommissioned">Decommissioned</option>
                    <option value="Disposed">Disposed</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Warranty Expiry</label>
                  <input type="date" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.warrantyExpiry || ''} onChange={e => setFormData({...formData, warrantyExpiry: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Asset ID (Optional)</label>
                  <input disabled={identityLocked} className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none disabled:opacity-60" value={formData.uniqueId || ''} onChange={e => setFormData({...formData, uniqueId: e.target.value})} placeholder="Auto-generated if empty" />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Units Per Pack</label>
                  <input required disabled={identityLocked} type="number" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none disabled:opacity-60" value={formData.unitPerPack ?? 1} onChange={e => setFormData({...formData, unitPerPack: Number(e.target.value)})} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Cost Per Pack</label>
                  <input required type="number" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.costPerPack ?? 0} onChange={e => setFormData({...formData, costPerPack: Number(e.target.value)})} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Initial Stock</label>
                  <input required type="number" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.quantityInStock ?? 0} onChange={e => setFormData({...formData, quantityInStock: Number(e.target.value)})} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Item ID (Optional)</label>
                  <input disabled={identityLocked} className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none disabled:opacity-60" value={formData.uniqueId || ''} onChange={e => setFormData({...formData, uniqueId: e.target.value})} placeholder="Auto-generated if empty" />
                </div>
              </>
            )}
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="px-6 py-2 border border-zinc-200 rounded-xl font-bold text-zinc-600 uppercase text-xs tracking-widest">Cancel</button>
            <button type="submit" className="px-8 py-2 bg-zinc-900 text-white rounded-xl font-bold uppercase text-xs tracking-widest shadow-lg shadow-zinc-900/20">Save Item</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const MaintenanceLogModal: React.FC<{ isOpen: boolean; onClose: () => void; item: OperationalInventory }> = ({ isOpen, onClose, item }) => {
  const { profile, activeBranchId } = useAuth();
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    description: '',
    cost: 0
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.tenantId) return;

    try {
      const logData: Omit<OperationalInventoryMaintenance, 'id'> = {
        tenantId: profile.tenantId,
        branchId: activeBranchId || '',
        inventoryId: item.id,
        date: formData.date,
        description: formData.description,
        cost: formData.cost,
        staffId: profile.uid,
        staffName: profile.displayName
      };

      await firestoreService.addDocument('operational_inventory_maintenance', logData);
      
      // Log maintenance as expense in finance ledger
      await firestoreService.addDocument('finance_ledger', {
        tenantId: profile.tenantId,
        branch_id: activeBranchId || null,
        entry_type: 'expense',
        amount_ugx: formData.cost,
        balance_ugx: 0,
        description: `Maintenance: ${item.name} - ${formData.description}`,
        reference_id: item.id,
        reference_type: 'operational_inventory_maintenance',
        staff_id: profile.uid,
        entry_date: new Date().toISOString(),
        created_by: profile.displayName
      });

      toast.success('Maintenance log added');
      onClose();
    } catch (error) {
      toast.error('Failed to add maintenance log');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-md rounded-[32px] shadow-2xl overflow-hidden">
        <div className="px-8 py-6 border-b border-zinc-100">
          <h2 className="text-xl font-black text-zinc-900 uppercase tracking-tight">Log Maintenance</h2>
          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{item.name}</p>
        </div>
        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Date</label>
              <input required type="date" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Cost (UGX)</label>
              <input required type="number" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.cost} onChange={e => setFormData({...formData, cost: Number(e.target.value)})} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Description</label>
              <textarea required className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none resize-none h-24" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="What was done?" />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="px-6 py-2 border border-zinc-200 rounded-xl font-bold text-zinc-600 uppercase text-xs tracking-widest">Cancel</button>
            <button type="submit" className="px-8 py-2 bg-zinc-900 text-white rounded-xl font-bold uppercase text-xs tracking-widest">Save Entry</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const UsageLogModal: React.FC<{ isOpen: boolean; onClose: () => void; inventory: OperationalInventory[] }> = ({ isOpen, onClose, inventory }) => {
  const { profile, activeBranchId } = useAuth();
  const [requestId, setRequestId] = useState('');
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    inventoryId: '',
    issuedAmount: 0,
    department: '',
    recipient: '',
    purpose: '',
    reference: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.tenantId || !formData.inventoryId) return;

    const item = inventory.find(i => i.id === formData.inventoryId);
    if (!item) return;

    const idempotencyRequest = requestId || globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    if (!requestId) setRequestId(idempotencyRequest);
    setSaving(true);
    try {
      const result = await logOperationalUsage({
        tenantId: profile.tenantId, branchId: activeBranchId || item.branchId,
        itemId: item.id, quantity: formData.issuedAmount,
        department: formData.department, recipient: formData.recipient,
        purpose: formData.purpose, reference: formData.reference,
        requestId: idempotencyRequest,
        actor: { uid: profile.uid, name: profile.displayName || profile.full_name || profile.name || profile.uid }
      });
      toast.success(`Usage recorded. Remaining stock: ${result.remainingStock} ${item.unitOfIssue}. No expense was posted; cost is recognized at GRN finalization.`);
      setRequestId('');
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to log Operational usage.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl overflow-hidden">
        <div className="px-8 py-6 border-b border-zinc-100">
          <h2 className="text-xl font-black text-zinc-900 uppercase tracking-tight">Log Usage</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Select Item</label>
              <select required className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.inventoryId} onChange={e => { setFormData({...formData, inventoryId: e.target.value}); setRequestId(''); }}>
                <option value="">Select Item</option>
                {inventory.filter(i => i.operationalType === 'CONSUMABLE_OPERATIONAL' || (!i.operationalType && i.type === 'non-fixed')).map(i => <option key={i.id} value={i.id}>{i.name} ({i.quantityInStock} {i.unitOfIssue} left)</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Amount Issued</label>
                <input required type="number" min="0.001" max={Number(inventory.find(item => item.id === formData.inventoryId)?.quantityInStock || 0)} step="any" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.issuedAmount || ''} onChange={e => { setFormData({...formData, issuedAmount: Number(e.target.value)}); setRequestId(''); }} />
              </div>
              <label className="space-y-1 block"><span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Department</span><input required maxLength={120} className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.department} onChange={e => { setFormData({...formData, department: e.target.value}); setRequestId(''); }} /></label>
              <label className="space-y-1 block"><span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Recipient (optional)</span><input maxLength={120} className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.recipient} onChange={e => { setFormData({...formData, recipient: e.target.value}); setRequestId(''); }} /></label>
              <label className="space-y-1 block"><span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Purpose</span><input required maxLength={300} className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.purpose} onChange={e => { setFormData({...formData, purpose: e.target.value}); setRequestId(''); }} /></label>
              <label className="space-y-1 block"><span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Reference</span><input required maxLength={120} className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.reference} onChange={e => { setFormData({...formData, reference: e.target.value}); setRequestId(''); }} placeholder="Issue voucher or internal reference" /></label>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} disabled={saving} className="px-6 py-2 border border-zinc-200 rounded-xl font-bold text-zinc-600 uppercase text-xs tracking-widest">Cancel</button>
            <button type="submit" disabled={saving} className="px-8 py-2 bg-zinc-900 text-white rounded-xl font-bold uppercase text-xs tracking-widest shadow-lg shadow-zinc-900/20 disabled:opacity-50">{saving ? 'Recording…' : 'Log Usage'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default OperationalInventoryTab;
