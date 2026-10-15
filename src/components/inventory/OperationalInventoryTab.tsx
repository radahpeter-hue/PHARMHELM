import React, { useState, useEffect } from 'react';
import { where } from 'firebase/firestore';
import { Plus, Search, Package, Settings, History, Trash2, Edit2, X, Download } from 'lucide-react';
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
import { OperationalStockBalance } from './OperationalStockBalance';
import { operationalIssueUnit, validateOperationalOpeningStock } from '../../utils/operationalStock';
import { logOperationalUsage } from '../../services/operationalInventoryUsageService';
import { defaultUsageDateRange, filterOperationalUsageByDate, operationalUsageCSV, operationalUsageReportRows, validUsageDateRange, usageTimestampDate } from '../../utils/operationalUsageReport';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const OperationalInventoryTab: React.FC = () => {
  const { profile, activeBranchId, hasPermission } = useAuth();
  const [activeSubTab, setActiveSubTab] = useState<'registry' | 'usage'>('registry');
  const [inventory, setInventory] = useState<OperationalInventory[]>([]);
  const [usageLogs, setUsageLogs] = useState<OperationalInventoryUsage[]>([]);
  const [usageDateRange, setUsageDateRange] = useState(defaultUsageDateRange);
  const [exportingUsage, setExportingUsage] = useState(false);
  const [maintenanceLogs, setMaintenanceLogs] = useState<OperationalInventoryMaintenance[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUsageModalOpen, setIsUsageModalOpen] = useState(false);
  const [isMaintenanceModalOpen, setIsMaintenanceModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<OperationalInventory | null>(null);
  const [selectedItemForDetails, setSelectedItemForDetails] = useState<OperationalInventory | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const canOperate = hasPermission('inventory', 'operate');
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

  const selectedUsageLogs = filterOperationalUsageByDate(usageLogs.filter(log => log.branchId === activeBranchId), usageDateRange);
  const usageReportRows = () => operationalUsageReportRows(selectedUsageLogs, Object.fromEntries(inventory.map(item => [item.id, item.name])));

  const downloadUsageCSV = () => {
    if (!validUsageDateRange(usageDateRange) || selectedUsageLogs.length === 0) return;
    const blob = new Blob([operationalUsageCSV(usageReportRows())], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `operational-usage_${usageDateRange.start}_to_${usageDateRange.end}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const downloadUsagePDF = async () => {
    if (!validUsageDateRange(usageDateRange) || selectedUsageLogs.length === 0 || exportingUsage) return;
    setExportingUsage(true);
    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const rows = usageReportRows();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const widths = [29, 38, 30, 48, 28, 16, 38, 42];
      const headers = ['Date / Time', 'Item', 'Department', 'Purpose / Recipient', 'Qty / Unit', 'UGX Value', 'Reference', 'Recorded By'];
      const left = 10;
      const drawHeading = (page: number) => {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(15);
        pdf.text('Operational Inventory Usage Report', left, 14);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.text(`Period: ${usageDateRange.start} to ${usageDateRange.end}  |  Branch: ${activeBranchId || 'Unknown'}  |  Records: ${rows.length}`, left, 21);
        pdf.text(`Page ${page}`, pageWidth - 24, 21);
        pdf.setFillColor(235, 238, 241);
        pdf.rect(left, 26, pageWidth - 20, 9, 'F');
        pdf.setFont('helvetica', 'bold');
        let x = left;
        headers.forEach((h, index) => { pdf.text(h, x + 1, 32); x += widths[index]; });
      };
      let y = 37;
      let page = 1;
      drawHeading(page);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      rows.forEach((row, index) => {
        const cells = [row.timestamp, row.item, row.department, [row.purpose, row.recipient ? `For ${row.recipient}` : ''].filter(Boolean).join(' | '), `${row.issued} ${row.unit}`, row.cost.toLocaleString('en-UG'), row.reference, row.recordedBy];
        const lines = cells.map((cell, i) => pdf.splitTextToSize(String(cell), widths[i] - 3));
        const height = Math.max(8, Math.max(...lines.map(line => line.length)) * 4 + 2);
        if (y + height > pdf.internal.pageSize.getHeight() - 12) { pdf.addPage(); page += 1; drawHeading(page); y = 37; pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); }
        if (index % 2 === 0) { pdf.setFillColor(249, 250, 251); pdf.rect(left, y - 1, pageWidth - 20, height, 'F'); }
        let x = left;
        lines.forEach((line, i) => { pdf.text(line, x + 1, y + 3); x += widths[i]; });
        y += height;
      });
      pdf.save(`operational-usage_${usageDateRange.start}_to_${usageDateRange.end}.pdf`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to generate usage report PDF.');
    } finally { setExportingUsage(false); }
  };

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
          {canOperate && (activeSubTab === 'registry' ? (
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
          ))}
        </div>
      </div>

      {activeSubTab === 'registry' && <OperationalMasterCatalogue locationId={activeBranchId || profile?.branchId || ''} items={inventory} />}
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
                      <OperationalStockBalance quantity={item.quantityInStock} unit={item.unitOfIssue} />
                    </td>
                    <td className="px-6 py-4 text-xs font-medium text-zinc-600">
                      {(item.costPerPack || 0).toLocaleString()} UGX
                    </td>
                    <td className="px-6 py-4 text-xs text-zinc-500">
                      {item.supplier || 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2 opacity-100 transition-opacity">
                        <button disabled={!canOperate}
                          onClick={() => {
                            setEditingItem(item);
                            setIsModalOpen(true);
                          }}
                          className="p-2 text-zinc-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-all"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button disabled={!isCEO}
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
        <section className="overflow-hidden rounded-3xl border border-zinc-200 bg-white text-zinc-900 shadow-sm">
          <div className="flex flex-col gap-4 border-b border-zinc-200 p-4 sm:p-5">
            <div>
              <h3 className="text-lg font-bold text-zinc-900">Operational Usage Ledger</h3>
              <p className="mt-1 text-sm text-zinc-700">Showing the last 7 calendar days by default. Choose dates to view or export another period.</p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-[145px] flex-col gap-1 text-sm font-semibold text-zinc-800">Start date
                <input aria-label="Usage start date" type="date" value={usageDateRange.start} max={usageDateRange.end} onChange={event => setUsageDateRange(range => ({ ...range, start: event.target.value }))} className="rounded-lg border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900" />
              </label>
              <label className="flex min-w-[145px] flex-col gap-1 text-sm font-semibold text-zinc-800">End date
                <input aria-label="Usage end date" type="date" value={usageDateRange.end} min={usageDateRange.start} onChange={event => setUsageDateRange(range => ({ ...range, end: event.target.value }))} className="rounded-lg border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900" />
              </label>
              <button type="button" onClick={() => setUsageDateRange(defaultUsageDateRange())} className="rounded-lg border border-zinc-400 bg-white px-4 py-2 text-sm font-semibold text-zinc-900">Last 7 days</button>
              <button type="button" disabled={!validUsageDateRange(usageDateRange) || selectedUsageLogs.length === 0} onClick={downloadUsageCSV} className="flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Download size={15} /> CSV</button>
              <button type="button" disabled={!validUsageDateRange(usageDateRange) || selectedUsageLogs.length === 0 || exportingUsage} onClick={() => void downloadUsagePDF()} className="flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Download size={15} /> {exportingUsage ? 'Preparing PDF…' : 'PDF'}</button>
            </div>
            {!validUsageDateRange(usageDateRange) && <p role="alert" className="text-sm font-semibold text-red-700">Select a valid date range (start must be on or before end).</p>}
            <p className="text-sm font-semibold text-zinc-800">{selectedUsageLogs.length} usage record{selectedUsageLogs.length === 1 ? '' : 's'} for the selected period</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[730px] border-collapse text-left">
              <thead><tr className="border-b border-zinc-200 bg-zinc-100 text-xs font-bold uppercase text-zinc-800">
                <th className="px-4 py-3">Date &amp; time</th><th className="px-4 py-3">Item</th><th className="px-4 py-3">Department / purpose</th>
                <th className="px-4 py-3">Reference</th><th className="px-4 py-3 text-right">Qty issued</th><th className="px-4 py-3 text-right">Value (UGX)</th>
              </tr></thead>
              <tbody className="divide-y divide-zinc-200">
                {selectedUsageLogs.map(log => {
                  const item = inventory.find(i => i.id === log.inventoryId);
                  const date = usageTimestampDate(log.timestamp);
                  return <tr key={log.id} className="hover:bg-zinc-50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-800">{date ? format(date, 'dd MMM yyyy, HH:mm') : 'Unknown date'}</td>
                    <td className="px-4 py-3 text-sm font-bold text-zinc-900">{log.itemName || item?.name || 'Unknown item'}</td>
                    <td className="px-4 py-3 text-sm text-zinc-800"><strong>{log.department || 'Not specified'}</strong><p className="mt-1 break-words text-sm text-zinc-700">{log.purpose || ''}{log.recipient ? ` · For ${log.recipient}` : ''}</p></td>
                    <td className="break-all px-4 py-3 text-xs text-zinc-700">{log.reference || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-bold text-zinc-900">{log.issuedAmount} {operationalIssueUnit(log.unitOfIssue) || 'units'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-bold text-zinc-900">{Number(log.cost || 0).toLocaleString('en-UG')}</td>
                  </tr>;
                })}
                {selectedUsageLogs.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-zinc-700">No operational usage recorded for this date range.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
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
              <OperationalStockBalance quantity={item.quantityInStock} unit={item.unitOfIssue} />
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
export const InventoryItemModal: React.FC<{ isOpen: boolean; onClose: () => void; item: OperationalInventory | null; initialMaster?: OperationalInventoryMaster; locationId?: string }> = ({ isOpen, onClose, item, initialMaster, locationId }) => {
  const { profile, activeBranchId } = useAuth();
  const [masters, setMasters] = useState<OperationalInventoryMaster[]>([]);
  const [linkExisting, setLinkExisting] = useState(false);
  const [masterSearch, setMasterSearch] = useState('');
  const [saving, setSaving] = useState(false);
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
    setMasterSearch('');
    setFormData({
      name: '', type: 'non-fixed', category: '', unitPerPack: 1, costPerPack: 0,
      unitOfIssue: '', supplier: '', quantityInStock: 0, uniqueId: '', description: '',
      condition: 'New', status: 'In Use', ...item
    });
    setSelectedMasterId(item?.masterItemId || initialMaster?.id || '');
    setLinkExisting(Boolean(item?.masterItemId || initialMaster));
    if (initialMaster) setFormData(current => ({ ...current, name: initialMaster.name, type: initialMaster.type, category: initialMaster.category || '', unitPerPack: initialMaster.unitPerPack, unitOfIssue: initialMaster.unitOfIssue, uniqueId: initialMaster.uniqueId, supplier: initialMaster.supplier || '', description: initialMaster.description || '', inventoryClass: 'OPERATIONAL', operationalType: initialMaster.operationalType, quantityInStock: 0, costPerPack: 0 }));
  }, [isOpen, item, initialMaster]);

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
    if (!profile?.tenantId || saving) return;

    try {
      setSaving(true);
      const branchId = locationId || activeBranchId || profile.branchId;
      if (!branchId) throw new Error('Select a branch or HQ location before registering the item.');
      const data = { 
        ...formData, 
        inventoryClass: 'OPERATIONAL' as const,
        operationalType: operationalTypeForLegacyType(formData.type || 'non-fixed'),
        tenantId: profile.tenantId, 
        branchId
      };

      // The master service generates the identity code atomically when a new master is registered.

      data.quantityInStock = validateOperationalOpeningStock(data.quantityInStock);
      if (!identityLocked && !operationalIssueUnit(data.unitOfIssue)) {
        throw new Error('Enter a named issue unit, such as piece, sheet or roll, rather than a number.');
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
      toast.error(error instanceof Error ? error.message : 'Failed to save item');
    } finally {
      setSaving(false);
    }
  };

  const nonFixedCategories = ['Stationery', 'Packaging', 'Cleaning & Hygiene', 'Kitchen & Canteen', 'Other'];
  const fixedCategories = ['Furniture & Fittings', 'IT Equipment', 'Office Equipment', 'Kitchen Equipment', 'Security Equipment', 'Medical Equipment', 'Other'];
  const identityLocked = Boolean((!item && linkExisting) || item?.masterItemId || (item && !item.masterItemId && linkExisting));
  const selectedMaster = masters.find(master => master.id === selectedMasterId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-3xl max-h-[calc(100dvh-2rem)] rounded-3xl shadow-2xl overflow-hidden flex flex-col text-zinc-900">
        <div className="px-5 sm:px-8 py-5 border-b border-zinc-200 shrink-0 flex justify-between items-center">
          <h2 className="text-xl font-black text-zinc-900 uppercase tracking-tight">{item ? 'Edit Item' : 'Add Item'}</h2><button type="button" onClick={onClose} disabled={saving} aria-label="Close item registration" className="p-2 text-zinc-700"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 sm:p-8 space-y-5 overflow-y-auto min-h-0">
          {(!item || !item.masterItemId) && (
            <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 space-y-3">
              <p className="text-xs font-black uppercase tracking-widest text-sky-900">Tenant-wide Operational item identity</p>
              <div className="flex flex-wrap gap-4 text-xs font-bold text-sky-900">
                <label className="flex items-center gap-2"><input type="radio" checked={!linkExisting} onChange={() => { setLinkExisting(false); setSelectedMasterId(''); }} />Register a new item</label>
                <label className="flex items-center gap-2"><input type="radio" checked={linkExisting} onChange={() => setLinkExisting(true)} />Link this location to an existing item</label>
              </div>
              {linkExisting && <label className="block text-sm font-semibold text-zinc-700">Search catalogue<input type="search" value={masterSearch} onChange={event => setMasterSearch(event.target.value)} placeholder="Item name, category or ID" className="mt-1 w-full rounded-xl border border-sky-200 bg-white px-3 py-2.5 text-sm text-zinc-900" /></label>}
              {linkExisting && (
                <select required value={selectedMasterId} onChange={event => selectMaster(event.target.value)} className="w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm">
                  <option value="">Select tenant Operational item</option>
                  {masters.filter(master => master.id === selectedMasterId || [master.name, master.category, master.uniqueId].some(value => String(value || '').toLowerCase().includes(masterSearch.toLowerCase()))).map(master => <option key={master.id} value={master.id}>{master.name} · {master.uniqueId} · {operationalIssueUnit(master.unitOfIssue) || 'Unit not specified'}</option>)}
                </select>
              )}
              {linkExisting && selectedMaster && <div className="text-sm text-zinc-900 space-y-1 break-words">
                <p className="font-semibold">{selectedMaster.name}</p>
                <p>{selectedMaster.uniqueId} · {selectedMaster.category || 'Uncategorised'}</p>
                <p>{selectedMaster.unitPerPack} issue units per pack · {operationalIssueUnit(selectedMaster.unitOfIssue) || 'Unit not specified'}</p>
                {selectedMaster.supplier && <p>Supplier: {selectedMaster.supplier}</p>}
              </div>}
              <p className="text-xs text-sky-700">Use the same item identity at HQ and branches. Each location keeps its own on-hand balance.</p>
            </div>
          )}
          {identityLocked && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">This location is linked to the tenant-wide item identity. Its name, subtype and issue unit are controlled by that shared identity.</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 space-y-1">
              <label className="text-sm font-semibold text-zinc-700">Item Name</label>
              <input required disabled={identityLocked} className="w-full px-4 py-2.5 text-sm text-zinc-900 bg-zinc-50 border border-zinc-200 rounded-xl outline-none disabled:bg-zinc-100 disabled:text-zinc-700" value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-zinc-700">Type</label>
              <select disabled={Boolean(item) || identityLocked} className="w-full px-4 py-2.5 text-sm text-zinc-900 bg-zinc-50 border border-zinc-200 rounded-xl outline-none disabled:bg-zinc-100 disabled:text-zinc-700" value={formData.type || 'non-fixed'} onChange={e => setFormData({...formData, type: e.target.value as any, category: ''})}>
                <option value="fixed">Fixed</option>
                <option value="non-fixed">Non-fixed</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-zinc-700">Category</label>
              <select required disabled={identityLocked} className="w-full px-4 py-2.5 text-sm text-zinc-900 bg-zinc-50 border border-zinc-200 rounded-xl outline-none disabled:bg-zinc-100 disabled:text-zinc-700" value={formData.category || ''} onChange={e => setFormData({...formData, category: e.target.value})}>
                <option value="">Select Category</option>
                {(formData.type === 'fixed' ? fixedCategories : nonFixedCategories).map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-zinc-700">Unit of Issue</label>
              <input required disabled={identityLocked} className="w-full px-4 py-2.5 text-sm text-zinc-900 bg-zinc-50 border border-zinc-200 rounded-xl outline-none disabled:bg-zinc-100 disabled:text-zinc-700" list="operational-issue-units" value={formData.unitOfIssue || ''} onChange={e => setFormData({...formData, unitOfIssue: e.target.value})} placeholder="e.g., piece, sheet, roll" />
              <datalist id="operational-issue-units">{['piece', 'sheet', 'roll', 'ream', 'bottle', 'bag', 'box', 'pack'].map(unit => <option key={unit} value={unit} />)}</datalist>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-zinc-700">Supplier</label>
              <input disabled={identityLocked} className="w-full px-4 py-2.5 text-sm text-zinc-900 bg-zinc-50 border border-zinc-200 rounded-xl outline-none disabled:bg-zinc-100 disabled:text-zinc-700" value={formData.supplier || ''} onChange={e => setFormData({...formData, supplier: e.target.value})} />
            </div>

            <div className="sm:col-span-2 space-y-1">
              <label className="text-sm font-semibold text-zinc-700">{item ? 'Stock on hand' : 'Opening stock at this location'}</label>
              <input aria-label="Opening stock" required disabled={Boolean(item)} type="number" min="0" step={formData.type === 'fixed' ? '1' : 'any'} onFocus={event => event.target.select()} className="w-full px-4 py-2.5 text-sm text-zinc-900 bg-zinc-50 border border-zinc-200 rounded-xl disabled:bg-zinc-100" value={formData.quantityInStock ?? 0} onChange={event => setFormData({ ...formData, quantityInStock: Number(event.target.value) })} />
              <p className="text-xs text-zinc-700">{item ? 'Stock changes are recorded through receipts, transfers, usage or an authorised stock adjustment.' : 'Leave at 0 when registering an item that has not been received. Enter only stock physically present at this location.'}</p>
            </div>
            {formData.type === 'fixed' ? (
              <>
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-sm font-semibold text-zinc-700">Description</label>
                  <textarea className="w-full px-4 py-2.5 text-sm text-zinc-900 bg-zinc-50 border border-zinc-200 rounded-xl outline-none resize-none h-20" value={formData.description || ''} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="Model, color, details..." />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-zinc-700">Purchase Date</label>
                  <input type="date" className="w-full px-4 py-2.5 text-sm text-zinc-900 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.purchaseDate || ''} onChange={e => setFormData({...formData, purchaseDate: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-zinc-700">Purchase Cost (UGX)</label>
                  <input required type="number" min="0" onFocus={event => event.target.select()} className="w-full px-4 py-2.5 text-sm text-zinc-900 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.cost ?? 0} onChange={e => setFormData({...formData, cost: Number(e.target.value)})} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-zinc-700">Condition</label>
                  <select className="w-full px-4 py-2.5 text-sm text-zinc-900 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.condition || 'New'} onChange={e => setFormData({...formData, condition: e.target.value as any})}>
                    <option value="New">New</option>
                    <option value="Used - Good">Used - Good</option>
                    <option value="Used - Fair">Used - Fair</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-zinc-700">Status</label>
                  <select className="w-full px-4 py-2.5 text-sm text-zinc-900 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.status || 'In Use'} onChange={e => setFormData({...formData, status: e.target.value as any})}>
                    <option value="In Use">In Use</option>
                    <option value="Under Repair">Under Repair</option>
                    <option value="Decommissioned">Decommissioned</option>
                    <option value="Disposed">Disposed</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-zinc-700">Warranty Expiry</label>
                  <input type="date" className="w-full px-4 py-2.5 text-sm text-zinc-900 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.warrantyExpiry || ''} onChange={e => setFormData({...formData, warrantyExpiry: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-zinc-700">Asset ID (Optional)</label>
                  <input readOnly className="w-full px-4 py-2.5 text-sm text-zinc-900 bg-zinc-100 border border-zinc-200 rounded-xl" value={formData.uniqueId || 'Generated automatically on registration'} />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-zinc-700">Units Per Pack</label>
                  <input required disabled={identityLocked} type="number" min="1" step="1" onFocus={event => event.target.select()} className="w-full px-4 py-2.5 text-sm text-zinc-900 bg-zinc-50 border border-zinc-200 rounded-xl outline-none disabled:bg-zinc-100 disabled:text-zinc-700" value={formData.unitPerPack ?? 1} onChange={e => setFormData({...formData, unitPerPack: Number(e.target.value)})} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-zinc-700">Cost Per Pack</label>
                  <input required type="number" min="0" onFocus={event => event.target.select()} className="w-full px-4 py-2.5 text-sm text-zinc-900 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.costPerPack ?? 0} onChange={e => setFormData({...formData, costPerPack: Number(e.target.value)})} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-zinc-700">Item ID (Optional)</label>
                  <input readOnly className="w-full px-4 py-2.5 text-sm text-zinc-900 bg-zinc-100 border border-zinc-200 rounded-xl" value={formData.uniqueId || 'Generated automatically on registration'} />
                </div>
              </>
            )}
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="px-6 py-2 border border-zinc-200 rounded-xl font-bold text-zinc-600 uppercase text-xs tracking-widest">Cancel</button>
            <button disabled={saving} type="submit" className="px-8 py-2 bg-zinc-900 text-white rounded-xl font-bold uppercase text-xs tracking-widest shadow-lg shadow-zinc-900/20">{saving ? 'Saving…' : 'Save Item'}</button>
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
        <form onSubmit={handleSubmit} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 sm:p-8 space-y-6">
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
    purpose: ''
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
        purpose: formData.purpose,
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
      <div className="flex max-h-[calc(100dvh-1rem)] w-full max-w-lg flex-col overflow-hidden rounded-[24px] bg-white text-zinc-900 shadow-2xl">
        <div className="px-8 py-6 border-b border-zinc-100">
          <h2 className="text-xl font-black text-zinc-900 uppercase tracking-tight">Log Usage</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Select Item</label>
              <select required className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.inventoryId} onChange={e => { setFormData({...formData, inventoryId: e.target.value}); setRequestId(''); }}>
                <option value="">Select Item</option>
                {inventory.filter(i => i.operationalType === 'CONSUMABLE_OPERATIONAL' || (!i.operationalType && i.type === 'non-fixed')).map(i => <option key={i.id} value={i.id}>{i.name} ({i.quantityInStock} {operationalIssueUnit(i.unitOfIssue) || 'units'} available)</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Amount Issued</label>
                <input required type="number" min="0.001" max={Number(inventory.find(item => item.id === formData.inventoryId)?.quantityInStock || 0)} step="any" className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.issuedAmount || ''} onChange={e => { setFormData({...formData, issuedAmount: Number(e.target.value)}); setRequestId(''); }} />
              </div>
              <label className="space-y-1 block"><span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Department</span><input required maxLength={120} className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.department} onChange={e => { setFormData({...formData, department: e.target.value}); setRequestId(''); }} /></label>
              <label className="space-y-1 block"><span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Recipient (optional)</span><input maxLength={120} className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.recipient} onChange={e => { setFormData({...formData, recipient: e.target.value}); setRequestId(''); }} /></label>
              <label className="space-y-1 block"><span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Purpose</span><input required maxLength={300} className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl outline-none" value={formData.purpose} onChange={e => { setFormData({...formData, purpose: e.target.value}); setRequestId(''); }} /></label>
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

/** Item identities are shared; balances remain in the selected location registry. */
export const OperationalMasterCatalogue: React.FC<{ locationId: string; items: OperationalInventory[] }> = ({ locationId, items }) => {
  const { profile, hasPermission } = useAuth();
  const [masters, setMasters] = useState<OperationalInventoryMaster[]>([]);
  const [selected, setSelected] = useState<OperationalInventoryMaster | null>(null);
  useEffect(() => {
    if (!profile?.tenantId) return;
    return firestoreService.subscribeToCollection<OperationalInventoryMaster>('operational_inventory_masters', profile.tenantId, setMasters);
  }, [profile?.tenantId]);
  const available = masters.filter(master => master.inventoryClass === 'OPERATIONAL' && !items.some(item => item.masterItemId === master.id));
  return <section className="rounded-3xl border border-zinc-200 bg-white text-zinc-900 p-5">
    <h3 className="font-black text-zinc-900">Item Catalogue</h3>
    <p className="mt-1 text-xs text-zinc-500">Register an existing item at this location.</p>
    <div className="mt-3 space-y-2">{available.map(master => <div key={master.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-100 py-2">
      <div className="min-w-0"><p className="text-sm font-semibold text-zinc-900 break-words">{master.name}</p><p className="mt-1 text-xs text-zinc-700 break-words">{master.uniqueId} · {master.category || 'Uncategorised'} · {operationalIssueUnit(master.unitOfIssue) || 'Unit not specified'}</p></div>
      <button disabled={!hasPermission('inventory', 'operate')} onClick={() => setSelected(master)} className="rounded-lg bg-sky-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{locationId === 'HQ' ? 'Register at HQ' : 'Register Here'}</button>
    </div>)}{available.length === 0 && <p className="text-xs text-zinc-500">No additional items in the catalogue.</p>}</div>
    {selected && <InventoryItemModal isOpen onClose={() => setSelected(null)} item={null} initialMaster={selected} locationId={locationId} />}
  </section>;
};
