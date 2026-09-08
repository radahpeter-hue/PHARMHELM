import fs from 'node:fs';

const productModalPath = 'src/components/inventory/ProductModal.tsx';
const inventoryPath = 'src/pages/Inventory.tsx';
const salesPath = 'src/pages/Sales.tsx';

const read = path => fs.readFileSync(path, 'utf8');
const write = (path, content) => fs.writeFileSync(path, content);

function replaceOnce(content, search, replacement, label) {
  if (!content.includes(search)) throw new Error(`Phase C patch anchor not found: ${label}`);
  return content.replace(search, replacement);
}

function replaceRegex(content, pattern, replacement, label) {
  if (!pattern.test(content)) throw new Error(`Phase C regex anchor not found: ${label}`);
  pattern.lastIndex = 0;
  return content.replace(pattern, replacement);
}

let productModal = read(productModalPath);
let inventory = read(inventoryPath);
let sales = read(salesPath);

if (
  productModal.includes('Multi-tier Selling Configuration') &&
  inventory.includes('systemSettings={settings}') &&
  sales.includes('buildTierCartItem') &&
  sales.includes('FEFO allocation will be finalised at checkout')
) {
  console.log('Phase C UI/cart patch is already applied.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Inventory Master product configuration
// ---------------------------------------------------------------------------
productModal = replaceOnce(
  productModal,
  "import { Product } from '../../types';",
  "import { Product, SystemSettings } from '../../types';\nimport type { SellingTierCode } from '../../types/sellingTier';\nimport { getMultiTierEligibility, getTierMultiplier } from '../../services/sellingTierService';\nimport { applyLegacySellingTierMirror, normaliseSellingTiers, SELLING_TIER_CODES, SELLING_TIER_LABELS, validateSellingTierConfiguration } from '../../services/sellingTierConfigurationService';",
  'ProductModal imports'
);

productModal = replaceOnce(
  productModal,
  "  product?: Product | null;\n}",
  "  product?: Product | null;\n  systemSettings?: SystemSettings | null;\n}",
  'ProductModal props'
);

productModal = replaceOnce(
  productModal,
  "const ProductModal: React.FC<ProductModalProps> = ({ isOpen, onClose, product }) => {",
  "const ProductModal: React.FC<ProductModalProps> = ({ isOpen, onClose, product, systemSettings }) => {",
  'ProductModal signature'
);

productModal = replaceOnce(
  productModal,
  "    status: 'active',\n    unitOfSell: 'unit',\n    ...product\n  });",
  "    status: 'active',\n    unitOfSell: 'unit',\n    ...product,\n    sellingTiers: normaliseSellingTiers(product),\n    defaultSellingTierCode: product?.defaultSellingTierCode\n  });",
  'ProductModal initial form data'
);

productModal = replaceOnce(
  productModal,
  "        status: product.status || 'active',\n        unitOfSell: product.unitOfSell || 'unit'\n      } : {})\n    });",
  "        status: product.status || 'active',\n        unitOfSell: product.unitOfSell || 'unit'\n      } : {}),\n      sellingTiers: normaliseSellingTiers(product),\n      defaultSellingTierCode: product?.defaultSellingTierCode\n    });",
  'ProductModal reset form data'
);

productModal = replaceOnce(
  productModal,
  "    if ((formData.dosageForm === 'Tablet' || formData.dosageForm === 'Capsule') && (!formData.unitsPerStrip || formData.unitsPerStrip <= 0)) {\n      toast.error('Units per strip is required for Tablets and Capsules');\n      return;\n    }\n\n    setIsSaving(true);",
  `    const tierDraft: Partial<Product> = {\n      ...formData,\n      sellingTiers: normaliseSellingTiers(formData)\n    };\n    const tierErrors = validateSellingTierConfiguration(tierDraft);\n    if (tierErrors.length > 0) {\n      toast.error(tierErrors[0]);\n      return;\n    }\n\n    const packagingChanged = Boolean(product?.id) && (\n      Number(product?.unitsPerStrip || 0) !== Number(formData.unitsPerStrip || 0) ||\n      Number(product?.unitsPerPack || 0) !== Number(formData.unitsPerPack || 0)\n    );\n    if (packagingChanged && Number(product?.stock || product?.quantityInStock || 0) > 0) {\n      const acknowledged = window.confirm('Packaging multipliers are changing while this product has active stock. Existing historical sales will keep their stored tier snapshots, but future sales will use the new multipliers. Continue?');\n      if (!acknowledged) return;\n    }\n\n    const mirroredDraft = applyLegacySellingTierMirror(tierDraft);\n    setIsSaving(true);`,
  'ProductModal validation'
);

productModal = replaceOnce(
  productModal,
  "      const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...editableFields } = formData as any;\n      const productData = {\n        ...editableFields,\n        tenantId: profile.tenantId,\n        productId: formData.productId || `PRD-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,\n        sku: formData.sku || `SKU-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,\n      };",
  "      const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...editableFields } = mirroredDraft as any;\n      const productData = {\n        ...editableFields,\n        tenantId: profile.tenantId,\n        productId: mirroredDraft.productId || `PRD-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,\n        sku: mirroredDraft.sku || `SKU-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,\n      };",
  'ProductModal save draft'
);

const tierConfigRenderer = `\n  const tierEligibility = getMultiTierEligibility(formData as Product);\n\n  const updateTier = (code: SellingTierCode, patch: Partial<{ enabled: boolean; price: number }>) => {\n    setFormData(current => {\n      const tiers = normaliseSellingTiers(current);\n      const nextTier = { ...tiers[code]!, ...patch };\n      const nextDefault = patch.enabled === false && current.defaultSellingTierCode === code\n        ? undefined\n        : current.defaultSellingTierCode;\n      return {\n        ...current,\n        sellingTiers: { ...tiers, [code]: nextTier },\n        defaultSellingTierCode: nextDefault\n      };\n    });\n  };\n\n  const renderSellingTierConfiguration = () => {\n    if (!tierEligibility.eligible) return null;\n    const tiers = normaliseSellingTiers(formData);\n    const featureEnabled = systemSettings?.features?.multiTierSellingEnabled === true;\n\n    return (\n      <div className=\"space-y-4 p-5 bg-emerald-50/40 border border-emerald-100 rounded-3xl\">\n        <div className=\"flex flex-col sm:flex-row sm:items-start justify-between gap-3\">\n          <div>\n            <h3 className=\"text-xs font-black text-emerald-900 uppercase tracking-widest\">Multi-tier Selling Configuration</h3>\n            <p className=\"text-[10px] text-emerald-700 mt-1\">Configure only the commercial tiers this product can actually be sold in. Prices are explicit and are never generated from another tier.</p>\n          </div>\n          <span className={\\`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider border \\${featureEnabled ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-amber-700 border-amber-200'}\\`}>\n            {featureEnabled ? 'POS feature active' : 'POS feature off'}\n          </span>\n        </div>\n\n        <div className=\"grid grid-cols-1 gap-2\">\n          {SELLING_TIER_CODES.map(code => {\n            const config = tiers[code]!;\n            const multiplier = getTierMultiplier(formData as Product, code);\n            const multiplierValid = code === 'unit' || Boolean(multiplier && multiplier > 0);\n            const canEnable = multiplierValid;\n            return (\n              <div key={code} className=\"grid grid-cols-12 items-center gap-3 bg-white border border-emerald-100 rounded-2xl px-4 py-3\">\n                <div className=\"col-span-12 sm:col-span-3 flex items-center gap-3\">\n                  <input\n                    type=\"checkbox\"\n                    checked={config.enabled}\n                    disabled={!canEnable}\n                    onChange={e => updateTier(code, { enabled: e.target.checked })}\n                    className=\"h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500\"\n                  />\n                  <div>\n                    <p className=\"text-xs font-black text-zinc-900\">{SELLING_TIER_LABELS[code]}</p>\n                    <p className=\"text-[9px] text-zinc-400\">{code === 'unit' ? '1 base unit' : multiplierValid ? \\`\\${multiplier} base units\\` : 'Packaging multiplier required'}</p>\n                  </div>\n                </div>\n                <div className=\"col-span-8 sm:col-span-6\">\n                  <label className=\"text-[8px] font-black text-zinc-400 uppercase tracking-wider block mb-1\">Selling price (UGX)</label>\n                  <input\n                    type=\"number\"\n                    min=\"0\"\n                    disabled={!config.enabled}\n                    value={Number.isFinite(Number(config.price)) ? config.price : 0}\n                    onChange={e => updateTier(code, { price: Number(e.target.value || 0) })}\n                    className=\"w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-bold disabled:opacity-40\"\n                  />\n                </div>\n                <label className=\"col-span-4 sm:col-span-3 flex items-center justify-end gap-2 text-[9px] font-black uppercase text-zinc-500\">\n                  <input\n                    type=\"radio\"\n                    name=\"default-selling-tier\"\n                    checked={formData.defaultSellingTierCode === code}\n                    disabled={!config.enabled}\n                    onChange={() => setFormData(current => ({ ...current, defaultSellingTierCode: code }))}\n                  />\n                  Default\n                </label>\n              </div>\n            );\n          })}\n        </div>\n        {!featureEnabled && (\n          <p className=\"text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2\">You can preconfigure these tiers safely. POS continues using legacy behaviour until the tenant feature flag is explicitly enabled.</p>\n        )}\n      </div>\n    );\n  };\n`;

productModal = replaceOnce(productModal, "\n  return (\n    <div className=\"fixed inset-0", `${tierConfigRenderer}\n  return (\n    <div className=\"fixed inset-0`, 'ProductModal tier renderer');

productModal = replaceOnce(
  productModal,
  "              <label className=\"text-[10px] font-black text-zinc-400 uppercase tracking-wider\">Selling Price (Per Unit) *</label>",
  "              <label className=\"text-[10px] font-black text-zinc-400 uppercase tracking-wider\">Legacy Selling Price *</label>",
  'ProductModal legacy price label'
);

productModal = replaceOnce(
  productModal,
  "          {/* Pricing & Tax */}",
  "          {renderSellingTierConfiguration()}\n\n          {/* Pricing & Tax */}",
  'ProductModal tier panel placement'
);

// ---------------------------------------------------------------------------
// Inventory page surfaces configured tiers and passes settings into ProductModal
// ---------------------------------------------------------------------------
inventory = replaceOnce(inventory, "import { Product, ProductBatch, InventoryMovement } from '../types';", "import { Product, ProductBatch, InventoryMovement, SystemSettings } from '../types';", 'Inventory types import');
inventory = replaceOnce(inventory, "  const [settings, setSettings] = useState<any>(null);", "  const [settings, setSettings] = useState<(SystemSettings & { id?: string }) | null>(null);", 'Inventory settings state');
inventory = inventory.replaceAll(
  "              featureToggles: {\n                enableOperationalInventory: false,\n              },",
  "              featureToggles: {\n                enableOperationalInventory: false,\n              },\n              features: {\n                multiTierSellingEnabled: false,\n              },"
);
inventory = inventory.replaceAll(
  "          featureToggles: {\n            enableOperationalInventory: newValue,\n          },",
  "          featureToggles: {\n            enableOperationalInventory: newValue,\n          },\n          features: {\n            multiTierSellingEnabled: false,\n          },"
);

inventory = replaceOnce(
  inventory,
  "                      const productStock = branchBatches\n                        .filter(b => b.productId === product.id)\n                        .reduce((acc, curr) => acc + (curr.quantity || 0), 0);\n                      \n                      return (",
  "                      const productStock = branchBatches\n                        .filter(b => b.productId === product.id)\n                        .reduce((acc, curr) => acc + (curr.quantity || 0), 0);\n                      const enabledTierEntries = (['unit', 'strip', 'pack'] as const)\n                        .filter(code => product.sellingTiers?.[code]?.enabled)\n                        .map(code => ({ code, price: Number(product.sellingTiers?.[code]?.price || 0) }));\n                      \n                      return (",
  'Inventory tier entries'
);

inventory = replaceOnce(
  inventory,
  "                                  {product.unitOfSell}\n                                </span>",
  "                                  {enabledTierEntries.length > 0 ? 'Multi-tier' : product.unitOfSell}\n                                </span>",
  'Inventory multi-tier badge'
);

inventory = replaceOnce(
  inventory,
  "                                {product.unitOfSell}s\n                              </span>",
  "                                {product.baseUnit || product.unit || 'base units'}\n                              </span>",
  'Inventory base unit stock label'
);

inventory = replaceOnce(
  inventory,
  "                          <div className=\"flex flex-col\">\n                            <span className=\"text-xs font-bold text-zinc-900\">Sell: {(product.sellingPricePerUnit || 0).toLocaleString()} UGX</span>\n                            <span className=\"text-[10px] font-black text-zinc-400 uppercase tracking-widest\">Cost: {(product.costPricePerPack || 0).toLocaleString()} /pack</span>\n                          </div>",
  `                          <div className=\"flex flex-col gap-0.5\">\n                            {enabledTierEntries.length > 0 ? enabledTierEntries.map(tier => (\n                              <span key={tier.code} className=\"text-[10px] font-bold text-zinc-800 uppercase\">{tier.code}: {tier.price.toLocaleString()} UGX</span>\n                            )) : (\n                              <span className=\"text-xs font-bold text-zinc-900\">Sell: {(product.sellingPricePerUnit || 0).toLocaleString()} UGX</span>\n                            )}\n                            <span className=\"text-[10px] font-black text-zinc-400 uppercase tracking-widest\">Cost: {(product.costPricePerPack || 0).toLocaleString()} /pack</span>\n                          </div>`,
  'Inventory pricing display'
);

inventory = replaceOnce(
  inventory,
  "          product={editingProduct} \n        />",
  "          product={editingProduct}\n          systemSettings={settings}\n        />",
  'Inventory ProductModal settings prop'
);

// ---------------------------------------------------------------------------
// POS product selection and commercial tier-aware cart
// ---------------------------------------------------------------------------
sales = replaceOnce(
  sales,
  "import { canOperatePos, formatPosCheckoutError } from '../utils/posAuthorization';",
  "import { canOperatePos, formatPosCheckoutError } from '../utils/posAuthorization';\nimport type { SellingTierCode } from '../types/sellingTier';\nimport { resolveSellingTiers } from '../services/sellingTierService';\nimport { buildTierCartItem, getCartLineIdentity, getProductUsableBaseStock, getReservedBaseQuantityForProduct, mergeTierCartItem, replaceTierCartPrice, replaceTierCartQuantity } from '../services/posTierCartService';",
  'Sales multi-tier imports'
);

const newAddToCart = `  const addToCart = (item: Product | BillableService, requestedTierCode?: SellingTierCode) => {\n    if (activeTab === 'products') {\n      const product = item as Product;\n      const resolution = resolveSellingTiers(product, systemSettings);\n\n      if (resolution.mode === 'multi-tier') {\n        if (!profile?.tenantId || !activeBranchId) {\n          toast.error('Select an active branch before adding multi-tier stock.');\n          return;\n        }\n        const tier = requestedTierCode\n          ? resolution.tiers.find(candidate => candidate.code === requestedTierCode)\n          : resolution.defaultTier;\n        if (!tier) {\n          toast.error('The selected selling tier is not available for this product.');\n          return;\n        }\n\n        const usableBaseStock = getProductUsableBaseStock(batches, product.id);\n        const reservedBaseStock = getReservedBaseQuantityForProduct(cart, product.id);\n        if (reservedBaseStock + tier.multiplier > usableBaseStock) {\n          toast.error(\\`Insufficient stock for one \\${tier.label}. \\${product.name} has \\${usableBaseStock} usable base units available.\\`);\n          return;\n        }\n\n        try {\n          const incoming = buildTierCartItem({\n            product,\n            tier,\n            batches,\n            tenantId: profile.tenantId,\n            branchId: activeBranchId,\n            commercialQuantity: 1\n          });\n          setCart(current => mergeTierCartItem(current, incoming));\n          toast.success(\\`\\${product.name} added as \\${tier.label}\\`);\n        } catch (error) {\n          toast.error(error instanceof Error ? error.message : 'Unable to add this selling tier.');\n        }\n        return;\n      }\n\n      const multiplier = product.unitOfSell === 'pack' ? (product.unitsPerPack || 1) : \n                        product.unitOfSell === 'strip' ? (product.unitsPerStrip || 1) : 1;\n\n      const productBatches = batches\n        .filter(b => b.productId === product.id && b.quantity >= multiplier && b.batch_status === 'active')\n        .filter(b => isInventoryBatchUnexpired(b.expiryDate))\n        .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());\n\n      if (productBatches.length === 0) {\n        toast.error('No active/unexpired stock available for this product');\n        return;\n      }\n\n      const bestBatch = productBatches[0];\n      const existingItem = cart.find(i => !i.tierCode && i.productId === product.id && i.batchNumber === bestBatch.batchNumber);\n\n      if (existingItem) {\n        updateQuantity(product.id, getCartLineIdentity(existingItem), 1);\n      } else {\n        const unitPrice = bestBatch.sellingPrice * multiplier;\n        setCart([{\n          productId: product.id,\n          productName: product.name,\n          genericName: product.genericName,\n          batchNumber: bestBatch.batchNumber,\n          expiryDate: bestBatch.expiryDate,\n          quantity: 1,\n          unitPrice,\n          costPrice: bestBatch.purchasePrice * multiplier,\n          subtotal: unitPrice,\n          isService: false\n        }, ...cart]);\n      }\n      toast.success(\\`\\${item.name} added to cart\\`);\n    } else {\n      const service = item as BillableService;\n      const existingItem = cart.find(i => i.productId === service.id && i.isService);\n      if (existingItem) {\n        setCart(cart.map(i => \n          i.productId === service.id && i.isService\n            ? { ...i, quantity: i.quantity + 1, subtotal: (i.quantity + 1) * i.unitPrice }\n            : i\n        ));\n      } else {\n        setCart([...cart, {\n          productId: service.id,\n          productName: service.name,\n          batchNumber: 'N/A',\n          expiryDate: 'N/A',\n          quantity: 1,\n          unitPrice: service.defaultFee,\n          costPrice: 0,\n          subtotal: service.defaultFee,\n          isService: true\n        }]);\n      }\n      toast.success(\\`\\${item.name} added to cart\\`);\n    }\n  };\n\n  const changeBatch =`;

sales = replaceRegex(
  sales,
  /  const addToCart = \(item: Product \| BillableService\) => \{[\s\S]*?\n  \};\n\n  const changeBatch =/,
  newAddToCart,
  'Sales addToCart'
);

const newUpdateQuantity = `  const updateQuantity = (productId: string, lineIdentity: string, delta: number) => {\n    const currentCartItem = cart.find(item => getCartLineIdentity(item) === lineIdentity);\n    if (!currentCartItem) return;\n\n    if (currentCartItem.tierCode) {\n      const product = products.find(p => p.id === productId);\n      if (!product) return;\n      const currentQuantity = Number(currentCartItem.commercialQuantity ?? currentCartItem.quantity ?? 0);\n      const newQuantity = Math.max(0, currentQuantity + delta);\n      try {\n        setCart(current => replaceTierCartQuantity({\n          cart: current,\n          targetIdentity: lineIdentity,\n          product,\n          batches,\n          commercialQuantity: newQuantity\n        }));\n      } catch (error) {\n        toast.error(error instanceof Error ? error.message : 'Unable to change tier quantity.');\n      }\n      return;\n    }\n\n    const batchNumber = currentCartItem.batchNumber;\n    const product = products.find(p => p.id === productId);\n    const multiplier = product?.unitOfSell === 'pack' ? (product.unitsPerPack || 1) : \n                      product?.unitOfSell === 'strip' ? (product.unitsPerStrip || 1) : 1;\n\n    if (currentCartItem.isService) {\n      setCart(cart.map(item => {\n        if (getCartLineIdentity(item) === lineIdentity) {\n          const newQty = Math.max(0, item.quantity + delta);\n          return { ...item, quantity: newQty, subtotal: newQty * item.unitPrice };\n        }\n        return item;\n      }));\n      return;\n    }\n\n    const newQty = Math.max(0, currentCartItem.quantity + delta);\n    const currentBatch = batches.find(b => b.productId === productId && b.batchNumber === batchNumber);\n    if (!currentBatch) return;\n\n    const currentBatchMaxQty = Math.floor(currentBatch.quantity / multiplier);\n\n    if (newQty <= currentBatchMaxQty) {\n      setCart(cart.map(item => getCartLineIdentity(item) === lineIdentity\n        ? { ...item, quantity: newQty, subtotal: newQty * item.unitPrice }\n        : item\n      ));\n    } else {\n      const currentBatchQtyToSet = currentBatchMaxQty;\n      const balanceQty = newQty - currentBatchQtyToSet;\n\n      const otherBatches = batches\n        .filter(b => b.productId === productId && b.batchNumber !== batchNumber && b.quantity >= multiplier && b.batch_status === 'active')\n        .filter(b => isInventoryBatchUnexpired(b.expiryDate))\n        .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());\n\n      if (otherBatches.length === 0) {\n        toast.error(\\`Insufficient stock! Only \\${currentBatchMaxQty} available in this batch.\\`);\n        setCart(cart.map(item => getCartLineIdentity(item) === lineIdentity\n          ? { ...item, quantity: currentBatchMaxQty, subtotal: currentBatchMaxQty * item.unitPrice }\n          : item\n        ));\n        return;\n      }\n\n      let remainingBalance = balanceQty;\n      const additionalCartItems: SaleItem[] = [];\n      for (const batch of otherBatches) {\n        if (remainingBalance <= 0) break;\n        const maxAvail = Math.floor(batch.quantity / multiplier);\n        if (maxAvail <= 0) continue;\n        const qtyToTake = Math.min(remainingBalance, maxAvail);\n        remainingBalance -= qtyToTake;\n        const unitPrice = batch.sellingPrice * multiplier;\n        additionalCartItems.push({\n          productId,\n          productName: currentCartItem.productName,\n          genericName: currentCartItem.genericName,\n          batchNumber: batch.batchNumber,\n          expiryDate: batch.expiryDate,\n          quantity: qtyToTake,\n          unitPrice,\n          costPrice: batch.purchasePrice * multiplier,\n          subtotal: qtyToTake * unitPrice,\n          isService: false\n        } as SaleItem);\n      }\n\n      if (remainingBalance > 0) toast.warning(\\`Insufficient total stock. Missing \\${remainingBalance} commercial units.\\`);\n\n      setCart(prevCart => {\n        let nextCart = prevCart.map(item => getCartLineIdentity(item) === lineIdentity\n          ? { ...item, quantity: currentBatchQtyToSet, subtotal: currentBatchQtyToSet * item.unitPrice }\n          : item\n        );\n        for (const add of additionalCartItems) {\n          const existingIdx = nextCart.findIndex(item => !item.tierCode && item.productId === productId && item.batchNumber === add.batchNumber);\n          if (existingIdx !== -1) {\n            const existingItem = nextCart[existingIdx];\n            const updatedQty = Math.min(\n              existingItem.quantity + add.quantity,\n              Math.floor((batches.find(b => b.productId === productId && b.batchNumber === add.batchNumber)?.quantity || 0) / multiplier)\n            );\n            nextCart[existingIdx] = { ...existingItem, quantity: updatedQty, subtotal: updatedQty * existingItem.unitPrice };\n          } else {\n            nextCart = [add, ...nextCart];\n          }\n        }\n        return nextCart;\n      });\n      toast.success('Quantity split across available batches');\n    }\n  };\n\n  const updatePrice =`;

sales = replaceRegex(
  sales,
  /  const updateQuantity = \(productId: string, batchNumber: string, delta: number\) => \{[\s\S]*?\n  \};\n\n  const updatePrice =/,
  newUpdateQuantity,
  'Sales updateQuantity'
);

sales = replaceRegex(
  sales,
  /  const updatePrice = \(productId: string, batchNumber: string, newPrice: number\) => \{[\s\S]*?\n  \};\n\n  const removeFromCart = \(productId: string, batchNumber: string\) => \{[\s\S]*?\n  \};/,
  `  const updatePrice = (productId: string, lineIdentity: string, newPrice: number) => {\n    const target = cart.find(item => getCartLineIdentity(item) === lineIdentity);\n    if (!target) return;\n    if (target.tierCode) {\n      setCart(current => replaceTierCartPrice({ cart: current, targetIdentity: lineIdentity, actualUnitPrice: Math.max(0, newPrice) }));\n      return;\n    }\n    setCart(cart.map(item => getCartLineIdentity(item) === lineIdentity\n      ? { ...item, unitPrice: Math.max(0, newPrice), subtotal: item.quantity * Math.max(0, newPrice) }\n      : item\n    ));\n  };\n\n  const removeFromCart = (lineIdentity: string) => {\n    setCart(cart.filter(item => getCartLineIdentity(item) !== lineIdentity));\n  };`,
  'Sales updatePrice/remove'
);

sales = replaceOnce(
  sales,
  "    if (cart.length === 0) {\n      toast.error('Cart is empty');\n      return;\n    }",
  "    if (cart.length === 0) {\n      toast.error('Cart is empty');\n      return;\n    }\n\n    if (systemSettings?.features?.multiTierSellingEnabled === true && cart.some(item => !item.isService && item.tierCode)) {\n      toast.error('Multi-tier basket selection is ready, but checkout is blocked until transactional tier-level FEFO integration is completed. No stock has been deducted.');\n      return;\n    }",
  'Sales Phase D checkout guard'
);

sales = sales.replaceAll("key={`${item.productId}-${item.batchNumber}-${index}`}", "key={`${getCartLineIdentity(item)}-${index}`}");
sales = sales.replaceAll("updateQuantity(item.productId, item.batchNumber,", "updateQuantity(item.productId, getCartLineIdentity(item),");
sales = sales.replaceAll("updatePrice(item.productId, item.batchNumber,", "updatePrice(item.productId, getCartLineIdentity(item),");
sales = sales.replaceAll("removeFromCart(item.productId, item.batchNumber)", "removeFromCart(getCartLineIdentity(item))");

sales = replaceOnce(
  sales,
  "                              {item.isService && (\n                                <span className=\"text-[7px] bg-blue-50 text-blue-600 border border-blue-150 px-1 rounded font-black uppercase\">\n                                  Service\n                                </span>\n                              )}",
  "                              {item.isService && (\n                                <span className=\"text-[7px] bg-blue-50 text-blue-600 border border-blue-150 px-1 rounded font-black uppercase\">\n                                  Service\n                                </span>\n                              )}\n                              {item.tierCode && (\n                                <span className=\"text-[7px] bg-emerald-50 text-emerald-700 border border-emerald-150 px-1 rounded font-black uppercase\">\n                                  {item.tierLabel || item.tierCode}\n                                </span>\n                              )}",
  'Sales cart tier badge'
);

const oldBatchBlock = `                            {/* Inner Batch Selection */}\n                            {!item.isService && (\n                              <div className=\"mt-0.5 flex items-center gap-1 text-[8px] text-zinc-400 font-bold\">\n                                <span>Batch:</span>\n                                <select \n                                  className=\"p-0 bg-transparent border-none text-[8px] font-extrabold hover:text-emerald-600 focus:ring-0 cursor-pointer text-zinc-500 uppercase\"\n                                  value={item.batchNumber}\n                                  onChange={(e) => changeBatch(item.productId, item.batchNumber, e.target.value)}\n                                >\n                                  {batches\n                                    .filter(b => b.productId === item.productId && b.quantity > 0 && b.batch_status === 'active' && new Date(b.expiryDate) > new Date())\n                                    .map(b => {\n                                      const mult = product?.unitOfSell === 'pack' ? (product.unitsPerPack || 1) : \n                                                   product?.unitOfSell === 'strip' ? (product.unitsPerStrip || 1) : 1;\n                                      const stockLeft = Math.floor(b.quantity / mult);\n                                      return (\n                                        <option key={b.batchNumber} value={b.batchNumber} className=\"text-zinc-800\">\n                                          {b.batchNumber} (EXP: {b.expiryDate}) • {stockLeft} LEFT\n                                        </option>\n                                      );\n                                    })\n                                  }\n                                </select>\n                              </div>\n                            )}`;

const newBatchBlock = `                            {/* Batch semantics: tier lines stay commercial until transactional FEFO checkout. */}\n                            {!item.isService && (\n                              item.tierCode ? (\n                                <div className=\"mt-1 flex flex-wrap items-center gap-1.5 text-[8px] font-bold\">\n                                  <span className=\"text-emerald-700\">{item.commercialQuantity || item.quantity} {item.tierLabel || item.tierCode}</span>\n                                  <span className=\"text-zinc-300\">•</span>\n                                  <span className=\"text-zinc-500\">{item.baseQuantity || 0} {product?.baseUnit || product?.unit || 'base units'}</span>\n                                  <span className=\"text-zinc-300\">•</span>\n                                  <span className=\"text-amber-600\">FEFO allocation will be finalised at checkout</span>\n                                </div>\n                              ) : (\n                                <div className=\"mt-0.5 flex items-center gap-1 text-[8px] text-zinc-400 font-bold\">\n                                  <span>Batch:</span>\n                                  <select \n                                    className=\"p-0 bg-transparent border-none text-[8px] font-extrabold hover:text-emerald-600 focus:ring-0 cursor-pointer text-zinc-500 uppercase\"\n                                    value={item.batchNumber}\n                                    onChange={(e) => changeBatch(item.productId, item.batchNumber, e.target.value)}\n                                  >\n                                    {batches\n                                      .filter(b => b.productId === item.productId && b.quantity > 0 && b.batch_status === 'active' && isInventoryBatchUnexpired(b.expiryDate))\n                                      .map(b => {\n                                        const mult = product?.unitOfSell === 'pack' ? (product.unitsPerPack || 1) : \n                                                     product?.unitOfSell === 'strip' ? (product.unitsPerStrip || 1) : 1;\n                                        const stockLeft = Math.floor(b.quantity / mult);\n                                        return (\n                                          <option key={b.batchNumber} value={b.batchNumber} className=\"text-zinc-800\">\n                                            {b.batchNumber} (EXP: {b.expiryDate}) • {stockLeft} LEFT\n                                          </option>\n                                        );\n                                      })\n                                    }\n                                  </select>\n                                </div>\n                              )\n                            )}`;

sales = replaceOnce(sales, oldBatchBlock, newBatchBlock, 'Sales cart batch block');

const catalogMap = `                  {filteredItems.map(item => {\n                    const isProduct = activeTab === 'products';\n                    const product = isProduct ? item as Product : null;\n                    const service = !isProduct ? item as BillableService : null;\n                    const productBatches = isProduct ? batches.filter(b => b.productId === product?.id && b.quantity > 0 && b.batch_status === 'active' && isInventoryBatchUnexpired(b.expiryDate)) : [];\n                    const totalBaseStock = isProduct && product ? getProductUsableBaseStock(batches, product.id) : 0;\n                    const resolution = isProduct && product ? resolveSellingTiers(product, systemSettings) : null;\n                    const isMultiTier = resolution?.mode === 'multi-tier';\n                    const defaultTier = isMultiTier ? resolution.defaultTier : null;\n                    const legacyMultiplier = product?.unitOfSell === 'pack' ? (product.unitsPerPack || 1) : product?.unitOfSell === 'strip' ? (product.unitsPerStrip || 1) : 1;\n                    const displayMultiplier = defaultTier?.multiplier || legacyMultiplier;\n                    const totalStock = isProduct ? Math.floor(totalBaseStock / Math.max(1, displayMultiplier)) : 0;\n                    const price = isProduct\n                      ? (defaultTier?.configuredPrice ?? productBatches[0]?.sellingPrice ?? product?.sellingPricePerUnit ?? 0)\n                      : (service?.defaultFee || 0);\n                    const defaultHasStock = !isProduct || totalBaseStock >= Math.max(1, displayMultiplier);\n\n                    return (\n                      <div\n                        key={item.id}\n                        role=\"button\"\n                        tabIndex={0}\n                        onClick={() => {\n                          if (!isProduct) addToCart(item);\n                          else if (defaultHasStock) addToCart(item, defaultTier?.code);\n                        }}\n                        onKeyDown={e => {\n                          if ((e.key === 'Enter' || e.key === ' ') && (!isProduct || defaultHasStock)) addToCart(item, defaultTier?.code);\n                        }}\n                        className={cn(\n                          \"w-full flex items-center justify-between gap-3 p-3 rounded-2xl hover:bg-emerald-50/50 hover:border-emerald-100 border border-transparent group transition-all text-left duration-150 select-none cursor-pointer\",\n                          isProduct && !defaultHasStock && \"opacity-40\"\n                        )}\n                      >\n                        <div className=\"flex items-center gap-3 min-w-0\">\n                          <div className={cn(\n                            \"h-10 w-10 rounded-xl flex items-center justify-center shrink-0 transition-all\",\n                            isProduct ? \"bg-slate-100 text-slate-600 group-hover:bg-emerald-500 group-hover:text-white\" : \"bg-blue-150/40 text-blue-600 group-hover:bg-blue-500 group-hover:text-white\"\n                          )}>\n                            {isProduct ? <Package size={16} strokeWidth={2.5} /> : <ShieldCheck size={16} strokeWidth={2.5} />}\n                          </div>\n\n                          <div className=\"min-w-0\">\n                            <p className=\"font-extrabold text-zinc-900 text-xs truncate uppercase tracking-tight group-hover:text-emerald-950 transition-colors\">\n                              {item.name}\n                            </p>\n                            <div className=\"flex items-center gap-1.5 mt-1 flex-wrap\">\n                              {isProduct ? (\n                                <>\n                                  <span className={cn(\n                                    \"px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider block border\",\n                                    totalBaseStock > 50 ? \"bg-emerald-50 text-emerald-600 border-emerald-100\" : totalBaseStock > 0 ? \"bg-amber-50 text-amber-600 border-amber-100\" : \"bg-rose-50 text-rose-600 border-rose-100\"\n                                  )}>\n                                    {totalBaseStock} {product?.baseUnit || product?.unit || 'base units'}\n                                  </span>\n                                  {isMultiTier && <span className=\"text-[8px] font-black uppercase text-emerald-700\">Default: {defaultTier?.label}</span>}\n                                </>\n                              ) : (\n                                <span className=\"bg-blue-50 text-blue-650 border border-blue-100 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider\">Fee Service</span>\n                              )}\n                              <p className=\"text-[9px] text-zinc-400 truncate uppercase tracking-tight max-w-[120px]\">\n                                {isProduct ? (product?.genericName || '') : 'Clinical'}\n                              </p>\n                            </div>\n                          </div>\n                        </div>\n\n                        <div className=\"text-right shrink-0 min-w-[118px]\">\n                          <p className=\"font-black text-zinc-850 text-xs tracking-tight leading-none\">\n                            UGX {(price || 0).toLocaleString()}\n                          </p>\n                          {isProduct && !defaultHasStock ? (\n                            <span className=\"text-[9px] font-black text-rose-500 uppercase tracking-widest mt-1 block\">OUT</span>\n                          ) : (\n                            <span className=\"text-[9px] font-black text-emerald-600 uppercase tracking-widest mt-1 block\">\n                              ADD {isMultiTier ? defaultTier?.label : ''} +\n                            </span>\n                          )}\n                          {isProduct && isMultiTier && resolution.tiers.length > 1 && (\n                            <div className=\"mt-2 flex flex-wrap justify-end gap-1\">\n                              {resolution.tiers.filter(tier => tier.code !== defaultTier?.code).map(tier => {\n                                const hasTierStock = totalBaseStock >= tier.multiplier;\n                                return (\n                                  <button\n                                    type=\"button\"\n                                    key={tier.code}\n                                    disabled={!hasTierStock}\n                                    onClick={event => {\n                                      event.stopPropagation();\n                                      if (hasTierStock) addToCart(item, tier.code);\n                                    }}\n                                    className=\"px-2 py-1 rounded-lg border border-emerald-100 bg-white text-[8px] font-black uppercase text-emerald-700 disabled:opacity-30\"\n                                  >\n                                    {tier.label} {Number(tier.configuredPrice || 0).toLocaleString()}\n                                  </button>\n                                );\n                              })}\n                            </div>\n                          )}\n                        </div>\n                      </div>\n                    );\n                  })}\n\n                  {filteredItems.length`;

sales = replaceRegex(
  sales,
  /                  \{filteredItems\.map\(item => \{[\s\S]*?\n                  \}\)\}\n\n                  \{filteredItems\.length/,
  catalogMap,
  'Sales product catalogue map'
);

write(productModalPath, productModal);
write(inventoryPath, inventory);
write(salesPath, sales);
console.log('Phase C source transformations applied.');
