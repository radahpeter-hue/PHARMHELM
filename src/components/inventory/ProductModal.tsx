import React, { useState, useEffect } from 'react';
import { Plus, X } from 'lucide-react';
import { Product, SystemSettings } from '../../types';
import type { SellingTierCode } from '../../types/sellingTier';
import { getMultiTierEligibility, getTierMultiplier } from '../../services/sellingTierService';
import { applyLegacySellingTierMirror, normaliseSellingTiers, SELLING_TIER_CODES, SELLING_TIER_LABELS, validateSellingTierConfiguration } from '../../services/sellingTierConfigurationService';
import { 
  PRODUCT_CATEGORIES, 
  DOSAGE_FORMS, 
  ROUTES_OF_ADMINISTRATION, 
  PRESCRIPTION_CATEGORIES, 
  VOLUME_WEIGHT_UNITS 
} from '../../constants';
import { firestoreService } from '../../services/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'sonner';

interface ProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  product?: Product | null;
  systemSettings?: SystemSettings | null;
}

const ProductModal: React.FC<ProductModalProps> = ({ isOpen, onClose, product, systemSettings }) => {
  const { profile } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<Partial<Product>>({
    name: '',
    category: 'drug/medicine',
    costPricePerPack: 0,
    sellingPricePerUnit: 0,
    vatClassification: 'Zero-Rated',
    vatPercentage: 0,
    status: 'active',
    unitOfSell: 'unit',
    ...product,
    sellingTiers: normaliseSellingTiers(product),
    defaultSellingTierCode: product?.defaultSellingTierCode
  });

  useEffect(() => {
    setFormData({
      name: '',
      category: 'drug/medicine',
      costPricePerPack: 0,
      sellingPricePerUnit: 0,
      vatClassification: 'Zero-Rated',
      vatPercentage: 0,
      status: 'active',
      unitOfSell: 'unit',
      ...(product ? {
        ...product,
        name: product.name || '',
        category: product.category || 'drug/medicine',
        costPricePerPack: product.costPricePerPack || 0,
        sellingPricePerUnit: product.sellingPricePerUnit || 0,
        vatClassification: product.vatClassification || 'Standard Rated',
        vatPercentage: product.vatPercentage || 18,
        status: product.status || 'active',
        unitOfSell: product.unitOfSell || 'unit'
      } : {}),
      sellingTiers: normaliseSellingTiers(product),
      defaultSellingTierCode: product?.defaultSellingTierCode
    });
  }, [product, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.tenantId || isSaving) return;

    const tierDraft: Partial<Product> = {
      ...formData,
      sellingTiers: normaliseSellingTiers(formData)
    };
    const tierErrors = validateSellingTierConfiguration(tierDraft);
    if (tierErrors.length > 0) {
      toast.error(tierErrors[0]);
      return;
    }

    const packagingChanged = Boolean(product?.id) && (
      Number(product?.unitsPerStrip || 0) !== Number(formData.unitsPerStrip || 0) ||
      Number(product?.unitsPerPack || 0) !== Number(formData.unitsPerPack || 0)
    );
    if (packagingChanged && Number(product?.stock || product?.quantityInStock || 0) > 0) {
      const acknowledged = window.confirm('Packaging multipliers are changing while this product has active stock. Existing historical sales will keep their stored tier snapshots, but future sales will use the new multipliers. Continue?');
      if (!acknowledged) return;
    }

    const mirroredDraft = applyLegacySellingTierMirror(tierDraft);
    setIsSaving(true);
    try {
      // Never send the synthetic document id or server-managed timestamps back
      // to Firestore. Existing products include these fields after subscription.
      const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...editableFields } = mirroredDraft as any;
      const productData = {
        ...editableFields,
        tenantId: profile.tenantId,
        productId: mirroredDraft.productId || `PRD-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        sku: mirroredDraft.sku || `SKU-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
      };

      if (product?.id) {
        await firestoreService.updateDocument('products', product.id, productData);
        toast.success('Product updated successfully');
      } else {
        await firestoreService.addDocument('products', productData);
        toast.success('Product registered successfully');
      }
    } catch (error) {
      console.error('Error saving product:', error);
      const message = error instanceof Error && error.message.includes('permissions')
        ? 'You do not have permission to save products. Ask an administrator to check your inventory role.'
        : 'Product was not saved. Please try again or contact support if the problem continues.';
      toast.error(message);
      setIsSaving(false);
      return;
    }
    setIsSaving(false);
    onClose();
  };

  const renderDrugFields = () => (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-emerald-50/30 rounded-2xl border border-emerald-100">
      <div className="space-y-1">
        <label className="text-[10px] font-black text-emerald-700 uppercase tracking-wider">Generic Name</label>
        <input
          type="text"
          className="w-full px-3 py-2 bg-white border border-emerald-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm"
          value={formData.genericName || ''}
          onChange={e => setFormData({ ...formData, genericName: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-black text-emerald-700 uppercase tracking-wider">Dosage Form</label>
        <select
          className="w-full px-3 py-2 bg-white border border-emerald-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm"
          value={formData.dosageForm || ''}
          onChange={e => setFormData({ ...formData, dosageForm: e.target.value })}
        >
          <option value="">Select Form</option>
          {DOSAGE_FORMS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-black text-emerald-700 uppercase tracking-wider">Strength</label>
        <input
          type="text"
          className="w-full px-3 py-2 bg-white border border-emerald-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm"
          value={formData.strength || ''}
          onChange={e => setFormData({ ...formData, strength: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-black text-emerald-700 uppercase tracking-wider">Route of Administration</label>
        <select
          className="w-full px-3 py-2 bg-white border border-emerald-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm"
          value={formData.routeOfAdministration || ''}
          onChange={e => setFormData({ ...formData, routeOfAdministration: e.target.value })}
        >
          <option value="">Select Route</option>
          {ROUTES_OF_ADMINISTRATION.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-black text-emerald-700 uppercase tracking-wider">Prescription Category</label>
        <select
          className="w-full px-3 py-2 bg-white border border-emerald-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm"
          value={formData.prescriptionCategory || ''}
          onChange={e => setFormData({ ...formData, prescriptionCategory: e.target.value as any })}
        >
          <option value="">Select Category</option>
          {PRESCRIPTION_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-black text-emerald-700 uppercase tracking-wider">NDA Registration Number</label>
        <input
          type="text"
          className="w-full px-3 py-2 bg-white border border-emerald-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm"
          value={formData.ndaRegistrationNumber || ''}
          onChange={e => setFormData({ ...formData, ndaRegistrationNumber: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-black text-emerald-700 uppercase tracking-wider">Units per Pack</label>
        <input
          type="number"
          className="w-full px-3 py-2 bg-white border border-emerald-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm"
          value={isNaN(formData.unitsPerPack as number) ? '' : formData.unitsPerPack || 0}
          onChange={e => setFormData({ ...formData, unitsPerPack: parseFloat(e.target.value) || 0 })}
        />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-black text-emerald-700 uppercase tracking-wider">Units per Strip</label>
        <input
          type="number"
          required={formData.unitOfSell === 'strip'}
          className="w-full px-3 py-2 bg-white border border-emerald-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm"
          value={isNaN(formData.unitsPerStrip as number) ? '' : formData.unitsPerStrip || 0}
          onChange={e => setFormData({ ...formData, unitsPerStrip: parseFloat(e.target.value) || 0 })}
        />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-black text-emerald-700 uppercase tracking-wider">Country of Manufacture</label>
        <input
          type="text"
          className="w-full px-3 py-2 bg-white border border-emerald-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm"
          value={formData.countryOfManufacture || ''}
          onChange={e => setFormData({ ...formData, countryOfManufacture: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-black text-emerald-700 uppercase tracking-wider">Volume (ml) - Syrups/Ampoules</label>
        <input
          type="number"
          step="any"
          placeholder="e.g. 100"
          className="w-full px-3 py-2 bg-white border border-emerald-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm font-semibold"
          value={isNaN(formData.volumeInMl as number) ? '' : formData.volumeInMl === undefined ? '' : formData.volumeInMl}
          onChange={e => setFormData({ ...formData, volumeInMl: e.target.value ? parseFloat(e.target.value) : undefined })}
        />
      </div>
    </div>
  );

  const renderCosmeticFields = () => (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-pink-50/30 rounded-2xl border border-pink-100">
      <div className="space-y-1">
        <label className="text-[10px] font-black text-pink-700 uppercase tracking-wider">Volume/Weight</label>
        <div className="flex gap-2">
          <input
            type="number"
            className="flex-1 px-3 py-2 bg-white border border-pink-200 rounded-xl focus:ring-2 focus:ring-pink-500/20 outline-none text-sm"
            value={isNaN(formData.volumeWeight as number) ? '' : formData.volumeWeight || 0}
            onChange={e => setFormData({ ...formData, volumeWeight: parseFloat(e.target.value) || 0 })}
          />
          <select
            className="w-24 px-2 py-2 bg-white border border-pink-200 rounded-xl focus:ring-2 focus:ring-pink-500/20 outline-none text-xs"
            value={formData.volumeWeightUnit || ''}
            onChange={e => setFormData({ ...formData, volumeWeightUnit: e.target.value as any })}
          >
            {VOLUME_WEIGHT_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-black text-pink-700 uppercase tracking-wider">Manufacturing Company</label>
        <input
          type="text"
          className="w-full px-3 py-2 bg-white border border-pink-200 rounded-xl focus:ring-2 focus:ring-pink-500/20 outline-none text-sm"
          value={formData.manufacturingCompany || ''}
          onChange={e => setFormData({ ...formData, manufacturingCompany: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-black text-pink-700 uppercase tracking-wider">Country of Manufacture</label>
        <input
          type="text"
          className="w-full px-3 py-2 bg-white border border-pink-200 rounded-xl focus:ring-2 focus:ring-pink-500/20 outline-none text-sm"
          value={formData.countryOfManufacture || ''}
          onChange={e => setFormData({ ...formData, countryOfManufacture: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-black text-pink-700 uppercase tracking-wider">Units per Pack</label>
        <input
          type="number"
          className="w-full px-3 py-2 bg-white border border-pink-200 rounded-xl focus:ring-2 focus:ring-pink-500/20 outline-none text-sm"
          value={isNaN(formData.unitsPerPack as number) ? '' : formData.unitsPerPack || 0}
          onChange={e => setFormData({ ...formData, unitsPerPack: parseFloat(e.target.value) || 0 })}
        />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-black text-pink-700 uppercase tracking-wider">Units per Strip</label>
        <input
          type="number"
          min="0"
          className="w-full px-3 py-2 bg-white border border-pink-200 rounded-xl focus:ring-2 focus:ring-pink-500/20 outline-none text-sm"
          value={isNaN(formData.unitsPerStrip as number) ? '' : formData.unitsPerStrip || 0}
          onChange={e => setFormData({ ...formData, unitsPerStrip: parseFloat(e.target.value) || 0 })}
        />
      </div>
    </div>
  );

  const renderConsumableFields = () => (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-blue-50/30 rounded-2xl border border-blue-100">
      <div className="space-y-1">
        <label className="text-[10px] font-black text-blue-700 uppercase tracking-wider">Manufacturer</label>
        <input
          type="text"
          className="w-full px-3 py-2 bg-white border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none text-sm"
          value={formData.manufacturer || ''}
          onChange={e => setFormData({ ...formData, manufacturer: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-black text-blue-700 uppercase tracking-wider">Country of Manufacture</label>
        <input
          type="text"
          className="w-full px-3 py-2 bg-white border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none text-sm"
          value={formData.countryOfManufacture || ''}
          onChange={e => setFormData({ ...formData, countryOfManufacture: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-black text-blue-700 uppercase tracking-wider">Units per Pack</label>
        <input
          type="number"
          className="w-full px-3 py-2 bg-white border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none text-sm"
          value={isNaN(formData.unitsPerPack as number) ? '' : formData.unitsPerPack || 0}
          onChange={e => setFormData({ ...formData, unitsPerPack: parseFloat(e.target.value) || 0 })}
        />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-black text-blue-700 uppercase tracking-wider">Units per Strip</label>
        <input
          type="number"
          min="0"
          className="w-full px-3 py-2 bg-white border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none text-sm"
          value={isNaN(formData.unitsPerStrip as number) ? '' : formData.unitsPerStrip || 0}
          onChange={e => setFormData({ ...formData, unitsPerStrip: parseFloat(e.target.value) || 0 })}
        />
      </div>
    </div>
  );

  const tierEligibility = getMultiTierEligibility(formData as Product);

  const updateTier = (code: SellingTierCode, patch: Partial<{ enabled: boolean; price: number }>) => {
    setFormData(current => {
      const tiers = normaliseSellingTiers(current);
      const nextTier = { ...tiers[code]!, ...patch };
      const nextDefault = patch.enabled === false && current.defaultSellingTierCode === code
        ? undefined
        : current.defaultSellingTierCode;
      return {
        ...current,
        sellingTiers: { ...tiers, [code]: nextTier },
        defaultSellingTierCode: nextDefault
      };
    });
  };

  const renderSellingTierConfiguration = () => {
    if (!tierEligibility.eligible) return null;
    const tiers = normaliseSellingTiers(formData);
    const featureEnabled = systemSettings?.features?.multiTierSellingEnabled === true;

    return (
      <div className="space-y-4 p-5 bg-emerald-50/40 border border-emerald-100 rounded-3xl">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <h3 className="text-xs font-black text-emerald-900 uppercase tracking-widest">Multi-tier Selling Configuration</h3>
            <p className="text-[10px] text-emerald-700 mt-1">Configure only the commercial tiers this product can actually be sold in. Prices are explicit and are never generated from another tier.</p>
          </div>
          <span className={featureEnabled ? 'px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider border bg-emerald-600 text-white border-emerald-600' : 'px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider border bg-white text-amber-700 border-amber-200'}>
            {featureEnabled ? 'POS feature active' : 'POS feature off'}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2">
          {SELLING_TIER_CODES.map(code => {
            const config = tiers[code]!;
            const multiplier = getTierMultiplier(formData as Product, code);
            const multiplierValid = code === 'unit' || Boolean(multiplier && multiplier > 0);
            return (
              <div key={code} className="grid grid-cols-12 items-center gap-3 bg-white border border-emerald-100 rounded-2xl px-4 py-3">
                <div className="col-span-12 sm:col-span-3 flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={config.enabled}
                    disabled={!multiplierValid}
                    onChange={e => updateTier(code, { enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <div>
                    <p className="text-xs font-black text-zinc-900">{SELLING_TIER_LABELS[code]}</p>
                    <p className="text-[9px] text-zinc-400">{code === 'unit' ? '1 base unit' : multiplierValid ? String(multiplier) + ' base units' : 'Packaging multiplier required'}</p>
                  </div>
                </div>
                <div className="col-span-8 sm:col-span-6">
                  <label className="text-[8px] font-black text-zinc-400 uppercase tracking-wider block mb-1">Selling price (UGX)</label>
                  <input
                    type="number"
                    min="0"
                    disabled={!config.enabled}
                    value={Number.isFinite(Number(config.price)) ? config.price : 0}
                    onChange={e => updateTier(code, { price: Number(e.target.value || 0) })}
                    className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-bold disabled:opacity-40"
                  />
                </div>
                <label className="col-span-4 sm:col-span-3 flex items-center justify-end gap-2 text-[9px] font-black uppercase text-zinc-500">
                  <input
                    type="radio"
                    name="default-selling-tier"
                    checked={formData.defaultSellingTierCode === code}
                    disabled={!config.enabled}
                    onChange={() => setFormData(current => ({ ...current, defaultSellingTierCode: code }))}
                  />
                  Default
                </label>
              </div>
            );
          })}
        </div>
        {!featureEnabled && (
          <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">You can preconfigure these tiers safely. POS continues using legacy behaviour until the tenant feature flag is explicitly enabled.</p>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-4xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-8 py-6 border-b border-zinc-100 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-zinc-900 uppercase tracking-tight">
              {product ? 'Edit Product' : 'Add New Product'}
            </h2>
            <p className="text-xs text-zinc-500 font-medium">Inventory Master Registry</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-full transition-colors">
            <X size={24} className="text-zinc-400" />
          </button>
        </div>

        <form id="product-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6 sm:space-y-8">
          {/* Core Details */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">Product Name (Brand) *</label>
              <input
                required
                type="text"
                className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                value={formData.name || ''}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">Category *</label>
              <select
                required
                className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                value={formData.category || 'drug/medicine'}
                onChange={e => {
                  const cat = e.target.value;
                  const isDrug = cat === 'drug/medicine';
                  setFormData({ 
                    ...formData, 
                    category: cat as any,
                    vatClassification: isDrug ? 'Zero-Rated' : formData.vatClassification || 'Standard Rated',
                    vatPercentage: isDrug ? 0 : (formData.vatClassification === 'Standard Rated' ? 18 : 0)
                  });
                }}
              >
                {PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">Unit of Sell *</label>
              <select
                required
                className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                value={formData.unitOfSell || 'unit'}
                onChange={e => setFormData({ ...formData, unitOfSell: e.target.value as any })}
              >
                <option value="unit">Per Unit</option>
                <option value="pack">Per Pack</option>
                {tierEligibility.eligible && (
                  <option value="strip">Per Strip</option>
                )}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">Status</label>
              <select
                className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                value={formData.status || 'active'}
                onChange={e => setFormData({ ...formData, status: e.target.value as any })}
              >
                <option value="active">Active</option>
                <option value="discontinued">Discontinued</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>

          {renderSellingTierConfiguration()}

          {/* Pricing & Tax */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 p-6 bg-zinc-50 rounded-3xl border border-zinc-100">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">Cost Price (Per Pack) *</label>
              <input
                required
                type="number"
                className="w-full px-4 py-2 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                value={isNaN(formData.costPricePerPack as number) ? '' : formData.costPricePerPack || 0}
                onChange={e => setFormData({ ...formData, costPricePerPack: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">Legacy Selling Price *</label>
              <input
                required
                type="number"
                className="w-full px-4 py-2 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                value={isNaN(formData.sellingPricePerUnit as number) ? '' : formData.sellingPricePerUnit || 0}
                onChange={e => setFormData({ ...formData, sellingPricePerUnit: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">VAT Classification *</label>
              <select
                required
                className="w-full px-4 py-2 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                value={formData.vatClassification || 'Standard Rated'}
                onChange={e => {
                  const vatClass = e.target.value as any;
                  setFormData({ 
                    ...formData, 
                    vatClassification: vatClass,
                    vatPercentage: vatClass === 'Standard Rated' ? 18 : 0
                  });
                }}
              >
                <option value="Standard Rated">Standard Rated</option>
                <option value="Zero-Rated">Zero-Rated</option>
                <option value="Exempt">Exempt</option>
              </select>
            </div>
            {formData.vatClassification === 'Standard Rated' && (
              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">VAT Percentage (%)</label>
                <input
                  type="number"
                  className="w-full px-4 py-2 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                  value={isNaN(formData.vatPercentage as number) ? '' : formData.vatPercentage || 18}
                  onChange={e => setFormData({ ...formData, vatPercentage: parseFloat(e.target.value) || 0 })}
                />
              </div>
            )}
          </div>

          {/* Category Specific Fields */}
          <div className="space-y-4">
            <h3 className="text-xs font-black text-zinc-900 uppercase tracking-widest">Category Specific Details</h3>
            {formData.category === 'drug/medicine' && renderDrugFields()}
            {formData.category === 'cosmetic' && renderCosmeticFields()}
            {formData.category === 'consumable' && renderConsumableFields()}
            {formData.category === 'device' && renderConsumableFields()}
            {formData.category === 'cosmetic therapeutics' && (
              <div className="space-y-4">
                {renderDrugFields()}
                {renderCosmeticFields()}
              </div>
            )}
          </div>
        </form>

        <div className="px-8 py-6 border-t border-zinc-100 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 border border-zinc-200 rounded-xl font-bold text-zinc-600 hover:bg-zinc-50 transition-colors uppercase text-xs tracking-widest"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="product-form"
            disabled={isSaving}
            className="px-8 py-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-bold transition-all shadow-lg shadow-zinc-900/20 uppercase text-xs tracking-widest disabled:opacity-60 disabled:cursor-wait"
          >
            {isSaving ? 'Saving…' : product ? 'Update Product' : 'Register Product'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductModal;
