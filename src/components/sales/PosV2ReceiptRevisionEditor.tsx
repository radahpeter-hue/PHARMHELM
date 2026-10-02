import React, { useMemo, useState } from 'react';
import { Minus, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import type { Sale, SaleItem } from '../../types';
import { assertRevisionReason } from '../../services/pos-v2/posSaleRevisionV2Policy';

export interface PosV2ReceiptRevisionDraft {
  items: SaleItem[];
  paymentMethod: string;
  context: string | null;
  patientId: string | null;
  institutionId: string | null;
  prescriberId: string | null;
  discountPercentage: number;
  reason: string;
  revisedTotal: number;
}

interface PosV2ReceiptRevisionEditorProps {
  sale: Sale;
  onCancel: () => void;
  onContinue: (draft: PosV2ReceiptRevisionDraft) => void;
  onRequestAddItem?: () => void;
}

const numberValue = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const cleanId = (value: unknown): string | null => {
  const text = String(value ?? '').trim();
  return text || null;
};

const lineKey = (item: SaleItem, index: number): string => {
  const explicit = String((item as any).lineId || '').trim();
  if (explicit) return explicit;
  return `${item.productId || 'item'}::${String((item as any).tierCode || 'BASE')}::${index}`;
};

const itemName = (item: SaleItem): string => String((item as any).productName || (item as any).name || item.productId || 'Item');
const itemQty = (item: SaleItem): number => Math.max(0, numberValue((item as any).quantity, 0));
const itemPrice = (item: SaleItem): number => Math.max(0, numberValue((item as any).actualUnitPrice ?? (item as any).unitPrice, 0));

export function calculatePosV2RevisionDraftTotal(items: SaleItem[], discountPercentage: number): number {
  const subtotal = items.reduce((sum, item) => sum + itemQty(item) * itemPrice(item), 0);
  const discount = Math.min(100, Math.max(0, numberValue(discountPercentage, 0)));
  return Math.max(0, subtotal * (1 - discount / 100));
}

export function buildInitialPosV2RevisionDraft(sale: Sale): PosV2ReceiptRevisionDraft {
  const items = (sale.items || []).map(item => ({ ...item }));
  const discountPercentage = numberValue(sale.discountPercentage, 0);
  return {
    items,
    paymentMethod: String(sale.paymentMethod || ''),
    context: cleanId((sale as any).context),
    patientId: cleanId((sale as any).patientId),
    institutionId: cleanId((sale as any).institutionId),
    prescriberId: cleanId((sale as any).prescriberId),
    discountPercentage,
    reason: '',
    revisedTotal: calculatePosV2RevisionDraftTotal(items, discountPercentage)
  };
}

export const PosV2ReceiptRevisionEditor: React.FC<PosV2ReceiptRevisionEditorProps> = ({
  sale,
  onCancel,
  onContinue,
  onRequestAddItem
}) => {
  const [draft, setDraft] = useState<PosV2ReceiptRevisionDraft>(() => buildInitialPosV2RevisionDraft(sale));
  const [validationError, setValidationError] = useState<string | null>(null);

  const updateItems = (items: SaleItem[]) => {
    setDraft(current => ({
      ...current,
      items,
      revisedTotal: calculatePosV2RevisionDraftTotal(items, current.discountPercentage)
    }));
    setValidationError(null);
  };

  const updateQuantity = (index: number, quantity: number) => {
    const next = draft.items.map((item, itemIndex) => itemIndex === index
      ? { ...item, quantity: Math.max(1, Math.floor(numberValue(quantity, 1))) }
      : item);
    updateItems(next);
  };

  const updateUnitPrice = (index: number, unitPrice: number) => {
    const nextPrice = Math.max(0, numberValue(unitPrice, 0));
    const next = draft.items.map((item, itemIndex) => itemIndex === index
      ? { ...item, unitPrice: nextPrice, actualUnitPrice: nextPrice }
      : item);
    updateItems(next);
  };

  const updateDiscount = (discountPercentage: number) => {
    const bounded = Math.min(100, Math.max(0, numberValue(discountPercentage, 0)));
    setDraft(current => ({
      ...current,
      discountPercentage: bounded,
      revisedTotal: calculatePosV2RevisionDraftTotal(current.items, bounded)
    }));
    setValidationError(null);
  };

  const originalTotal = useMemo(
    () => numberValue((sale as any).totalAmount ?? (sale as any).total, 0),
    [sale]
  );
  const delta = draft.revisedTotal - originalTotal;

  const continueToReview = () => {
    if (draft.items.length === 0) {
      setValidationError('A revised receipt must retain at least one item.');
      return;
    }
    try {
      const reason = assertRevisionReason(draft.reason);
      onContinue({ ...draft, reason });
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : 'A valid revision reason is required.');
    }
  };

  return (
    <div className="fixed inset-0 z-[125] bg-zinc-950/45 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-6xl max-h-[94vh] overflow-hidden rounded-3xl bg-white shadow-2xl flex flex-col">
        <div className="px-5 sm:px-7 py-5 border-b border-zinc-100 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-amber-700 mb-1">
              <RotateCcw className="w-4 h-4" />
              <span className="text-[10px] font-black uppercase tracking-[0.16em]">POS V2 Safe Revision</span>
            </div>
            <h2 className="text-xl font-black text-zinc-900">Revise Receipt {sale.receiptNumber}</h2>
            <p className="text-xs text-zinc-500 mt-1">The original receipt remains immutable. This draft will be reviewed before any reversal or replacement transaction is requested.</p>
          </div>
          <button type="button" onClick={onCancel} className="p-2 rounded-xl text-zinc-500 hover:bg-zinc-100" aria-label="Close revision editor">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 sm:p-7 grid grid-cols-1 lg:grid-cols-12 gap-7">
          <section className="lg:col-span-7 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-zinc-900">Receipt items</h3>
                <p className="text-[11px] text-zinc-500">Adjust quantity or price, remove a line, or add another product through the POS catalog.</p>
              </div>
              <button
                type="button"
                onClick={onRequestAddItem}
                disabled={!onRequestAddItem}
                className="px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white disabled:bg-zinc-100 disabled:text-zinc-400 flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> Add Product
              </button>
            </div>

            <div className="space-y-3">
              {draft.items.map((item, index) => (
                <div key={lineKey(item, index)} className="border border-zinc-200 rounded-2xl p-4 grid grid-cols-12 gap-3 items-center">
                  <div className="col-span-12 sm:col-span-5 min-w-0">
                    <p className="font-bold text-sm text-zinc-900 truncate">{itemName(item)}</p>
                    <p className="text-[10px] text-zinc-400 uppercase tracking-wider">{String((item as any).tierCode || (item as any).unitOfSell || 'Base unit')}</p>
                  </div>
                  <div className="col-span-6 sm:col-span-3">
                    <label className="text-[9px] uppercase font-black text-zinc-400">Quantity</label>
                    <div className="mt-1 flex items-center rounded-xl border border-zinc-200 overflow-hidden">
                      <button type="button" className="p-2" onClick={() => updateQuantity(index, itemQty(item) - 1)}><Minus className="w-3 h-3" /></button>
                      <input
                        value={itemQty(item)}
                        onChange={event => updateQuantity(index, Number(event.target.value))}
                        type="number"
                        min={1}
                        step={1}
                        className="w-full text-center text-xs font-bold outline-none"
                      />
                      <button type="button" className="p-2" onClick={() => updateQuantity(index, itemQty(item) + 1)}><Plus className="w-3 h-3" /></button>
                    </div>
                  </div>
                  <div className="col-span-5 sm:col-span-3">
                    <label className="text-[9px] uppercase font-black text-zinc-400">Unit price</label>
                    <input
                      value={itemPrice(item)}
                      onChange={event => updateUnitPrice(index, Number(event.target.value))}
                      type="number"
                      min={0}
                      className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-amber-200"
                    />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => updateItems(draft.items.filter((_, itemIndex) => itemIndex !== index))}
                      className="p-2 text-rose-500 hover:bg-rose-50 rounded-xl"
                      aria-label={`Remove ${itemName(item)}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="lg:col-span-5 space-y-5 lg:border-l lg:border-zinc-100 lg:pl-7">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="space-y-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">Payment method</span>
                <input value={draft.paymentMethod} onChange={event => setDraft(current => ({ ...current, paymentMethod: event.target.value }))} className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm" />
              </label>
              <label className="space-y-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">Context</span>
                <select value={draft.context || ''} onChange={event => setDraft(current => ({ ...current, context: cleanId(event.target.value) }))} className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm bg-white">
                  <option value="">Unspecified</option>
                  <option value="walk-in">Walk-in</option>
                  <option value="telepharmacy">Telepharmacy</option>
                  <option value="institutional">Institutional</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">Patient ID</span>
                <input value={draft.patientId || ''} onChange={event => setDraft(current => ({ ...current, patientId: cleanId(event.target.value) }))} className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm" />
              </label>
              <label className="space-y-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">Institution ID</span>
                <input value={draft.institutionId || ''} onChange={event => setDraft(current => ({ ...current, institutionId: cleanId(event.target.value) }))} className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm" />
              </label>
              <label className="space-y-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">Prescriber ID</span>
                <input value={draft.prescriberId || ''} onChange={event => setDraft(current => ({ ...current, prescriberId: cleanId(event.target.value) }))} className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm" />
              </label>
              <label className="space-y-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">Discount %</span>
                <input value={draft.discountPercentage} onChange={event => updateDiscount(Number(event.target.value))} type="number" min={0} max={100} className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm" />
              </label>
            </div>

            <label className="space-y-1.5 block">
              <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">Mandatory revision reason</span>
              <textarea
                value={draft.reason}
                onChange={event => { setDraft(current => ({ ...current, reason: event.target.value })); setValidationError(null); }}
                rows={4}
                placeholder="Explain why the completed receipt must be corrected..."
                className="w-full resize-none rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-200"
              />
            </label>

            <div className="rounded-2xl bg-zinc-50 border border-zinc-200 p-4 space-y-2">
              <div className="flex justify-between text-xs"><span className="text-zinc-500">Original total</span><strong>UGX {originalTotal.toLocaleString()}</strong></div>
              <div className="flex justify-between text-xs"><span className="text-zinc-500">Revised total</span><strong>UGX {draft.revisedTotal.toLocaleString()}</strong></div>
              <div className="flex justify-between text-xs border-t border-zinc-200 pt-2"><span className="text-zinc-500">Difference</span><strong className={delta > 0 ? 'text-emerald-700' : delta < 0 ? 'text-rose-700' : 'text-zinc-700'}>{delta > 0 ? '+' : ''}UGX {delta.toLocaleString()}</strong></div>
            </div>

            {validationError && <p className="text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{validationError}</p>}
          </section>
        </div>

        <div className="px-5 sm:px-7 py-4 border-t border-zinc-100 bg-zinc-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-[10px] text-zinc-500 max-w-xl">No stock, payment, Finance or receipt record is changed at this step. Continue opens the revision review checkpoint only.</p>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onCancel} className="px-4 py-2.5 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700">Cancel</button>
            <button type="button" onClick={continueToReview} className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-black">Continue to Review</button>
          </div>
        </div>
      </div>
    </div>
  );
};
