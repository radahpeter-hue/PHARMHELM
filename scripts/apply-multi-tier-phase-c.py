from pathlib import Path
import re

PRODUCT_MODAL = Path('src/components/inventory/ProductModal.tsx')
INVENTORY = Path('src/pages/Inventory.tsx')
SALES = Path('src/pages/Sales.tsx')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f'Phase C patch anchor not found: {label}')
    return text.replace(old, new, 1)


def replace_regex(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'Phase C regex anchor not found: {label}')
    return updated


product_modal = PRODUCT_MODAL.read_text()
inventory = INVENTORY.read_text()
sales = SALES.read_text()

if (
    'Multi-tier Selling Configuration' in product_modal
    and 'systemSettings={settings}' in inventory
    and 'buildTierCartItem' in sales
    and 'FEFO allocation will be finalised at checkout' in sales
):
    print('Phase C UI/cart patch is already applied.')
    raise SystemExit(0)

# ProductModal imports and props.
product_modal = replace_once(
    product_modal,
    "import { Product } from '../../types';",
    "import { Product, SystemSettings } from '../../types';\nimport type { SellingTierCode } from '../../types/sellingTier';\nimport { getMultiTierEligibility, getTierMultiplier } from '../../services/sellingTierService';\nimport { applyLegacySellingTierMirror, normaliseSellingTiers, SELLING_TIER_CODES, SELLING_TIER_LABELS, validateSellingTierConfiguration } from '../../services/sellingTierConfigurationService';",
    'ProductModal imports'
)
product_modal = replace_once(
    product_modal,
    "  product?: Product | null;\n}",
    "  product?: Product | null;\n  systemSettings?: SystemSettings | null;\n}",
    'ProductModal props'
)
product_modal = replace_once(
    product_modal,
    "const ProductModal: React.FC<ProductModalProps> = ({ isOpen, onClose, product }) => {",
    "const ProductModal: React.FC<ProductModalProps> = ({ isOpen, onClose, product, systemSettings }) => {",
    'ProductModal signature'
)
product_modal = replace_once(
    product_modal,
    "    status: 'active',\n    unitOfSell: 'unit',\n    ...product\n  });",
    "    status: 'active',\n    unitOfSell: 'unit',\n    ...product,\n    sellingTiers: normaliseSellingTiers(product),\n    defaultSellingTierCode: product?.defaultSellingTierCode\n  });",
    'ProductModal initial form data'
)
product_modal = replace_once(
    product_modal,
    "        status: product.status || 'active',\n        unitOfSell: product.unitOfSell || 'unit'\n      } : {})\n    });",
    "        status: product.status || 'active',\n        unitOfSell: product.unitOfSell || 'unit'\n      } : {}),\n      sellingTiers: normaliseSellingTiers(product),\n      defaultSellingTierCode: product?.defaultSellingTierCode\n    });",
    'ProductModal reset form data'
)
product_modal = replace_once(
    product_modal,
    "    if ((formData.dosageForm === 'Tablet' || formData.dosageForm === 'Capsule') && (!formData.unitsPerStrip || formData.unitsPerStrip <= 0)) {\n      toast.error('Units per strip is required for Tablets and Capsules');\n      return;\n    }\n\n    setIsSaving(true);",
    """    const tierDraft: Partial<Product> = {
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
    setIsSaving(true);""",
    'ProductModal validation'
)
product_modal = replace_once(
    product_modal,
    "      const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...editableFields } = formData as any;\n      const productData = {\n        ...editableFields,\n        tenantId: profile.tenantId,\n        productId: formData.productId || `PRD-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,\n        sku: formData.sku || `SKU-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,\n      };",
    "      const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...editableFields } = mirroredDraft as any;\n      const productData = {\n        ...editableFields,\n        tenantId: profile.tenantId,\n        productId: mirroredDraft.productId || `PRD-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,\n        sku: mirroredDraft.sku || `SKU-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,\n      };",
    'ProductModal save draft'
)

tier_renderer = """
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
"""
product_modal = replace_once(
    product_modal,
    '\n  return (\n    <div className="fixed inset-0',
    tier_renderer + '\n  return (\n    <div className="fixed inset-0',
    'ProductModal tier renderer'
)
product_modal = replace_once(
    product_modal,
    '<label className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">Selling Price (Per Unit) *</label>',
    '<label className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">Legacy Selling Price *</label>',
    'ProductModal legacy price label'
)
product_modal = replace_once(
    product_modal,
    '          {/* Pricing & Tax */}',
    '          {renderSellingTierConfiguration()}\n\n          {/* Pricing & Tax */}',
    'ProductModal tier panel placement'
)

# Inventory page.
inventory = replace_once(inventory, "import { Product, ProductBatch, InventoryMovement } from '../types';", "import { Product, ProductBatch, InventoryMovement, SystemSettings } from '../types';", 'Inventory types import')
inventory = replace_once(inventory, '  const [settings, setSettings] = useState<any>(null);', '  const [settings, setSettings] = useState<(SystemSettings & { id?: string }) | null>(null);', 'Inventory settings state')
inventory = inventory.replace(
    "              featureToggles: {\n                enableOperationalInventory: false,\n              },",
    "              featureToggles: {\n                enableOperationalInventory: false,\n              },\n              features: {\n                multiTierSellingEnabled: false,\n              },"
)
inventory = inventory.replace(
    "          featureToggles: {\n            enableOperationalInventory: newValue,\n          },",
    "          featureToggles: {\n            enableOperationalInventory: newValue,\n          },\n          features: {\n            multiTierSellingEnabled: false,\n          },"
)
inventory = replace_once(
    inventory,
    "                      const productStock = branchBatches\n                        .filter(b => b.productId === product.id)\n                        .reduce((acc, curr) => acc + (curr.quantity || 0), 0);\n                      \n                      return (",
    "                      const productStock = branchBatches\n                        .filter(b => b.productId === product.id)\n                        .reduce((acc, curr) => acc + (curr.quantity || 0), 0);\n                      const enabledTierEntries = (['unit', 'strip', 'pack'] as const)\n                        .filter(code => product.sellingTiers?.[code]?.enabled)\n                        .map(code => ({ code, price: Number(product.sellingTiers?.[code]?.price || 0) }));\n                      \n                      return (",
    'Inventory tier entries'
)
inventory = replace_once(inventory, '                                  {product.unitOfSell}\n                                </span>', "                                  {enabledTierEntries.length > 0 ? 'Multi-tier' : product.unitOfSell}\n                                </span>", 'Inventory multi-tier badge')
inventory = replace_once(inventory, '                                {product.unitOfSell}s\n                              </span>', "                                {product.baseUnit || product.unit || 'base units'}\n                              </span>", 'Inventory base unit stock label')
inventory = replace_once(
    inventory,
    """                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-zinc-900">Sell: {(product.sellingPricePerUnit || 0).toLocaleString()} UGX</span>
                            <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Cost: {(product.costPricePerPack || 0).toLocaleString()} /pack</span>
                          </div>""",
    """                          <div className="flex flex-col gap-0.5">
                            {enabledTierEntries.length > 0 ? enabledTierEntries.map(tier => (
                              <span key={tier.code} className="text-[10px] font-bold text-zinc-800 uppercase">{tier.code}: {tier.price.toLocaleString()} UGX</span>
                            )) : (
                              <span className="text-xs font-bold text-zinc-900">Sell: {(product.sellingPricePerUnit || 0).toLocaleString()} UGX</span>
                            )}
                            <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Cost: {(product.costPricePerPack || 0).toLocaleString()} /pack</span>
                          </div>""",
    'Inventory pricing display'
)
inventory = replace_once(inventory, '          product={editingProduct} \n        />', '          product={editingProduct}\n          systemSettings={settings}\n        />', 'Inventory ProductModal settings prop')

# Sales imports.
sales = replace_once(
    sales,
    "import { canOperatePos, formatPosCheckoutError } from '../utils/posAuthorization';",
    "import { canOperatePos, formatPosCheckoutError } from '../utils/posAuthorization';\nimport type { SellingTierCode } from '../types/sellingTier';\nimport { resolveSellingTiers } from '../services/sellingTierService';\nimport { buildTierCartItem, getCartLineIdentity, getProductUsableBaseStock, getReservedBaseQuantityForProduct, mergeTierCartItem, replaceTierCartPrice, replaceTierCartQuantity } from '../services/posTierCartService';",
    'Sales multi-tier imports'
)

new_add_to_cart = """  const addToCart = (item: Product | BillableService, requestedTierCode?: SellingTierCode) => {
    if (activeTab === 'products') {
      const product = item as Product;
      const resolution = resolveSellingTiers(product, systemSettings);

      if (resolution.mode === 'multi-tier') {
        if (!profile?.tenantId || !activeBranchId) {
          toast.error('Select an active branch before adding multi-tier stock.');
          return;
        }
        const tier = requestedTierCode
          ? resolution.tiers.find(candidate => candidate.code === requestedTierCode)
          : resolution.defaultTier;
        if (!tier) {
          toast.error('The selected selling tier is not available for this product.');
          return;
        }

        const usableBaseStock = getProductUsableBaseStock(batches, product.id);
        const reservedBaseStock = getReservedBaseQuantityForProduct(cart, product.id);
        if (reservedBaseStock + tier.multiplier > usableBaseStock) {
          toast.error(`Insufficient stock for one ${tier.label}. ${product.name} has ${usableBaseStock} usable base units available.`);
          return;
        }

        try {
          const incoming = buildTierCartItem({ product, tier, batches, tenantId: profile.tenantId, branchId: activeBranchId, commercialQuantity: 1 });
          setCart(current => mergeTierCartItem(current, incoming));
          toast.success(`${product.name} added as ${tier.label}`);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Unable to add this selling tier.');
        }
        return;
      }

      const multiplier = product.unitOfSell === 'pack' ? (product.unitsPerPack || 1) :
                        product.unitOfSell === 'strip' ? (product.unitsPerStrip || 1) : 1;
      const productBatches = batches
        .filter(b => b.productId === product.id && b.quantity >= multiplier && b.batch_status === 'active')
        .filter(b => isInventoryBatchUnexpired(b.expiryDate))
        .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
      if (productBatches.length === 0) {
        toast.error('No active/unexpired stock available for this product');
        return;
      }
      const bestBatch = productBatches[0];
      const existingItem = cart.find(i => !i.tierCode && i.productId === product.id && i.batchNumber === bestBatch.batchNumber);
      if (existingItem) {
        updateQuantity(product.id, getCartLineIdentity(existingItem), 1);
      } else {
        const unitPrice = bestBatch.sellingPrice * multiplier;
        setCart([{
          productId: product.id,
          productName: product.name,
          genericName: product.genericName,
          batchNumber: bestBatch.batchNumber,
          expiryDate: bestBatch.expiryDate,
          quantity: 1,
          unitPrice,
          costPrice: bestBatch.purchasePrice * multiplier,
          subtotal: unitPrice,
          isService: false
        }, ...cart]);
      }
      toast.success(`${item.name} added to cart`);
    } else {
      const service = item as BillableService;
      const existingItem = cart.find(i => i.productId === service.id && i.isService);
      if (existingItem) {
        setCart(cart.map(i => i.productId === service.id && i.isService
          ? { ...i, quantity: i.quantity + 1, subtotal: (i.quantity + 1) * i.unitPrice }
          : i
        ));
      } else {
        setCart([...cart, {
          productId: service.id,
          productName: service.name,
          batchNumber: 'N/A',
          expiryDate: 'N/A',
          quantity: 1,
          unitPrice: service.defaultFee,
          costPrice: 0,
          subtotal: service.defaultFee,
          isService: true
        }]);
      }
      toast.success(`${item.name} added to cart`);
    }
  };

  const changeBatch ="""
sales = replace_regex(sales, r"  const addToCart = \(item: Product \| BillableService\) => \{.*?\n  \};\n\n  const changeBatch =", new_add_to_cart, 'Sales addToCart')

new_update_quantity = """  const updateQuantity = (productId: string, lineIdentity: string, delta: number) => {
    const currentCartItem = cart.find(item => getCartLineIdentity(item) === lineIdentity);
    if (!currentCartItem) return;

    if (currentCartItem.tierCode) {
      const product = products.find(p => p.id === productId);
      if (!product) return;
      const currentQuantity = Number(currentCartItem.commercialQuantity ?? currentCartItem.quantity ?? 0);
      const newQuantity = Math.max(0, currentQuantity + delta);
      try {
        setCart(current => replaceTierCartQuantity({ cart: current, targetIdentity: lineIdentity, product, batches, commercialQuantity: newQuantity }));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Unable to change tier quantity.');
      }
      return;
    }

    const batchNumber = currentCartItem.batchNumber;
    const product = products.find(p => p.id === productId);
    const multiplier = product?.unitOfSell === 'pack' ? (product.unitsPerPack || 1) :
                      product?.unitOfSell === 'strip' ? (product.unitsPerStrip || 1) : 1;

    if (currentCartItem.isService) {
      setCart(cart.map(item => {
        if (getCartLineIdentity(item) === lineIdentity) {
          const newQty = Math.max(0, item.quantity + delta);
          return { ...item, quantity: newQty, subtotal: newQty * item.unitPrice };
        }
        return item;
      }));
      return;
    }

    const newQty = Math.max(0, currentCartItem.quantity + delta);
    const currentBatch = batches.find(b => b.productId === productId && b.batchNumber === batchNumber);
    if (!currentBatch) return;
    const currentBatchMaxQty = Math.floor(currentBatch.quantity / multiplier);

    if (newQty <= currentBatchMaxQty) {
      setCart(cart.map(item => getCartLineIdentity(item) === lineIdentity
        ? { ...item, quantity: newQty, subtotal: newQty * item.unitPrice }
        : item
      ));
    } else {
      const currentBatchQtyToSet = currentBatchMaxQty;
      const balanceQty = newQty - currentBatchQtyToSet;
      const otherBatches = batches
        .filter(b => b.productId === productId && b.batchNumber !== batchNumber && b.quantity >= multiplier && b.batch_status === 'active')
        .filter(b => isInventoryBatchUnexpired(b.expiryDate))
        .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());

      if (otherBatches.length === 0) {
        toast.error(`Insufficient stock! Only ${currentBatchMaxQty} available in this batch.`);
        setCart(cart.map(item => getCartLineIdentity(item) === lineIdentity
          ? { ...item, quantity: currentBatchMaxQty, subtotal: currentBatchMaxQty * item.unitPrice }
          : item
        ));
        return;
      }

      let remainingBalance = balanceQty;
      const additionalCartItems: SaleItem[] = [];
      for (const batch of otherBatches) {
        if (remainingBalance <= 0) break;
        const maxAvail = Math.floor(batch.quantity / multiplier);
        if (maxAvail <= 0) continue;
        const qtyToTake = Math.min(remainingBalance, maxAvail);
        remainingBalance -= qtyToTake;
        const unitPrice = batch.sellingPrice * multiplier;
        additionalCartItems.push({
          productId,
          productName: currentCartItem.productName,
          genericName: currentCartItem.genericName,
          batchNumber: batch.batchNumber,
          expiryDate: batch.expiryDate,
          quantity: qtyToTake,
          unitPrice,
          costPrice: batch.purchasePrice * multiplier,
          subtotal: qtyToTake * unitPrice,
          isService: false
        } as SaleItem);
      }
      if (remainingBalance > 0) toast.warning(`Insufficient total stock. Missing ${remainingBalance} commercial units.`);
      setCart(prevCart => {
        let nextCart = prevCart.map(item => getCartLineIdentity(item) === lineIdentity
          ? { ...item, quantity: currentBatchQtyToSet, subtotal: currentBatchQtyToSet * item.unitPrice }
          : item
        );
        for (const add of additionalCartItems) {
          const existingIdx = nextCart.findIndex(item => !item.tierCode && item.productId === productId && item.batchNumber === add.batchNumber);
          if (existingIdx != -1) {
            const existingItem = nextCart[existingIdx];
            const updatedQty = Math.min(existingItem.quantity + add.quantity, Math.floor((batches.find(b => b.productId === productId && b.batchNumber === add.batchNumber)?.quantity || 0) / multiplier));
            nextCart[existingIdx] = { ...existingItem, quantity: updatedQty, subtotal: updatedQty * existingItem.unitPrice };
          } else {
            nextCart = [add, ...nextCart];
          }
        }
        return nextCart;
      });
      toast.success('Quantity split across available batches');
    }
  };

  const updatePrice ="""
sales = replace_regex(sales, r"  const updateQuantity = \(productId: string, batchNumber: string, delta: number\) => \{.*?\n  \};\n\n  const updatePrice =", new_update_quantity, 'Sales updateQuantity')

sales = replace_regex(
    sales,
    r"  const updatePrice = \(productId: string, batchNumber: string, newPrice: number\) => \{.*?\n  \};\n\n  const removeFromCart = \(productId: string, batchNumber: string\) => \{.*?\n  \};",
    """  const updatePrice = (productId: string, lineIdentity: string, newPrice: number) => {
    const target = cart.find(item => getCartLineIdentity(item) === lineIdentity);
    if (!target) return;
    if (target.tierCode) {
      setCart(current => replaceTierCartPrice({ cart: current, targetIdentity: lineIdentity, actualUnitPrice: Math.max(0, newPrice) }));
      return;
    }
    setCart(cart.map(item => getCartLineIdentity(item) === lineIdentity
      ? { ...item, unitPrice: Math.max(0, newPrice), subtotal: item.quantity * Math.max(0, newPrice) }
      : item
    ));
  };

  const removeFromCart = (lineIdentity: string) => {
    setCart(cart.filter(item => getCartLineIdentity(item) !== lineIdentity));
  };""",
    'Sales updatePrice/remove'
)

sales = replace_once(
    sales,
    "    if (cart.length === 0) {\n      toast.error('Cart is empty');\n      return;\n    }",
    "    if (cart.length === 0) {\n      toast.error('Cart is empty');\n      return;\n    }\n\n    if (systemSettings?.features?.multiTierSellingEnabled === true && cart.some(item => !item.isService && item.tierCode)) {\n      toast.error('Multi-tier basket selection is ready, but checkout is blocked until transactional tier-level FEFO integration is completed. No stock has been deducted.');\n      return;\n    }",
    'Sales Phase D checkout guard'
)
sales = sales.replace('key={`${item.productId}-${item.batchNumber}-${index}`}', 'key={`${getCartLineIdentity(item)}-${index}`}')
sales = sales.replace('updateQuantity(item.productId, item.batchNumber,', 'updateQuantity(item.productId, getCartLineIdentity(item),')
sales = sales.replace('updatePrice(item.productId, item.batchNumber,', 'updatePrice(item.productId, getCartLineIdentity(item),')
sales = sales.replace('removeFromCart(item.productId, item.batchNumber)', 'removeFromCart(getCartLineIdentity(item))')

sales = replace_once(
    sales,
    """                              {item.isService && (
                                <span className="text-[7px] bg-blue-50 text-blue-600 border border-blue-150 px-1 rounded font-black uppercase">
                                  Service
                                </span>
                              )}""",
    """                              {item.isService && (
                                <span className="text-[7px] bg-blue-50 text-blue-600 border border-blue-150 px-1 rounded font-black uppercase">
                                  Service
                                </span>
                              )}
                              {item.tierCode && (
                                <span className="text-[7px] bg-emerald-50 text-emerald-700 border border-emerald-150 px-1 rounded font-black uppercase">
                                  {item.tierLabel || item.tierCode}
                                </span>
                              )}""",
    'Sales cart tier badge'
)

old_batch_block = """                            {/* Inner Batch Selection */}
                            {!item.isService && (
                              <div className="mt-0.5 flex items-center gap-1 text-[8px] text-zinc-400 font-bold">
                                <span>Batch:</span>
                                <select 
                                  className="p-0 bg-transparent border-none text-[8px] font-extrabold hover:text-emerald-600 focus:ring-0 cursor-pointer text-zinc-500 uppercase"
                                  value={item.batchNumber}
                                  onChange={(e) => changeBatch(item.productId, item.batchNumber, e.target.value)}
                                >
                                  {batches
                                    .filter(b => b.productId === item.productId && b.quantity > 0 && b.batch_status === 'active' && new Date(b.expiryDate) > new Date())
                                    .map(b => {
                                      const mult = product?.unitOfSell === 'pack' ? (product.unitsPerPack || 1) : 
                                                   product?.unitOfSell === 'strip' ? (product.unitsPerStrip || 1) : 1;
                                      const stockLeft = Math.floor(b.quantity / mult);
                                      return (
                                        <option key={b.batchNumber} value={b.batchNumber} className="text-zinc-800">
                                          {b.batchNumber} (EXP: {b.expiryDate}) • {stockLeft} LEFT
                                        </option>
                                      );
                                    })
                                  }
                                </select>
                              </div>
                            )}"""
new_batch_block = """                            {/* Batch semantics: tier lines stay commercial until transactional FEFO checkout. */}
                            {!item.isService && (
                              item.tierCode ? (
                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[8px] font-bold">
                                  <span className="text-emerald-700">{item.commercialQuantity || item.quantity} {item.tierLabel || item.tierCode}</span>
                                  <span className="text-zinc-300">•</span>
                                  <span className="text-zinc-500">{item.baseQuantity || 0} {product?.baseUnit || product?.unit || 'base units'}</span>
                                  <span className="text-zinc-300">•</span>
                                  <span className="text-amber-600">FEFO allocation will be finalised at checkout</span>
                                </div>
                              ) : (
                                <div className="mt-0.5 flex items-center gap-1 text-[8px] text-zinc-400 font-bold">
                                  <span>Batch:</span>
                                  <select 
                                    className="p-0 bg-transparent border-none text-[8px] font-extrabold hover:text-emerald-600 focus:ring-0 cursor-pointer text-zinc-500 uppercase"
                                    value={item.batchNumber}
                                    onChange={(e) => changeBatch(item.productId, item.batchNumber, e.target.value)}
                                  >
                                    {batches
                                      .filter(b => b.productId === item.productId && b.quantity > 0 && b.batch_status === 'active' && isInventoryBatchUnexpired(b.expiryDate))
                                      .map(b => {
                                        const mult = product?.unitOfSell === 'pack' ? (product.unitsPerPack || 1) : product?.unitOfSell === 'strip' ? (product.unitsPerStrip || 1) : 1;
                                        const stockLeft = Math.floor(b.quantity / mult);
                                        return (
                                          <option key={b.batchNumber} value={b.batchNumber} className="text-zinc-800">
                                            {b.batchNumber} (EXP: {b.expiryDate}) • {stockLeft} LEFT
                                          </option>
                                        );
                                      })}
                                  </select>
                                </div>
                              )
                            )}"""
sales = replace_once(sales, old_batch_block, new_batch_block, 'Sales cart batch block')

catalog_map = """                  {filteredItems.map(item => {
                    const isProduct = activeTab === 'products';
                    const product = isProduct ? item as Product : null;
                    const service = !isProduct ? item as BillableService : null;
                    const productBatches = isProduct ? batches.filter(b => b.productId === product?.id && b.quantity > 0 && b.batch_status === 'active' && isInventoryBatchUnexpired(b.expiryDate)) : [];
                    const totalBaseStock = isProduct && product ? getProductUsableBaseStock(batches, product.id) : 0;
                    const resolution = isProduct && product ? resolveSellingTiers(product, systemSettings) : null;
                    const isMultiTier = resolution?.mode === 'multi-tier';
                    const defaultTier = isMultiTier ? resolution.defaultTier : null;
                    const legacyMultiplier = product?.unitOfSell === 'pack' ? (product.unitsPerPack || 1) : product?.unitOfSell === 'strip' ? (product.unitsPerStrip || 1) : 1;
                    const displayMultiplier = defaultTier?.multiplier || legacyMultiplier;
                    const price = isProduct ? (defaultTier?.configuredPrice ?? productBatches[0]?.sellingPrice ?? product?.sellingPricePerUnit ?? 0) : (service?.defaultFee || 0);
                    const defaultHasStock = !isProduct || totalBaseStock >= Math.max(1, displayMultiplier);

                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (!isProduct) addToCart(item);
                          else if (defaultHasStock) addToCart(item, defaultTier?.code);
                        }}
                        onKeyDown={e => {
                          if ((e.key === 'Enter' || e.key === ' ') && (!isProduct || defaultHasStock)) addToCart(item, defaultTier?.code);
                        }}
                        className={cn(
                          "w-full flex items-center justify-between gap-3 p-3 rounded-2xl hover:bg-emerald-50/50 hover:border-emerald-100 border border-transparent group transition-all text-left duration-150 select-none cursor-pointer",
                          isProduct && !defaultHasStock && "opacity-40"
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={cn(
                            "h-10 w-10 rounded-xl flex items-center justify-center shrink-0 transition-all",
                            isProduct ? "bg-slate-100 text-slate-600 group-hover:bg-emerald-500 group-hover:text-white" : "bg-blue-150/40 text-blue-600 group-hover:bg-blue-500 group-hover:text-white"
                          )}>
                            {isProduct ? <Package size={16} strokeWidth={2.5} /> : <ShieldCheck size={16} strokeWidth={2.5} />}
                          </div>

                          <div className="min-w-0">
                            <p className="font-extrabold text-zinc-900 text-xs truncate uppercase tracking-tight group-hover:text-emerald-950 transition-colors">{item.name}</p>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {isProduct ? (
                                <>
                                  <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider block border", totalBaseStock > 50 ? "bg-emerald-50 text-emerald-600 border-emerald-100" : totalBaseStock > 0 ? "bg-amber-50 text-amber-600 border-amber-100" : "bg-rose-50 text-rose-600 border-rose-100")}>{totalBaseStock} {product?.baseUnit || product?.unit || 'base units'}</span>
                                  {isMultiTier && <span className="text-[8px] font-black uppercase text-emerald-700">Default: {defaultTier?.label}</span>}
                                </>
                              ) : (
                                <span className="bg-blue-50 text-blue-650 border border-blue-100 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider">Fee Service</span>
                              )}
                              <p className="text-[9px] text-zinc-400 truncate uppercase tracking-tight max-w-[120px]">{isProduct ? (product?.genericName || '') : 'Clinical'}</p>
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0 min-w-[118px]">
                          <p className="font-black text-zinc-850 text-xs tracking-tight leading-none">UGX {(price || 0).toLocaleString()}</p>
                          {isProduct && !defaultHasStock ? (
                            <span className="text-[9px] font-black text-rose-500 uppercase tracking-widest mt-1 block">OUT</span>
                          ) : (
                            <span className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mt-1 block">ADD {isMultiTier ? defaultTier?.label : ''} +</span>
                          )}
                          {isProduct && isMultiTier && resolution.tiers.length > 1 && (
                            <div className="mt-2 flex flex-wrap justify-end gap-1">
                              {resolution.tiers.filter(tier => tier.code !== defaultTier?.code).map(tier => {
                                const hasTierStock = totalBaseStock >= tier.multiplier;
                                return (
                                  <button
                                    type="button"
                                    key={tier.code}
                                    disabled={!hasTierStock}
                                    onClick={event => {
                                      event.stopPropagation();
                                      if (hasTierStock) addToCart(item, tier.code);
                                    }}
                                    className="px-2 py-1 rounded-lg border border-emerald-100 bg-white text-[8px] font-black uppercase text-emerald-700 disabled:opacity-30"
                                  >
                                    {tier.label} {Number(tier.configuredPrice || 0).toLocaleString()}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {filteredItems.length"""
sales = replace_regex(sales, r"                  \{filteredItems\.map\(item => \{.*?\n                  \}\)\}\n\n                  \{filteredItems\.length", catalog_map, 'Sales product catalogue map')

PRODUCT_MODAL.write_text(product_modal)
INVENTORY.write_text(inventory)
SALES.write_text(sales)
print('Phase C source transformations applied.')
