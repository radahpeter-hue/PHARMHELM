import React, { useEffect, useMemo, useState } from 'react';
import { Search, ArrowDownToLine, ArrowUpFromLine, History, Package, X, ShoppingCart } from 'lucide-react';
import { format } from 'date-fns';
import { where } from 'firebase/firestore';
import { Branch, OperationalInventory, OperationalInventoryMovement, OperationalTransfer, OperationalTransferLine } from '../../types';
import { firestoreService } from '../../services/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { useOperationalInventoryFeature } from '../../hooks/useOperationalInventoryFeature';
import { postOperationalStoreMovement } from '../../services/operationalInventoryMovementService';
import { createHqOperationalDistribution, receiveOperationalBranchReturn } from '../../services/operationalTransferService';
import { submitOperationalHqBufferOrder } from '../../services/operationalHqBufferOrderService';
import { toast } from 'sonner';

const OperationalHQStoreTab: React.FC = () => {
  const { profile, hasPermission } = useAuth();
  const enabled = useOperationalInventoryFeature();
  const canManage = hasPermission('inventory', 'operate') || hasPermission('procurement', 'operate');
  const canDistribute = hasPermission('procurement', 'operate');
  const [items, setItems] = useState<OperationalInventory[]>([]);
  const [movements, setMovements] = useState<OperationalInventoryMovement[]>([]);
  const [query, setQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedItem, setSelectedItem] = useState<OperationalInventory | null>(null);
  const [distributionItem, setDistributionItem] = useState<OperationalInventory | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [destinationBranchId, setDestinationBranchId] = useState('');
  const [distributionQuantity, setDistributionQuantity] = useState('');
  const [distributionRequestId, setDistributionRequestId] = useState('');
  const [distributionSaving, setDistributionSaving] = useState(false);
  const [bufferItemId, setBufferItemId] = useState('');
  const [bufferQuantity, setBufferQuantity] = useState('');
  const [bufferSaving, setBufferSaving] = useState(false);
  const [bufferRequestId, setBufferRequestId] = useState(createMovementKey);

  useEffect(() => {
    if (!profile?.tenantId || !enabled) {
      setItems([]);
      setMovements([]);
      return;
    }
    const stopItems = firestoreService.subscribeToCollectionByQuery<OperationalInventory>(
      'operational_inventory', profile.tenantId, [where('branchId', '==', 'HQ')],
      rows => setItems(rows.filter(item => item.branchId === 'HQ'))
    );
    const stopMovements = firestoreService.subscribeToCollectionByQuery<OperationalInventoryMovement>(
      'operational_inventory_movements', profile.tenantId, [where('branchId', '==', 'HQ')],
      rows => setMovements(rows.filter(movement => movement.locationId === 'HQ_OPERATIONAL'))
    );
    const stopBranches = firestoreService.subscribeToCollection<Branch>('branches', profile.tenantId, rows => setBranches(rows.filter(branch => branch.status === 'Active')));
    return () => {
      stopItems();
      stopMovements();
      stopBranches();
    };
  }, [profile?.tenantId, enabled]);

  const visibleItems = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items
      .filter(item => !term || [item.name, item.sku, item.uniqueId, item.category].some(value => String(value || '').toLowerCase().includes(term)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, query]);

  const latestMovements = useMemo(() => [...movements].filter(movement => {
    const raw = movement.createdAt?.toDate ? movement.createdAt.toDate() : new Date(movement.createdAt || 0);
    if (Number.isNaN(raw.getTime())) return false;
    const day = raw.toISOString().slice(0, 10);
    return (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo);
  }).sort((a, b) => {
    const dateValue = (value: any) => value?.toDate ? value.toDate().getTime() : new Date(value || 0).getTime();
    return dateValue(b.createdAt) - dateValue(a.createdAt);
  }).slice(0, 100), [movements, dateFrom, dateTo]);

  const submitDistribution = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile?.tenantId || !profile.uid || !distributionItem || !canDistribute) return;
    const branch = branches.find(row => row.id === destinationBranchId);
    if (!branch) { toast.error('Select a destination branch.'); return; }
    setDistributionSaving(true);
    try {
      const result = await createHqOperationalDistribution({
        tenantId: profile.tenantId, destinationBranchId: branch.id, destinationBranchName: branch.name,
        itemId: distributionItem.id, quantity: Number(distributionQuantity), requestId: distributionRequestId,
        actor: { uid: profile.uid, name: profile.displayName || profile.full_name || profile.name || profile.uid }
      });
      toast.success(`Operational transfer ${result.transferNumber} dispatched. The branch must confirm receipt.`);
      setDistributionItem(null); setDestinationBranchId(''); setDistributionQuantity('');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not create Operational transfer.'); }
    finally { setDistributionSaving(false); }
  };

  const submitBufferOrder = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile?.tenantId || !profile.uid || !canDistribute) return;
    const item = items.find(row => row.id === bufferItemId);
    const quantity = Number(bufferQuantity);
    if (!item?.masterItemId || !Number.isFinite(quantity) || quantity <= 0) {
      toast.error('Choose a linked Operational item and enter a positive quantity.');
      return;
    }
    setBufferSaving(true);
    try {
      const result = await submitOperationalHqBufferOrder({
        tenantId: profile.tenantId,
        itemId: item.id,
        quantityPacks: quantity,
        requestId: bufferRequestId,
        actor: { uid: profile.uid, name: profile.displayName || profile.full_name || profile.name || profile.uid }
      });
      toast.success(result.alreadySubmitted ? 'Operational HQ buffer order was already submitted.' : 'Operational HQ buffer order sent to Procurement.');
      setBufferItemId(''); setBufferQuantity('');
      setBufferRequestId(createMovementKey());
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not submit Operational buffer order.'); }
    finally { setBufferSaving(false); }
  };

  if (!enabled) return null;

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-sky-100 bg-sky-50 p-5 flex items-start gap-3">
        <Package className="text-sky-700 mt-0.5" size={20} />
        <div>
          <h2 className="font-black text-sky-950">Operational HQ Store</h2>
          <p className="text-xs text-sky-800 mt-1">Separate from the Sellable HQ Store. Every balance adjustment writes an immutable Operational stock movement and updates the item balance atomically.</p>
        </div>
      </div>

      <OperationalBranchReturnsQueue />

      <section className="rounded-3xl border border-sky-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3 mb-4"><ShoppingCart className="text-sky-700 mt-0.5" size={19} /><div><h3 className="font-black text-zinc-900">Order Operational buffer stock</h3><p className="text-xs text-zinc-500 mt-1">Creates an Operational-only HQ requisition for Procurement. Enter packs to order. Fixed assets are acquired through their asset workflow.</p></div></div>
        <form onSubmit={submitBufferOrder} className="grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-3">
          <select required value={bufferItemId} onChange={event => setBufferItemId(event.target.value)} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm"><option value="">Select an HQ Operational consumable</option>{items.filter(item => item.masterItemId && item.operationalType === 'CONSUMABLE_OPERATIONAL').map(item => <option key={item.id} value={item.id}>{item.name} · {item.uniqueId || item.id}</option>)}</select>
          <input aria-label="Buffer order quantity in packs" type="number" min="0.001" step="any" required value={bufferQuantity} onChange={event => setBufferQuantity(event.target.value)} placeholder="Packs to order" className="rounded-xl border border-zinc-200 px-3 py-2 text-sm" />
          <button disabled={!canDistribute || bufferSaving} className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{bufferSaving ? 'Submitting…' : 'Send to Procurement'}</button>
        </form>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <section className="xl:col-span-3 bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-zinc-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-black text-zinc-900">Operational stock on hand</h3>
              <p className="text-xs text-zinc-500 mt-1">{visibleItems.length} Operational items at HQ</p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search Operational items" className="w-full pl-9 pr-3 py-2 rounded-xl border border-zinc-200 bg-zinc-50 text-sm outline-none focus:ring-2 focus:ring-sky-500/20" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-zinc-50 text-[10px] text-zinc-500 uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3">Item</th>
                  <th className="px-5 py-3">Subtype</th>
                  <th className="px-5 py-3">Supplier</th>
                  <th className="px-5 py-3 text-right">On hand</th>
                  <th className="px-5 py-3 text-right">Unit cost</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {visibleItems.map(item => (
                  <tr key={item.id} className="hover:bg-zinc-50">
                    <td className="px-5 py-4">
                      <p className="font-bold text-sm text-zinc-900">{item.name}</p>
                      <p className="text-[10px] text-zinc-500">{item.uniqueId || item.sku || item.id}</p>
                    </td>
                    <td className="px-5 py-4 text-xs text-zinc-600">{item.operationalType || (item.type === 'fixed' ? 'FIXED_ASSET' : 'CONSUMABLE_OPERATIONAL')}</td>
                    <td className="px-5 py-4 text-xs text-zinc-600">{item.supplier || '—'}</td>
                    <td className="px-5 py-4 text-right font-black text-zinc-900">{Number(item.quantityInStock || 0).toLocaleString()} <span className="text-[10px] text-zinc-500 font-medium">{item.unitOfIssue}</span></td>
                    <td className="px-5 py-4 text-right text-xs text-zinc-600">UGX {(Number(item.costPerPack || 0) / Math.max(1, Number(item.unitPerPack || 1))).toLocaleString()}</td>
                    <td className="px-5 py-4 text-right">
                      <div className="inline-flex gap-1"><button onClick={() => setSelectedItem(item)} disabled={!canManage || !item.masterItemId} title={!item.masterItemId ? 'Link this legacy item in Inventory first' : undefined} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-900 text-white disabled:bg-zinc-200 disabled:text-zinc-500">{item.masterItemId ? 'Adjust' : 'Link in Inventory'}</button><button onClick={() => { setDistributionItem(item); setDistributionQuantity(''); setDistributionRequestId(globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`); }} disabled={!canDistribute || !item.masterItemId || Number(item.quantityInStock || 0) <= 0} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-sky-200 text-sky-800 disabled:opacity-40">Transfer</button></div>
                    </td>
                  </tr>
                ))}
                {visibleItems.length === 0 && <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-zinc-400">No Operational Inventory items are registered at HQ yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="xl:col-span-2 bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-zinc-100 space-y-3">
            <div className="flex items-center gap-2"><History size={17} className="text-sky-700" /><h3 className="font-black text-zinc-900">Operational Stock Card</h3></div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] font-bold text-zinc-500">From<input aria-label="Stock card from date" type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs text-zinc-700" /></label>
              <label className="text-[10px] font-bold text-zinc-500">To<input aria-label="Stock card to date" type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs text-zinc-700" /></label>
            </div>
          </div>
          <div className="max-h-[560px] overflow-y-auto divide-y divide-zinc-100">
            {latestMovements.map(movement => {
              const item = items.find(row => row.id === movement.itemId);
              const timestamp = movement.createdAt?.toDate ? movement.createdAt.toDate() : new Date(movement.createdAt);
              return (
                <article key={movement.id} className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-sm text-zinc-900">{movement.itemName || item?.name || 'Operational item'}</p>
                    <span className="px-2 py-1 rounded-md bg-sky-50 text-sky-700 text-[9px] font-black uppercase">{movement.movementType.replace(/_/g, ' ')}</span>
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-1">{Number.isNaN(timestamp.getTime()) ? 'Date unavailable' : format(timestamp, 'dd MMM yyyy, HH:mm')} · {movement.reference}</p>
                  <p className="text-xs mt-2 text-zinc-700"><strong>{movement.balanceBefore}</strong> → <strong>{movement.balanceAfter}</strong> <span className={movement.quantityDelta < 0 ? 'text-rose-600' : 'text-emerald-600'}>({movement.quantityDelta > 0 ? '+' : ''}{movement.quantityDelta})</span></p>
                  <p className="text-[10px] text-zinc-500 mt-1">UGX {Number(movement.totalValueUGX || 0).toLocaleString()} · Unit cost UGX {Number(movement.unitCostUGX || 0).toLocaleString()}</p>
                  {movement.reason && <p className="text-[10px] text-zinc-500 mt-1">{movement.reason}</p>}
                </article>
              );
            })}
            {latestMovements.length === 0 && <div className="p-8 text-center text-sm text-zinc-400">Operational stock movements will appear here.</div>}
          </div>
        </section>
      </div>

      {selectedItem && <StockAdjustmentModal item={selectedItem} onClose={() => setSelectedItem(null)} />}
      {distributionItem && <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"><form onSubmit={submitDistribution} className="bg-white w-full max-w-md rounded-3xl shadow-xl p-6 space-y-4"><div className="flex justify-between"><div><p className="text-[10px] font-black uppercase text-sky-700">Operational HQ Store</p><h3 className="text-xl font-black mt-1">Transfer to branch</h3><p className="text-xs text-zinc-500">{distributionItem.name}</p></div><button type="button" onClick={() => setDistributionItem(null)} className="p-2 rounded-lg hover:bg-zinc-100"><X size={16} /></button></div><label className="block text-xs font-bold text-zinc-600">Destination branch<select required value={destinationBranchId} onChange={event => setDestinationBranchId(event.target.value)} className="mt-1 w-full border rounded-xl px-3 py-2 text-sm"><option value="">Select branch</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label className="block text-xs font-bold text-zinc-600">Quantity ({distributionItem.unitOfIssue})<input type="number" min="0.001" max={Number(distributionItem.quantityInStock || 0)} step="any" required value={distributionQuantity} onChange={event => setDistributionQuantity(event.target.value)} className="mt-1 w-full border rounded-xl px-3 py-2 text-sm" /></label><div className="flex gap-3"><button type="button" onClick={() => setDistributionItem(null)} className="flex-1 py-2 rounded-xl bg-zinc-100 text-sm font-bold">Cancel</button><button disabled={distributionSaving} className="flex-1 py-2 rounded-xl bg-sky-700 text-white text-sm font-bold disabled:opacity-50">{distributionSaving ? 'Dispatching…' : 'Create & dispatch'}</button></div></form></div>}
    </div>
  );
};

const OperationalBranchReturnsQueue: React.FC = () => {
  const { profile, hasPermission } = useAuth();
  const enabled = useOperationalInventoryFeature();
  const canReceive = hasPermission('procurement', 'operate');
  const [returns, setReturns] = useState<OperationalTransfer[]>([]);
  const [busyId, setBusyId] = useState('');
  useEffect(() => {
    if (!enabled || !profile?.tenantId || !canReceive) { setReturns([]); return; }
    return firestoreService.subscribeToCollection<OperationalTransfer>('operational_transfers', profile.tenantId, rows => setReturns(rows.filter(row => row.inventoryClass === 'OPERATIONAL' && row.transferType === 'BRANCH_RETURN' && row.destinationBranchId === 'HQ' && row.status === 'dispatched')));
  }, [enabled, profile?.tenantId, canReceive]);
  const receive = async (transfer: OperationalTransfer) => {
    if (!profile?.tenantId || !profile.uid || !canReceive) return;
    setBusyId(transfer.id);
    try {
      const lines = await firestoreService.getDocumentsByQuery<OperationalTransferLine>('operational_transfer_lines', [
        { field: 'tenantId', operator: '==', value: profile.tenantId }, { field: 'transferId', operator: '==', value: transfer.id }
      ]);
      if (lines.length !== 1) throw new Error('Return must contain exactly one verified Operational line.');
      await receiveOperationalBranchReturn({ tenantId: profile.tenantId, transferId: transfer.id, line: lines[0], actor: { uid: profile.uid, name: profile.displayName || profile.full_name || profile.name || profile.uid } });
      toast.success(`${transfer.transferNumber} received into HQ Operational Store.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not receive Operational return.'); }
    finally { setBusyId(''); }
  };
  return <section className="rounded-2xl border border-amber-200 bg-white overflow-hidden"><div className="p-4 bg-amber-50 border-b border-amber-100"><h3 className="font-black text-amber-950">Operational Returns Awaiting HQ Receipt</h3><p className="text-xs text-amber-800 mt-1">Branch stock was reduced at dispatch. HQ stock increases only after receipt confirmation.</p></div><div className="divide-y divide-zinc-100">{returns.map(row => <div key={row.id} className="p-4 flex items-center justify-between gap-3"><div><p className="font-bold text-sm">{row.transferNumber} · {row.sourceBranchId}</p><p className="text-xs text-zinc-500">{row.returnReason || 'Operational return'} · {row.status}</p></div><button onClick={() => void receive(row)} disabled={!canReceive || Boolean(busyId)} className="px-3 py-2 rounded-lg bg-amber-700 text-white text-xs font-bold disabled:opacity-50">{busyId === row.id ? 'Receiving…' : 'Confirm HQ receipt'}</button></div>)}{returns.length === 0 && <p className="p-5 text-sm text-center text-zinc-400">No Operational returns are awaiting HQ receipt.</p>}</div></section>;
};

function createMovementKey() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

const StockAdjustmentModal: React.FC<{ item: OperationalInventory; onClose: () => void }> = ({ item, onClose }) => {
  const { profile } = useAuth();
  const [quantity, setQuantity] = useState('');
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [idempotencyKey] = useState(createMovementKey);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile?.tenantId || !profile.uid) return;
    const amount = Number(quantity);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a positive quantity.');
      return;
    }
    if (!reason.trim() || !reference.trim()) {
      toast.error('A reason and reference are required.');
      return;
    }
    setSaving(true);
    try {
      await postOperationalStoreMovement({
        tenantId: profile.tenantId,
        itemId: item.id,
        quantityDelta: direction === 'in' ? amount : -amount,
        movementType: 'ADJUSTMENT',
        reference: reference.trim(),
        reason: reason.trim(),
        idempotencyKey,
        actorId: profile.uid,
        actorName: profile.displayName || profile.full_name || profile.name
      });
      toast.success('Operational HQ Store balance adjusted.');
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to adjust Operational HQ stock.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="bg-white w-full max-w-md rounded-3xl shadow-xl p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div><p className="text-[10px] font-black uppercase tracking-wider text-sky-700">Operational HQ Store</p><h3 className="font-black text-xl text-zinc-900 mt-1">Adjust stock</h3><p className="text-xs text-zinc-500 mt-1">{item.name}</p></div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-100"><X size={16} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className={`p-3 rounded-xl border cursor-pointer ${direction === 'in' ? 'border-emerald-400 bg-emerald-50' : 'border-zinc-200'}`}><input type="radio" name="direction" checked={direction === 'in'} onChange={() => setDirection('in')} className="mr-2" /><ArrowDownToLine className="inline" size={14} /> Add</label>
          <label className={`p-3 rounded-xl border cursor-pointer ${direction === 'out' ? 'border-rose-400 bg-rose-50' : 'border-zinc-200'}`}><input type="radio" name="direction" checked={direction === 'out'} onChange={() => setDirection('out')} className="mr-2" /><ArrowUpFromLine className="inline" size={14} /> Remove</label>
        </div>
        <label className="block text-xs font-bold text-zinc-600">Quantity
          <input type="number" min="0.001" step="any" value={quantity} onChange={event => setQuantity(event.target.value)} required className="mt-1 w-full border border-zinc-200 rounded-xl px-3 py-2 text-sm" />
        </label>
        <label className="block text-xs font-bold text-zinc-600">Reason
          <input value={reason} onChange={event => setReason(event.target.value)} required maxLength={300} className="mt-1 w-full border border-zinc-200 rounded-xl px-3 py-2 text-sm" placeholder="Count correction, damage, opening receipt..." />
        </label>
        <label className="block text-xs font-bold text-zinc-600">Reference
          <input value={reference} onChange={event => setReference(event.target.value)} required maxLength={120} className="mt-1 w-full border border-zinc-200 rounded-xl px-3 py-2 text-sm" placeholder="Document or adjustment reference" />
        </label>
        <div className="flex gap-3 pt-2"><button type="button" onClick={onClose} disabled={saving} className="flex-1 py-2 rounded-xl bg-zinc-100 font-bold text-sm">Cancel</button><button disabled={saving} className="flex-1 py-2 rounded-xl bg-zinc-900 text-white font-bold text-sm disabled:opacity-50">{saving ? 'Saving...' : 'Post adjustment'}</button></div>
      </form>
    </div>
  );
};

export default OperationalHQStoreTab;
