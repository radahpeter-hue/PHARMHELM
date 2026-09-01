import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus, Send, X } from 'lucide-react';
import { collection, doc, getDocs, query, runTransaction, setDoc, where } from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';
import { hasAnyRole } from '../../utils/roles';
import { Branch, OpeningStockLine, OpeningStockSession, Product } from '../../types';

const now = () => new Date().toISOString();
const makeReference = () => `OPEN-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const money = (value: number) => new Intl.NumberFormat('en-UG').format(value || 0);

const statusLabel: Record<OpeningStockSession['status'], string> = {
  draft: 'Draft', submitted: 'Awaiting CEO approval', returned: 'Returned for correction', rejected: 'Rejected',
  ceo_approved: 'CEO approved', awaiting_receipt: 'Awaiting branch receipt', fully_accepted: 'Fully accepted',
  closed_with_queries: 'Closed with queries'
};

type DraftLine = OpeningStockLine;

export const OpeningStockTab: React.FC<{ branches: Branch[] }> = ({ branches }) => {
  const { profile, activeBranchId } = useAuth();
  const [sessions, setSessions] = useState<OpeningStockSession[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [editing, setEditing] = useState<OpeningStockSession | null>(null);
  const [receiving, setReceiving] = useState<OpeningStockSession | null>(null);
  const [busy, setBusy] = useState(false);

  const isCEO = hasAnyRole(profile, ['CEO', 'CEO / MD', 'owner']);
  const isProcurement = hasAnyRole(profile, ['Procurement Head', 'Procurement Officer', 'Procurement Manager']);
  const isBranchManager = hasAnyRole(profile, ['Branch Manager', 'branch manager', 'admin']);
  const canDraft = isProcurement || isBranchManager;

  useEffect(() => {
    if (!profile?.tenantId) return;
    const stopSessions = firestoreService.subscribeToCollection<OpeningStockSession>('opening_stock_sessions', profile.tenantId, data => {
      setSessions(data.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
    });
    const stopProducts = firestoreService.subscribeToCollection<Product>('products', profile.tenantId, setProducts);
    return () => { stopSessions(); stopProducts(); };
  }, [profile?.tenantId]);

  const visibleSessions = useMemo(() => {
    if (isCEO || isProcurement) return sessions;
    return sessions.filter(session => session.branchId === activeBranchId);
  }, [sessions, isCEO, isProcurement, activeBranchId]);

  const transition = async (session: OpeningStockSession, status: OpeningStockSession['status'], extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      await firestoreService.updateDocument('opening_stock_sessions', session.id, { status, updatedAt: now(), ...extra });
      toast.success(`Opening inventory moved to ${statusLabel[status]}.`);
    } catch (error: any) {
      toast.error(error?.message || 'The opening inventory action failed.');
    } finally { setBusy(false); }
  };

  const approve = async (session: OpeningStockSession) => transition(session, 'ceo_approved', {
    approvedBy: profile?.uid, approvedByName: profile?.full_name || profile?.displayName || profile?.email, approvedAt: now()
  });

  const release = async (session: OpeningStockSession) => transition(session, 'awaiting_receipt', {
    releasedBy: profile?.uid, releasedByName: profile?.full_name || profile?.displayName || profile?.email, releasedAt: now()
  });

  const receive = async (session: OpeningStockSession) => {
    if (!profile?.tenantId || !activeBranchId || activeBranchId !== session.branchId) {
      toast.error('Switch to the destination branch before receiving this opening inventory.');
      return;
    }
    setBusy(true);
    try {
      const prepared = await Promise.all(session.lines.map(async line => {
        const productRef = doc(db, 'products', line.productId);
        const batchQuery = query(collection(db, 'product_batches'),
          where('tenantId', '==', session.tenantId), where('branchId', '==', session.branchId),
          where('productId', '==', line.productId), where('batchNumber', '==', line.batchNumber));
        const batches = await getDocs(batchQuery);
        return { line, productRef, existingBatchRef: batches.empty ? null : batches.docs[0].ref };
      }));

      await runTransaction(db, async transaction => {
        const sessionRef = doc(db, 'opening_stock_sessions', session.id);
        const sessionSnap = await transaction.get(sessionRef);
        if (!sessionSnap.exists() || sessionSnap.data().status !== 'awaiting_receipt') throw new Error('This opening inventory is no longer awaiting receipt.');

        const snapshots = [] as Array<{ item: typeof prepared[number]; product: any; batch: any }>;
        for (const item of prepared) {
          const product = await transaction.get(item.productRef);
          if (!product.exists() || product.data().tenantId !== session.tenantId) throw new Error(`Product ${item.line.productName} is invalid.`);
          const batch = item.existingBatchRef ? await transaction.get(item.existingBatchRef) : null;
          snapshots.push({ item, product, batch });
        }

        let hasQueries = false;
        for (const [lineIndex, { item, product, batch }] of snapshots.entries()) {
          const line = item.line;
          const accepted = Math.max(0, Number(line.acceptedQuantity ?? line.quantity));
          const queried = line.quantity - accepted;
          if (accepted > line.quantity) throw new Error(`Accepted quantity exceeds approval for ${line.productName}.`);
          if (queried > 0 && !line.queryReason?.trim()) throw new Error(`Enter a query reason for ${line.productName}.`);
          if (queried > 0) hasQueries = true;
          if (accepted <= 0) continue;

          if (batch?.exists()) throw new Error(`Batch ${line.batchNumber} already exists for ${line.productName}. Opening stock cannot merge into an existing batch.`);
          const batchRef = doc(collection(db, 'product_batches'));
          transaction.set(batchRef, {
            tenantId: session.tenantId, branchId: session.branchId, productId: line.productId,
            batchNumber: line.batchNumber, expiryDate: line.expiryDate, quantity: accepted,
            purchasePrice: line.unitCost, sellingPrice: line.sellingPrice, batch_status: 'active',
            sourceType: 'opening_stock', openingStockSessionId: session.id, openingStockLineIndex: lineIndex,
            createdAt: now(), lastUpdated: now()
          });
          transaction.update(item.productRef, {
            quantityInStock: Number(product.data().quantityInStock || 0) + accepted, updatedAt: now()
          });
          const movementRef = doc(collection(db, 'inventory_movements'));
          transaction.set(movementRef, {
            tenantId: session.tenantId, branchId: session.branchId, productId: line.productId, batchId: batchRef.id,
            batchNumber: line.batchNumber, timestamp: now(), reference: session.reference,
            movementClass: 'opening_stock', class: 'opening_stock', type: 'in', amount: accepted,
            amountAttached: accepted * line.unitCost, initiator: profile.full_name || profile.displayName || profile.email,
            initiatorId: profile.uid, receiver: session.branchName, receiverId: session.branchId,
            openingStockSessionId: session.id, notes: 'Opening inventory accepted after CEO approval and Procurement release'
          });
        }

        const receiptResults = session.lines.map(line => ({
          lineId: line.id,
          acceptedQuantity: Math.max(0, Number(line.acceptedQuantity ?? line.quantity)),
          queriedQuantity: line.quantity - Math.max(0, Number(line.acceptedQuantity ?? line.quantity)),
          ...(line.queryReason?.trim() ? { queryReason: line.queryReason.trim() } : {})
        }));
        transaction.update(sessionRef, {
          status: hasQueries ? 'closed_with_queries' : 'fully_accepted', receiptResults,
          receivedBy: profile.uid, receivedByName: profile.full_name || profile.displayName || profile.email,
          receivedAt: now(), updatedAt: now()
        });
      });
      toast.success('Opening inventory received and accepted batches added to branch stock.');
      setReceiving(null);
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || 'Opening inventory receipt failed.');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex gap-3">
        <AlertTriangle className="text-amber-600 shrink-0" size={20} />
        <div><p className="font-bold text-amber-950">Controlled cutover inventory</p><p className="text-sm text-amber-800">Use only for stock physically owned before the branch began operating in PharmHelm. New purchases must use the normal GRN process.</p></div>
      </div>
      <div className="flex items-center justify-between">
        <div><h2 className="text-xl font-bold">Opening Inventory</h2><p className="text-sm text-zinc-500">CEO-approved opening batches released by Procurement and received by the destination branch.</p></div>
        {canDraft && <button onClick={() => setEditing({} as OpeningStockSession)} className="px-4 py-2 rounded-xl bg-zinc-900 text-white font-bold flex gap-2 items-center"><Plus size={17}/> New Draft</button>}
      </div>
      <div className="bg-white rounded-2xl border border-zinc-200 overflow-x-auto">
        <table className="w-full text-left text-sm min-w-[900px]"><thead className="bg-zinc-50 text-xs uppercase text-zinc-500"><tr><th className="p-4">Reference</th><th className="p-4">Branch</th><th className="p-4">Batches</th><th className="p-4">Value</th><th className="p-4">Status</th><th className="p-4 text-right">Action</th></tr></thead>
        <tbody className="divide-y divide-zinc-100">{visibleSessions.map(session => <tr key={session.id}><td className="p-4 font-bold">{session.reference}<div className="text-xs font-normal text-zinc-400">{session.effectiveDate}</div></td><td className="p-4">{session.branchName}</td><td className="p-4">{session.lines.length}</td><td className="p-4">UGX {money(session.totalValue)}</td><td className="p-4"><span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-bold">{statusLabel[session.status]}</span></td><td className="p-4"><div className="flex justify-end gap-2">
          {['draft','returned'].includes(session.status) && canDraft && <button onClick={() => setEditing(session)} className="px-3 py-2 border rounded-lg font-semibold">Edit</button>}
          {session.status === 'submitted' && isCEO && <><button disabled={busy} onClick={() => approve(session)} className="px-3 py-2 bg-emerald-600 text-white rounded-lg font-semibold">Approve</button><button disabled={busy} onClick={() => { const reason = prompt('Reason for returning this draft?'); if (reason) transition(session, 'returned', { rejectionReason: reason }); }} className="px-3 py-2 border border-red-200 text-red-600 rounded-lg font-semibold">Return</button></>}
          {session.status === 'ceo_approved' && isProcurement && <button disabled={busy} onClick={() => release(session)} className="px-3 py-2 bg-blue-600 text-white rounded-lg font-semibold flex gap-1 items-center"><Send size={15}/> Release</button>}
          {session.status === 'awaiting_receipt' && isBranchManager && session.branchId === activeBranchId && <button onClick={() => setReceiving({...session, lines: session.lines.map(line => ({...line, acceptedQuantity: line.quantity}))})} className="px-3 py-2 bg-emerald-600 text-white rounded-lg font-semibold">Receive</button>}
        </div></td></tr>)}
        {!visibleSessions.length && <tr><td colSpan={6} className="p-12 text-center text-zinc-400">No opening inventory records are available.</td></tr>}</tbody></table>
      </div>
      {editing && <OpeningStockEditor initial={editing.id ? editing : null} branches={branches} products={products} onClose={() => setEditing(null)} />}
      {receiving && <ReceiveOpeningStock session={receiving} setSession={setReceiving} busy={busy} onClose={() => setReceiving(null)} onReceive={() => receive(receiving)} />}
    </div>
  );
};

const OpeningStockEditor: React.FC<{ initial: OpeningStockSession | null; branches: Branch[]; products: Product[]; onClose: () => void }> = ({ initial, branches, products, onClose }) => {
  const { profile, activeBranchId } = useAuth();
  const [branchId, setBranchId] = useState(initial?.branchId || activeBranchId || '');
  const [effectiveDate, setEffectiveDate] = useState(initial?.effectiveDate || new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState(initial?.reason || 'Opening inventory at PharmHelm cutover');
  const [evidenceReference, setEvidenceReference] = useState(initial?.evidenceReference || '');
  const [lines, setLines] = useState<DraftLine[]>(initial?.lines || []);
  const [saving, setSaving] = useState(false);
  const branch = branches.find(item => item.id === branchId);

  const addLine = () => setLines(old => [...old, { id: crypto.randomUUID(), productId: '', productName: '', sku: '', batchNumber: '', expiryDate: '', quantity: 1, unitCost: 0, sellingPrice: 0 }]);
  const updateLine = (id: string, patch: Partial<DraftLine>) => setLines(old => old.map(line => line.id === id ? {...line, ...patch} : line));
  const totalValue = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitCost || 0), 0);

  const save = async (submit: boolean) => {
    if (!profile?.tenantId || !profile.uid || !branch) return toast.error('Select a valid destination branch.');
    if (!evidenceReference.trim()) return toast.error('Enter the supporting stock-count or valuation reference.');
    if (!lines.length) return toast.error('Add at least one opening-stock batch.');
    const invalid = lines.find(line => !line.productId || !line.batchNumber.trim() || !line.expiryDate || line.quantity <= 0 || line.unitCost < 0 || line.sellingPrice < 0);
    if (invalid) return toast.error('Every line requires a product, batch, expiry, positive quantity and valid prices.');
    const keys = lines.map(line => `${line.productId}|${line.batchNumber.trim().toLowerCase()}|${line.expiryDate}`);
    if (new Set(keys).size !== keys.length) return toast.error('The draft contains duplicate product batches.');
    if (lines.length > 300) return toast.error('A single opening-stock submission is limited to 300 batches.');
    setSaving(true);
    try {
      if (submit) {
        const existingStock = await getDocs(query(collection(db, 'product_batches'),
          where('tenantId', '==', profile.tenantId), where('branchId', '==', branchId)));
        if (!existingStock.empty) throw new Error('Opening inventory is available only before this branch has received normal stock.');
      }
      const payload = {
        tenantId: profile.tenantId, branchId, branchName: branch.name, reference: initial?.reference || makeReference(),
        effectiveDate, reason: reason.trim(), evidenceReference: evidenceReference.trim(), status: submit ? 'submitted' : 'draft',
        lines, totalQuantity: lines.reduce((sum, line) => sum + Number(line.quantity), 0), totalValue,
        createdBy: initial?.createdBy || profile.uid, createdByName: initial?.createdByName || profile.full_name || profile.displayName || profile.email || 'Staff User',
        createdAt: initial?.createdAt || now(), updatedAt: now(), ...(submit ? { submittedAt: now() } : {})
      };
      if (initial?.id) await firestoreService.updateDocument('opening_stock_sessions', initial.id, payload);
      else await setDoc(doc(db, 'opening_stock_sessions', `${profile.tenantId}_${branchId}`), payload);
      toast.success(submit ? 'Opening inventory submitted to the CEO.' : 'Opening inventory draft saved.');
      onClose();
    } catch (error: any) { toast.error(error?.message || 'Failed to save opening inventory.'); }
    finally { setSaving(false); }
  };

  return <div className="fixed inset-0 z-[70] bg-black/55 p-4 flex items-center justify-center"><div className="bg-white rounded-3xl w-full max-w-6xl max-h-[94vh] flex flex-col overflow-hidden"><div className="p-5 border-b flex justify-between"><div><h3 className="text-xl font-bold">{initial ? 'Edit' : 'Create'} Opening Inventory</h3><p className="text-sm text-zinc-500">Enter the physically verified batches present at cutover.</p></div><button onClick={onClose}><X/></button></div>
    <div className="p-5 overflow-auto space-y-5"><div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3"><label className="text-sm font-semibold">Destination branch<select disabled={Boolean(initial)} value={branchId} onChange={e => setBranchId(e.target.value)} className="mt-1 w-full border rounded-xl p-3 disabled:bg-zinc-100"><option value="">Select branch</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label className="text-sm font-semibold">Effective date<input type="date" value={effectiveDate} onChange={e=>setEffectiveDate(e.target.value)} className="mt-1 w-full border rounded-xl p-3"/></label><label className="text-sm font-semibold">Reason<input value={reason} onChange={e=>setReason(e.target.value)} className="mt-1 w-full border rounded-xl p-3"/></label><label className="text-sm font-semibold">Evidence reference<input value={evidenceReference} onChange={e=>setEvidenceReference(e.target.value)} placeholder="Signed count sheet/reference" className="mt-1 w-full border rounded-xl p-3"/></label></div>
    <div className="space-y-3">{lines.map((line, index) => <div key={line.id} className="grid md:grid-cols-2 lg:grid-cols-7 gap-2 border rounded-2xl p-3 bg-zinc-50"><select value={line.productId} onChange={e=>{const p=products.find(x=>x.id===e.target.value); updateLine(line.id,{productId:e.target.value,productName:p?.name||'',sku:p?.sku||'',sellingPrice:p?.sellingPricePerUnit||0});}} className="border rounded-lg p-2 lg:col-span-2"><option value="">Select product</option>{products.map(p=><option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}</select><input value={line.batchNumber} onChange={e=>updateLine(line.id,{batchNumber:e.target.value})} placeholder="Batch number" className="border rounded-lg p-2"/><input type="date" value={line.expiryDate} onChange={e=>updateLine(line.id,{expiryDate:e.target.value})} className="border rounded-lg p-2"/><input type="number" min="1" value={line.quantity} onChange={e=>updateLine(line.id,{quantity:Number(e.target.value)})} placeholder="Quantity" className="border rounded-lg p-2"/><input type="number" min="0" value={line.unitCost} onChange={e=>updateLine(line.id,{unitCost:Number(e.target.value)})} placeholder="Unit cost" className="border rounded-lg p-2"/><div className="flex gap-1"><input type="number" min="0" value={line.sellingPrice} onChange={e=>updateLine(line.id,{sellingPrice:Number(e.target.value)})} placeholder="Selling price" className="border rounded-lg p-2 w-full"/><button onClick={()=>setLines(old=>old.filter(x=>x.id!==line.id))} className="text-red-500 p-2"><X size={17}/></button></div><span className="text-xs text-zinc-400 lg:col-span-7">Line {index+1}: UGX {money(line.quantity*line.unitCost)}</span></div>)}<button onClick={addLine} className="border border-dashed rounded-xl p-3 w-full font-bold text-zinc-600 flex justify-center gap-2"><Plus size={17}/> Add Batch</button></div></div>
    <div className="p-5 border-t flex flex-wrap justify-between gap-3"><p className="font-bold">Total opening value: UGX {money(totalValue)}</p><div className="flex gap-2"><button disabled={saving} onClick={()=>save(false)} className="border rounded-xl px-4 py-2 font-bold">Save Draft</button><button disabled={saving} onClick={()=>save(true)} className="bg-zinc-900 text-white rounded-xl px-4 py-2 font-bold">Submit to CEO</button></div></div></div></div>;
};

const ReceiveOpeningStock: React.FC<{ session: OpeningStockSession; setSession: React.Dispatch<React.SetStateAction<OpeningStockSession | null>>; busy: boolean; onClose: () => void; onReceive: () => void }> = ({ session, setSession, busy, onClose, onReceive }) => {
  const update = (id: string, patch: Partial<OpeningStockLine>) => setSession(old => old ? {...old, lines: old.lines.map(line => line.id === id ? {...line,...patch} : line)} : old);
  return <div className="fixed inset-0 z-[70] bg-black/55 p-4 flex items-center justify-center"><div className="bg-white rounded-3xl w-full max-w-5xl max-h-[94vh] flex flex-col overflow-hidden"><div className="p-5 border-b flex justify-between"><div><h3 className="text-xl font-bold">Receive {session.reference}</h3><p className="text-sm text-zinc-500">You may accept the approved quantity or less. Any difference requires a query reason.</p></div><button onClick={onClose}><X/></button></div><div className="p-5 overflow-auto space-y-3">{session.lines.map(line => <div key={line.id} className="grid md:grid-cols-5 gap-3 border rounded-2xl p-4"><div className="md:col-span-2"><p className="font-bold">{line.productName}</p><p className="text-xs text-zinc-500">Batch {line.batchNumber} · Approved {line.quantity}</p></div><label className="text-xs font-bold">Accepted<input type="number" min="0" max={line.quantity} value={line.acceptedQuantity} onChange={e=>update(line.id,{acceptedQuantity:Math.min(line.quantity,Math.max(0,Number(e.target.value)))})} className="mt-1 border rounded-lg p-2 w-full"/></label><div className="text-sm pt-5">Queried: <b>{line.quantity-Number(line.acceptedQuantity||0)}</b></div><input disabled={Number(line.acceptedQuantity||0)===line.quantity} value={line.queryReason||''} onChange={e=>update(line.id,{queryReason:e.target.value})} placeholder="Query reason" className="border rounded-lg p-2 disabled:bg-zinc-100"/></div>)}</div><div className="p-5 border-t flex justify-end gap-2"><button onClick={onClose} className="border rounded-xl px-4 py-2 font-bold">Cancel</button><button disabled={busy} onClick={onReceive} className="bg-emerald-600 text-white rounded-xl px-4 py-2 font-bold flex gap-2 items-center"><CheckCircle2 size={17}/> Accept Opening Stock</button></div></div></div>;
};
