import React, { useState, useEffect } from 'react';
import { 
  AlertTriangle, 
  Plus, 
  History, 
  Filter,
  Download,
  Search,
  ArrowRight,
  Package,
  Trash2,
  RefreshCw,
  FileText,
  ShieldAlert,
  CheckCircle2,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';
import { Recall, QuarantineLogEntry } from '../../types';
import { toast } from 'sonner';
import { format } from 'date-fns';

export const Recalls = () => {
  const { user, profile, activeBranch, tenantId } = useAuth();
  const [recalls, setRecalls] = useState<Recall[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!tenantId || !activeBranch) return;

    const unsubscribe = firestoreService.subscribeToCollection<Recall>(
      'recalls',
      tenantId,
      (entries) => {
        setRecalls(entries.sort((a, b) => new Date(b.dateInitiated).getTime() - new Date(a.dateInitiated).getTime()));
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [tenantId, activeBranch]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<Recall>>({
    recallType: 'NDA / National Recall',
    recallClass: 'Class 1',
    source: '',
    productName: '',
    batchNumber: '',
    reason: '',
    costPerUnit: 0,
    totalCost: 0
  });

  const handleAddRecall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !activeBranch || !user) return;

    try {
      const newRecall: Omit<Recall, 'id'> = {
        tenantId,
        productId: 'manual-entry',
        recallId: `RCL-${Date.now().toString().slice(-6)}`,
        recallType: formData.recallType as any,
        recallClass: formData.recallClass as any,
        source: formData.source || '',
        productName: formData.productName || '',
        batchNumber: formData.batchNumber || '',
        quantityAffected: formData.quantityAffected || 0,
        reason: formData.reason || '',
        costPerUnit: formData.costPerUnit || 0,
        totalCost: (formData.costPerUnit || 0) * (formData.quantityAffected || 0),
        dateInitiated: format(new Date(), 'yyyy-MM-dd'),
        initiatedBy: profile?.name || user?.email || 'System',
        status: 'Pending',
        retentionUntil: format(new Date(new Date().setFullYear(new Date().getFullYear() + 1)), 'yyyy-MM-dd')
      };

      await firestoreService.addDocument('recalls', newRecall);
      toast.success('Recall initiated successfully');
      setIsModalOpen(false);
      setFormData({
        recallType: 'NDA / National Recall',
        recallClass: 'Class 1',
        source: '',
        productName: '',
        batchNumber: '',
        reason: '',
        costPerUnit: 0,
        totalCost: 0
      });
    } catch (error) {
      toast.error('Failed to initiate recall');
    }
  };

  const handleAcknowledge = async (recall: Recall) => {
    if (!tenantId || !activeBranch || !user) return;

    try {
      await firestoreService.updateDocument('recalls', recall.id, { 
        status: 'Acknowledged',
        acknowledgedBy: user.fullName,
        dateAcknowledged: format(new Date(), 'yyyy-MM-dd')
      });
      toast.success('Recall acknowledged');
    } catch (error) {
      toast.error('Failed to acknowledge recall');
    }
  };

  const handleQuarantine = async (recall: Recall) => {
    if (!tenantId || !activeBranch || !user) return;

    try {
      const quarantineEntry: Omit<QuarantineLogEntry, 'id'> = {
        tenantId,
        branchId: activeBranch.id,
        quarantineId: `QR-RECALL-${Date.now()}`,
        dateQuarantined: format(new Date(), 'yyyy-MM-dd'),
        productId: 'N/A', 
        productName: recall.productName,
        batchNumber: recall.batchNumber,
        quantity: recall.quantityAffected || 0,
        reason: 'Recall',
        notes: `Recall ID: ${recall.recallId}`,
        quarantinedBy: profile?.name || user?.email || 'System',
        currentLocation: 'Quarantine Area (Recall Bin)',
        status: 'Active (In Quarantine)'
      };

      await firestoreService.addDocument('quarantine_logs', quarantineEntry);
      
      // Feed to finance as an expense (wastage/recall loss)
      if (recall.totalCost && recall.totalCost > 0) {
        await firestoreService.addDocument('branch_expenses', {
          tenantId,
          branch_id: activeBranch.id,
          expense_date: format(new Date(), 'yyyy-MM-dd'),
          category: 'wastage',
          description: `Recall Loss: ${recall.productName} (Batch: ${recall.batchNumber})`,
          amount_ugx: recall.totalCost,
          payment_method: 'System Adjustment',
          logged_by: profile?.name || user?.email || 'System',
          status: 'Approved',
          created_at: new Date().toISOString()
        });
      }

      await firestoreService.updateDocument('recalls', recall.id, { status: 'Quarantined' });
      toast.success(`${recall.productName} moved to quarantine and cost logged to finance`);
    } catch (error) {
      toast.error('Failed to quarantine item');
    }
  };

  const filteredRecalls = recalls.filter(recall => 
    recall.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    recall.batchNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    recall.recallId.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by recall ID, product, or batch..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all"
          />
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium text-sm shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Initiate Recall
          </button>
          <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors border border-gray-200">
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900">Initiate Product Recall</h3>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>
              <form onSubmit={handleAddRecall} className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase">Recall Source</label>
                    <input 
                      required
                      type="text"
                      placeholder="e.g. NDA, Manufacturer, Internal"
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-red-500/20"
                      value={formData.source}
                      onChange={e => setFormData({...formData, source: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase">Recall Class</label>
                    <select 
                      required
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-red-500/20"
                      value={formData.recallClass}
                      onChange={e => setFormData({...formData, recallClass: e.target.value as any})}
                    >
                      <option value="Class 1">Class 1 (Critical)</option>
                      <option value="Class 2">Class 2 (Major)</option>
                      <option value="Class 3">Class 3 (Minor)</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase">Product Name</label>
                    <input 
                      required
                      type="text"
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-red-500/20"
                      value={formData.productName}
                      onChange={e => setFormData({...formData, productName: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase">Batch Number</label>
                    <input 
                      required
                      type="text"
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-red-500/20"
                      value={formData.batchNumber}
                      onChange={e => setFormData({...formData, batchNumber: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase">Quantity Affected</label>
                    <input 
                      required
                      type="number"
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-red-500/20"
                      value={formData.quantityAffected || ''}
                      onChange={e => setFormData({...formData, quantityAffected: parseInt(e.target.value) || 0})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase">Cost Per Unit (UGX)</label>
                    <input 
                      required
                      type="number"
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-red-500/20"
                      value={formData.costPerUnit || ''}
                      onChange={e => setFormData({...formData, costPerUnit: parseInt(e.target.value) || 0})}
                    />
                  </div>
                  <div className="md:col-span-2 space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase">Reason for Recall</label>
                    <textarea 
                      required
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-red-500/20 min-h-[80px]"
                      value={formData.reason}
                      onChange={e => setFormData({...formData, reason: e.target.value})}
                    />
                  </div>
                </div>

                <div className="p-4 bg-red-50 rounded-xl border border-red-100 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-black text-red-700 uppercase tracking-widest">Estimated Total Loss</p>
                    <p className="text-xl font-black text-red-900">
                      UGX {((formData.costPerUnit || 0) * (formData.quantityAffected || 0)).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-black text-red-700 uppercase tracking-widest">Retention Policy</p>
                    <p className="text-xs font-bold text-red-900">1 Year (Mandatory)</p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 px-4 py-2 border border-gray-200 text-gray-600 rounded-xl font-bold hover:bg-gray-50 transition-colors text-sm"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors text-sm shadow-md shadow-red-200"
                  >
                    Initiate Recall
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
        <div className="p-2 bg-red-100 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-red-600" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-red-900">Active Product Recalls</h4>
          <p className="text-xs text-red-700 mt-1">
            Immediate action is required for all Class 1 and Class 2 recalls. 
            Acknowledge receipt and move affected stock to the quarantine area immediately.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {filteredRecalls.map((recall) => (
          <div 
            key={recall.id} 
            className={`bg-white rounded-xl border p-5 shadow-sm transition-all ${
              recall.status === 'Pending' ? 'border-red-200 bg-red-50/30' : 'border-gray-200'
            }`}
          >
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
              <div className="flex-1 space-y-3">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${
                    recall.recallClass === 'Class 1' ? 'bg-red-600 text-white' :
                    recall.recallClass === 'Class 2' ? 'bg-amber-500 text-white' :
                    'bg-blue-500 text-white'
                  }`}>
                    {recall.recallClass}
                  </span>
                  <span className="text-xs font-mono text-gray-500">{recall.recallId}</span>
                  <span className="text-xs text-gray-400">•</span>
                  <span className="text-xs text-gray-500">Issued: {recall.dateIssued}</span>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-gray-900">{recall.productName}</h3>
                  <p className="text-sm text-gray-600 mt-1">{recall.description}</p>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <div className="flex items-center gap-1.5 text-gray-500">
                    <Package className="w-4 h-4" />
                    <span className="font-medium text-gray-700">Batch: {recall.batchNumber}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-gray-500">
                    <FileText className="w-4 h-4" />
                    <span className="font-medium text-gray-700">Source: {recall.source}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row md:flex-col gap-2 min-w-[160px]">
                {recall.status === 'Pending' ? (
                  <>
                    <button
                      onClick={() => handleAcknowledge(recall)}
                      className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm"
                    >
                      Acknowledge
                    </button>
                    <button
                      onClick={() => handleQuarantine(recall)}
                      className="w-full px-4 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors text-sm font-medium"
                    >
                      Move to Quarantine
                    </button>
                  </>
                ) : recall.status === 'Acknowledged' ? (
                  <button
                    onClick={() => handleQuarantine(recall)}
                    className="w-full px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-sm font-medium shadow-sm"
                  >
                    Move to Quarantine
                  </button>
                ) : (
                  <div className="flex items-center justify-center gap-2 p-3 bg-green-50 text-green-700 rounded-lg border border-green-100">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-sm font-bold">Quarantined</span>
                  </div>
                )}
                
                {recall.acknowledgedBy && (
                  <div className="text-[10px] text-gray-400 text-center mt-1">
                    Ack by: {recall.acknowledgedBy}
                    <br />
                    on {recall.dateAcknowledged}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        {filteredRecalls.length === 0 && (
          <div className="p-12 text-center bg-gray-50 rounded-xl border border-dashed border-gray-300">
            <CheckCircle2 className="w-8 h-8 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-500">No active recalls found for this branch.</p>
          </div>
        )}
      </div>
    </div>
  );
};
