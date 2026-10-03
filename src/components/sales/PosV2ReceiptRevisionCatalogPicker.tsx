import React, { useMemo, useState } from 'react';
import { PackagePlus, Search, X } from 'lucide-react';
import type { Product, ProductBatch, SaleItem, SystemSettings } from '../../types';
import {
  buildPosV2RevisionCatalogLine,
  getPosV2RevisionCatalogOptions
} from '../../services/pos-v2/posSaleRevisionV2Catalog';

interface PosV2ReceiptRevisionCatalogPickerProps {
  products: Product[];
  batches: ProductBatch[];
  systemSettings?: SystemSettings | null;
  tenantId: string;
  branchId: string;
  existingItems: SaleItem[];
  onAddLine: (item: SaleItem) => void;
  onClose: () => void;
}

const productLabel = (product: Product): string =>
  String(product.name || product.genericName || product.id || 'Unnamed product');

export const PosV2ReceiptRevisionCatalogPicker: React.FC<PosV2ReceiptRevisionCatalogPickerProps> = ({
  products,
  batches,
  systemSettings,
  tenantId,
  branchId,
  existingItems,
  onAddLine,
  onClose
}) => {
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const visibleProducts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products
      .filter(product => {
        if (!needle) return true;
        return [product.name, product.genericName, product.id]
          .some(value => String(value || '').toLowerCase().includes(needle));
      })
      .slice(0, 30);
  }, [products, search]);

  const addProduct = (product: Product, requestedTierCode?: any) => {
    try {
      const line = buildPosV2RevisionCatalogLine({
        product,
        batches,
        systemSettings,
        tenantId,
        branchId,
        existingItems,
        requestedTierCode
      });
      onAddLine(line);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to add this product to the revision draft.');
    }
  };

  return (
    <div className="fixed inset-0 z-[135] bg-zinc-950/45 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-3xl max-h-[88vh] overflow-hidden rounded-3xl bg-white shadow-2xl flex flex-col">
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-emerald-700">
              <PackagePlus className="w-4 h-4" />
              <span className="text-[10px] font-black uppercase tracking-[0.16em]">Revision Product Catalog</span>
            </div>
            <p className="text-xs text-zinc-500 mt-1">Products are added using the same live selling-tier and branch-stock rules as POS.</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl text-zinc-500 hover:bg-zinc-100" aria-label="Close product catalog">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 border-b border-zinc-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              autoFocus
              value={search}
              onChange={event => { setSearch(event.target.value); setError(null); }}
              placeholder="Search product or generic name..."
              className="w-full rounded-xl border border-zinc-200 pl-9 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-200"
            />
          </div>
          {error && <p className="mt-2 text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{error}</p>}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {visibleProducts.length === 0 ? (
            <div className="py-12 text-center text-sm text-zinc-400">No matching products found.</div>
          ) : visibleProducts.map(product => {
            const options = getPosV2RevisionCatalogOptions(product, systemSettings);
            return (
              <div key={product.id} className="rounded-2xl border border-zinc-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-sm text-zinc-900 truncate">{productLabel(product)}</p>
                  <p className="text-[10px] text-zinc-400 truncate">{product.genericName || 'No generic name recorded'}</p>
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  {options.map(option => (
                    <button
                      key={option.code}
                      type="button"
                      onClick={() => addProduct(product, option.code)}
                      className="px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-bold hover:bg-emerald-100"
                      title={`${option.label} × ${option.multiplier}${option.configuredPrice ? ` · UGX ${option.configuredPrice.toLocaleString()}` : ''}`}
                    >
                      {option.label}{option.isDefault ? ' · Default' : ''}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-zinc-100 bg-zinc-50 text-[10px] text-zinc-500">
          This picker only modifies the local revision draft. Final FEFO allocation and all transaction checks remain with POS V2 checkout.
        </div>
      </div>
    </div>
  );
};
