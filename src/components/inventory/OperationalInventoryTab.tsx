import React, { useState, useEffect } from 'react';
import { Plus, Search, Package, Settings, History, Trash2, Edit2, X } from 'lucide-react';
import { OperationalInventory, OperationalInventoryUsage, OperationalInventoryMaintenance } from '../../types';
import { firestoreService } from '../../services/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { hasAnyRole } from '../../utils/roles';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { isLegacyOperationalInventorySeed } from '../../utils/operationalInventory';

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
    if (profile?.tenantId) {
      const unsubscribeInv = firestoreService.subscribeToCollection<OperationalInventory>(
        'operational_inventory',
        profile.tenantId,
        data => setInventory(data.filter(item => !isLegacyOperationalInventorySeed(item)))
      );
      const unsubscribeUsage = firestoreService.subscribeToCollection<OperationalInventoryUsage>(
        'operational_inventory_usage',
        profile.tenantId,
        setUsageLogs
      );
      const unsubscribeMaintenance = firestoreService.subscribeToCollection<OperationalInventoryMaintenance>(
        'operational_inventory_maintenance',
        profile.tenantId,
        setMaintenanceLogs
      );
      return () => {
        unsubscribeInv();
        unsubscribeUsage();
        unsubscribeMaintenance();
      };
    }
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
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Period</th>
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
                    <td className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                      {log.period}
                    </td>
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
          inventory={inventory}
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.tenantId) return;

    try {
      const data = { 
        ...formData, 
        tenantId: profile.tenantId, 
        branchId: activeBranchId || profile.branchId || null
      };

      // Auto-generate ID if missing
      if (!data.uniqueId) {
        const prefix = data.type === 'fixed' ? 'AST' : 'OPS';
        const randomNum = Math.floor(100000 + Math.random() * 900000);
        data.uniqueId = `${prefix}-${randomNum}`;
      }

      // Enforce quantity = 1 for fixed assets
      if (data.type === 'fixed') {
        data.quantityInStock = 1;
      }

      if (item?.id) {
        await firestoreService.updateDocument('operational_inventory', item.id, data);
        toast.success('Item updated');
      } else {
        await firestoreService.addDocument('operational_inventory', data);
        
        // Log capital expenditure for new fixed assets
        if (data.type === 'fixed' && data.cost) {
          await firestoreService.addDocument('finance_ledger', {
            tenantId: profile.tenantId,
            branch_id: profile.branchId || null,
            entry_type: 'expense',
            amount_ugx: data.cost,
            balance_ugx: 0,
            description: `Capital Expenditure: ${data.name} (Fixed Asset)`,
            reference_type: 'operational_inventory_asset',
            staff_id: profile.uid,
            entry_date: new Date().toISOString(),
            created_by: profile.displayName
          });
        }
        toast.success('Item added');
      }
      onClose();
    } catch (error) {
      toast.error('Failed to save item');
    }
  };

  const nonFixedCategories = ['Stationery', 'Packaging', 'Cleaning & Hygiene', 'Kitchen & Canteen', 'Other'];
  const fixedCategories = ['Furniture & Fittings', 'IT Equipment', 'Office Equipment', 'Kitchen Equipment', 'Security Equipment', 'Medical Equipment', 'Other'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl overflow-hidden">
        <div className="px-8 py-6 border-b border-zinc-100">
          <h2 className="text-xl font-black text-zinc-900 uppercase tracking-tight">{item ? 'Edit Item' : 'Add Item'}</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-8 space-y-6 max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Item Name</label>
              <input required className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Type</label>
              <select className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.type || 'non-fixed'} onChange={e => setFormData({...formData, type: e.target.value as any, category: ''})}>
                <option value="fixed">Fixed</option>
                <option value="non-fixed">Non-fixed</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Category</label>
              <select required className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.category || ''} onChange={e => setFormData({...formData, category: e.target.value})}>
                <option value="">Select Category</option>
                {(formData.type === 'fixed' ? fixedCategories : nonFixedCategories).map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Unit of Issue</label>
              <input required className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.unitOfIssue || ''} onChange={e => setFormData({...formData, unitOfIssue: e.target.value})} placeholder="e.g., sheet, roll, bag" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Supplier</label>
              <input className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.supplier || ''} onChange={e => setFormData({...formData, supplier: e.target.value})} />
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
                  <input className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.uniqueId || ''} onChange={e => setFormData({...formData, uniqueId: e.target.value})} placeholder="Auto-generated if empty" />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Units Per Pack</label>
                  <input required type="number" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.unitPerPack ?? 1} onChange={e => setFormData({...formData, unitPerPack: Number(e.target.value)})} />
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
                  <input className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.uniqueId || ''} onChange={e => setFormData({...formData, uniqueId: e.target.value})} placeholder="Auto-generated if empty" />
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
  const [formData, setFormData] = useState({
    inventoryId: '',
    issuedAmount: 0,
    period: 'daily' as any
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.tenantId || !formData.inventoryId) return;

    const item = inventory.find(i => i.id === formData.inventoryId);
    if (!item) return;

    const costPerUnit = (item.costPerPack || 0) / (item.unitPerPack || 1);
    const totalCost = costPerUnit * formData.issuedAmount;

    try {
      const logData: Omit<OperationalInventoryUsage, 'id'> = {
        tenantId: profile.tenantId,
        branchId: activeBranchId || null,
        inventoryId: formData.inventoryId,
        issuedAmount: formData.issuedAmount,
        cost: totalCost,
        timestamp: new Date().toISOString(),
        period: formData.period,
        staffId: profile.uid,
        staffName: profile.displayName
      };

      await firestoreService.addDocument('operational_inventory_usage', logData);
      
      // Update stock
      await firestoreService.updateDocument('operational_inventory', item.id, {
        quantityInStock: item.quantityInStock - formData.issuedAmount
      });

      // Fill costs ledger in finance module
      await firestoreService.addDocument('finance_ledger', {
        tenantId: profile.tenantId,
        branch_id: activeBranchId || null,
        entry_type: 'expense',
        amount_ugx: totalCost,
        balance_ugx: 0, // This would normally be calculated based on previous balance
        description: `Operational Inventory Usage: ${item.name} (${formData.issuedAmount} ${item.unitOfIssue})`,
        reference_id: formData.inventoryId,
        reference_type: 'operational_inventory_usage',
        staff_id: profile.uid,
        entry_date: new Date().toISOString(),
        created_by: profile.displayName
      });

      toast.success('Usage logged successfully');
      onClose();
    } catch (error) {
      toast.error('Failed to log usage');
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
              <select required className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.inventoryId} onChange={e => setFormData({...formData, inventoryId: e.target.value})}>
                <option value="">Select Item</option>
                {inventory.filter(i => i.type === 'non-fixed').map(i => <option key={i.id} value={i.id}>{i.name} ({i.quantityInStock} {i.unitOfIssue} left)</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Amount Issued</label>
                <input required type="number" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.issuedAmount} onChange={e => setFormData({...formData, issuedAmount: Number(e.target.value)})} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Logging Period</label>
                <select className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.period} onChange={e => setFormData({...formData, period: e.target.value as any})}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="bi-weekly">Bi-weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="px-6 py-2 border border-zinc-200 rounded-xl font-bold text-zinc-600 uppercase text-xs tracking-widest">Cancel</button>
            <button type="submit" className="px-8 py-2 bg-zinc-900 text-white rounded-xl font-bold uppercase text-xs tracking-widest shadow-lg shadow-zinc-900/20">Log Usage</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default OperationalInventoryTab;
