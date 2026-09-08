from pathlib import Path
import re


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    if new in text:
        print(f'{label}: already applied')
        return
    if old not in text:
        raise SystemExit(f'{label}: anchor not found in {path}')
    file_path.write_text(text.replace(old, new, 1))
    print(f'{label}: applied')


def regex_replace_once(path: str, pattern: str, replacement: str, label: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count == 0:
        print(f'{label}: pattern not found or already applied')
        return
    file_path.write_text(updated)
    print(f'{label}: applied')


replace_once(
    'src/services/saleInventoryRevisionPlanner.ts',
    """    const commercialQuantity = getStoredCommercialQuantity(item);\n    if (!Number.isInteger(commercialQuantity) || commercialQuantity <= 0) {\n      throw new Error(`${item.productName || item.name || product.name} must have a positive whole commercial quantity.`);\n    }\n    const targetBaseQuantity = getStoredBaseQuantity({ ...item, baseQuantity: undefined } as SaleItem, product);\n    if (!Number.isFinite(targetBaseQuantity) || targetBaseQuantity <= 0) throw new Error(`${product.name} has an invalid revised base quantity.`);\n""",
    """    const commercialQuantity = Number(item.quantity ?? item.commercialQuantity ?? 0);\n    if (!Number.isInteger(commercialQuantity) || commercialQuantity <= 0) {\n      throw new Error(`${item.productName || item.name || product.name} must have a positive whole commercial quantity.`);\n    }\n    const storedMultiplier = Number(item.tierMultiplier || 0);\n    const legacyUnit = String(product.unitOfSell || product.unit || '').trim().toLowerCase();\n    const legacyMultiplier = legacyUnit === 'pack'\n      ? Math.max(1, Number(product.unitsPerPack || 1))\n      : legacyUnit === 'strip'\n        ? Math.max(1, Number(product.unitsPerStrip || 1))\n        : 1;\n    const multiplier = Number.isFinite(storedMultiplier) && storedMultiplier > 0 ? storedMultiplier : legacyMultiplier;\n    const targetBaseQuantity = commercialQuantity * multiplier;\n    if (!Number.isFinite(targetBaseQuantity) || targetBaseQuantity <= 0) throw new Error(`${product.name} has an invalid revised base quantity.`);\n""",
    'revision quantity authority'
)

replace_once(
    'src/services/posTierCartService.ts',
    """import { buildSaleTierSnapshot } from './sellingTierService';\n""",
    """import { buildSaleTierSnapshot } from './sellingTierService';\nimport { createSaleLineId } from './saleTierHistoryService';\n""",
    'tier cart line id import'
)

replace_once(
    'src/services/posTierCartService.ts',
    """  return {\n    productId: product.id,\n    tenantId,\n""",
    """  return {\n    lineId: createSaleLineId(),\n    productId: product.id,\n    tenantId,\n""",
    'tier cart stable line id'
)

replace_once(
    'src/services/posCheckoutTierService.ts',
    """import { resolveSellingTiers } from './sellingTierService';\n""",
    """import { resolveSellingTiers } from './sellingTierService';\nimport { createSaleLineId } from './saleTierHistoryService';\n""",
    'checkout line id import'
)

replace_once(
    'src/services/posCheckoutTierService.ts',
    """    return {\n      ...item,\n      quantity: commercialQuantity,\n""",
    """    return {\n      ...item,\n      lineId: item.lineId || createSaleLineId(),\n      quantity: commercialQuantity,\n""",
    'checkout stable line id'
)

# A4 invoice tier-aware historical rendering.
replace_once(
    'src/components/sales/A4InvoiceTemplate.tsx',
    """import { Sale, SaleItem } from '../../types';\n""",
    """import { Sale, SaleItem } from '../../types';\nimport { describeSaleItemQuantity } from '../../services/saleTierHistoryService';\n""",
    'a4 history formatter import'
)
replace_once(
    'src/components/sales/A4InvoiceTemplate.tsx',
    """                      <td className=\"p-3 text-zinc-600 font-mono text-[10px]\">\n                        <div>{item.batchNumber || 'N/A'}</div>\n                        {item.expiryDate && <div className=\"text-zinc-400 mt-0.5\">Exp: {item.expiryDate}</div>}\n                      </td>\n                      <td className=\"p-3 text-center font-bold text-zinc-800\">{item.quantity}</td>\n                      <td className=\"p-3 text-right text-zinc-600\">UGX {(item.unitPrice || 0).toLocaleString()}</td>\n""",
    """                      <td className=\"p-3 text-zinc-600 font-mono text-[10px]\">\n                        <div>{item.batchAllocations?.length > 1 ? item.batchAllocations.map((allocation: any) => `${allocation.batchNumber}: ${allocation.baseQuantity}`).join(', ') : (item.batchNumber || 'N/A')}</div>\n                        {item.expiryDate && <div className=\"text-zinc-400 mt-0.5\">Exp: {item.expiryDate}</div>}\n                      </td>\n                      <td className=\"p-3 text-center font-bold text-zinc-800\">\n                        <div>{describeSaleItemQuantity(item).commercialText}</div>\n                        {describeSaleItemQuantity(item).baseText && <div className=\"text-[9px] font-medium text-zinc-400 mt-0.5\">{describeSaleItemQuantity(item).baseText}</div>}\n                      </td>\n                      <td className=\"p-3 text-right text-zinc-600\">UGX {(item.actualUnitPrice ?? item.unitPrice ?? 0).toLocaleString()}</td>\n""",
    'a4 tier quantity and batch rendering'
)
replace_once(
    'src/components/sales/A4InvoiceTemplate.tsx',
    """                      <td className=\"p-3 text-right font-bold text-zinc-900\">UGX {(item.quantity * item.unitPrice).toLocaleString()}</td>\n""",
    """                      <td className=\"p-3 text-right font-bold text-zinc-900\">UGX {Number(item.lineTotal ?? item.subtotal ?? item.total ?? (item.quantity * item.unitPrice)).toLocaleString()}</td>\n""",
    'a4 historical line total'
)

# Quotation persistence and previews preserve tier snapshots.
replace_once(
    'src/components/sales/QuotationPreview.tsx',
    """import { getNextQuotationId } from '../../services/quotationService';\n""",
    """import { getNextQuotationId } from '../../services/quotationService';\nimport { buildQuotationLineSnapshot, quotationQuantityText } from '../../services/quotationTierService';\n""",
    'quotation snapshot import'
)
regex_replace_once(
    'src/components/sales/QuotationPreview.tsx',
    r"      const lineItems = cart\.map\(item => \(\{.*?\}\)\);",
    "      const lineItems = cart.map(item => buildQuotationLineSnapshot(item));",
    'quotation full line snapshot'
)
replace_once(
    'src/components/sales/QuotationPreview.tsx',
    """      ctx.fillText(String(item.quantity), columns[2] + 18, y + 45);\n""",
    """      ctx.fillText(quotationQuantityText(buildQuotationLineSnapshot(item)), columns[2] + 18, y + 45, 180);\n""",
    'quotation canvas tier quantity'
)
replace_once(
    'src/components/sales/QuotationPreview.tsx',
    """      ctx.fillText(money(item.quantity * item.unitPrice), columns[4] - 18, y + 45);\n""",
    """      ctx.fillText(money(item.lineTotal ?? item.subtotal ?? item.total ?? (item.quantity * item.unitPrice)), columns[4] - 18, y + 45);\n""",
    'quotation canvas historical total'
)
replace_once(
    'src/components/sales/QuotationPreview.tsx',
    """                      <td className=\"p-3 text-center font-bold text-zinc-800\">{item.quantity}</td>\n                      <td className=\"p-3 text-right text-zinc-600\">UGX {(item.unitPrice || 0).toLocaleString()}</td>\n                      <td className=\"p-3 text-right font-bold text-zinc-900\">UGX {(item.quantity * item.unitPrice).toLocaleString()}</td>\n""",
    """                      <td className=\"p-3 text-center font-bold text-zinc-800\">{quotationQuantityText(buildQuotationLineSnapshot(item))}</td>\n                      <td className=\"p-3 text-right text-zinc-600\">UGX {(item.actualUnitPrice ?? item.unitPrice ?? 0).toLocaleString()}</td>\n                      <td className=\"p-3 text-right font-bold text-zinc-900\">UGX {Number(item.lineTotal ?? item.subtotal ?? item.total ?? (item.quantity * item.unitPrice)).toLocaleString()}</td>\n""",
    'quotation jsx tier quantity'
)

# Quotation log resolves quoted tier semantics against live stock/configuration.
replace_once(
    'src/components/sales/QuotationsLog.tsx',
    """import { QuotationPreview } from './QuotationPreview';\n""",
    """import { QuotationPreview } from './QuotationPreview';\nimport { buildResumedQuotationProductLine, buildResumedServiceLine } from '../../services/quotationTierService';\n""",
    'quotation resume service import'
)
replace_once(
    'src/components/sales/QuotationsLog.tsx',
    """  const [refetchedItems, setRefetchedItems] = useState<any[]>([]);\n""",
    """  const [refetchedItems, setRefetchedItems] = useState<any[]>([]);\n  const [hasBlockingWarnings, setHasBlockingWarnings] = useState(false);\n""",
    'quotation blocking warning state'
)
regex_replace_once(
    'src/components/sales/QuotationsLog.tsx',
    r"    try \{\n      for \(const line of item\.lineItems\) \{.*?      setRefetchedItems\(basketItems\);\n      setResumingQuotation\(item\);\n\n      if \(itemWarnings\.length > 0\) \{\n        setWarnings\(itemWarnings\);\n        setShowWarningModal\(true\);\n      \} else \{\n        // Direct conversion\n        loadBasketAndRedirect\(basketItems, item\);\n      \}",
    """    try {\n      let blockingFound = false;\n      for (const line of item.lineItems || []) {\n        if (line.isService) {\n          basketItems.push(buildResumedServiceLine(line));\n          continue;\n        }\n\n        const prodSnap = await getDoc(doc(db, 'products', line.productId));\n        if (!prodSnap.exists()) {\n          itemWarnings.push(`Product \\\"${line.productName}\\\" no longer exists in inventory.`);\n          blockingFound = true;\n          continue;\n        }\n        const product = { id: prodSnap.id, ...prodSnap.data() } as any;\n        const batchesSnap = await getDocs(\n          query(\n            collection(db, 'product_batches'),\n            where('tenantId', '==', profile.tenantId),\n            where('branchId', '==', activeBranchId),\n            where('productId', '==', line.productId),\n            where('batch_status', '==', 'active')\n          )\n        );\n        const batchesList = batchesSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];\n        const result = buildResumedQuotationProductLine({\n          line, product, batches: batchesList, systemSettings, settings: systemSettings,\n          tenantId: profile.tenantId, branchId: activeBranchId\n        } as any);\n        itemWarnings.push(...result.warnings);\n        if (result.blocking || !result.item) {\n          blockingFound = true;\n          continue;\n        }\n        basketItems.push(result.item);\n      }\n\n      setRefetchedItems(basketItems);\n      setResumingQuotation(item);\n      setHasBlockingWarnings(blockingFound);\n\n      if (itemWarnings.length > 0 || blockingFound) {\n        setWarnings(itemWarnings.length > 0 ? itemWarnings : ['One or more quotation lines cannot be resumed safely.']);\n        setShowWarningModal(true);\n      } else {\n        loadBasketAndRedirect(basketItems, item);\n      }""",
    'quotation tier-aware resume flow'
)
replace_once(
    'src/components/sales/QuotationsLog.tsx',
    """              <button \n                onClick={() => {\n                  setShowWarningModal(false);\n                  if (resumingQuotation) {\n                    loadBasketAndRedirect(refetchedItems, resumingQuotation);\n                  }\n                }} \n                className=\"px-4 py-2 bg-emerald-600 text-white font-bold rounded-lg text-xs hover:bg-emerald-700\"\n              >\n                Acknowledge & Continue\n              </button>\n""",
    """              <button \n                disabled={hasBlockingWarnings}\n                onClick={() => {\n                  setShowWarningModal(false);\n                  if (resumingQuotation && !hasBlockingWarnings) {\n                    loadBasketAndRedirect(refetchedItems, resumingQuotation);\n                  }\n                }} \n                className=\"px-4 py-2 bg-emerald-600 disabled:bg-zinc-300 disabled:cursor-not-allowed text-white font-bold rounded-lg text-xs hover:bg-emerald-700\"\n              >\n                {hasBlockingWarnings ? 'Resolve Blocking Changes' : 'Acknowledge & Continue'}\n              </button>\n""",
    'quotation blocking acknowledgement'
)
regex_replace_once(
    'src/components/sales/QuotationsLog.tsx',
    r"cart=\{previewQuotation\.lineItems\?\.map\(\(l: any\) => \(\{.*?\}\)\) \|\| \[\]\}",
    """cart={previewQuotation.lineItems?.map((l: any) => ({\n            ...l,\n            lineId: l.lineId,\n            quantity: l.commercialQuantity ?? l.qty,\n            commercialQuantity: l.commercialQuantity ?? l.qty,\n            unitPrice: l.actualUnitPrice ?? l.unitPrice,\n            actualUnitPrice: l.actualUnitPrice ?? l.unitPrice,\n            lineTotal: l.lineTotal ?? ((l.commercialQuantity ?? l.qty) * (l.actualUnitPrice ?? l.unitPrice))\n          })) || []}""",
    'quotation historical preview snapshot'
)

# Sales quotation gate and ledger identity/edit semantics.
replace_once(
    'src/pages/Sales.tsx',
    """                    disabled={cart.length === 0 || cart.some(item => !item.isService && Boolean(item.tierCode))}\n                    title={cart.some(item => !item.isService && Boolean(item.tierCode)) ? 'Multi-tier quotations will be enabled in the quotation integration phase.' : undefined}\n""",
    """                    disabled={cart.length === 0}\n""",
    'enable tier quotations'
)
regex_replace_once(
    'src/pages/Sales.tsx',
    r"  const updateLedgerItemQuantity = \(productId: string, batchNumber: string \| undefined, delta: number\) => \{.*?  const addProductToLedgerEdit = \(product: Product\) => \{",
    """  const matchesLedgerLine = (item: SaleItem, lineId: string | undefined, productId: string, batchNumber: string | undefined) =>\n    lineId && item.lineId ? item.lineId === lineId : item.productId === productId && (item.isService || item.batchNumber === batchNumber);\n\n  const updateLedgerItemQuantity = (lineId: string | undefined, productId: string, batchNumber: string | undefined, delta: number) => {\n    setEditedItems(prev => prev.map(item => {\n      if (!matchesLedgerLine(item, lineId, productId, batchNumber)) return item;\n      const newQty = Math.max(1, Number(item.quantity || 0) + delta);\n      const lineTotal = newQty * Number(item.unitPrice || 0);\n      return {\n        ...item,\n        quantity: newQty,\n        commercialQuantity: item.tierCode ? newQty : item.commercialQuantity,\n        baseQuantity: item.tierCode && item.tierMultiplier ? newQty * Number(item.tierMultiplier) : item.baseQuantity,\n        subtotal: lineTotal, total: lineTotal, lineTotal\n      };\n    }));\n  };\n\n  const updateLedgerItemPrice = (lineId: string | undefined, productId: string, batchNumber: string | undefined, newPrice: number) => {\n    setEditedItems(prev => prev.map(item => {\n      if (!matchesLedgerLine(item, lineId, productId, batchNumber)) return item;\n      const lineTotal = Number(item.quantity || 0) * newPrice;\n      return {\n        ...item,\n        unitPrice: newPrice,\n        actualUnitPrice: item.tierCode ? newPrice : item.actualUnitPrice,\n        priceSource: item.tierCode ? (newPrice === Number(item.configuredPrice) ? 'configured-tier' : 'manual-override') : item.priceSource,\n        subtotal: lineTotal, total: lineTotal, lineTotal\n      };\n    }));\n  };\n\n  const removeLedgerItem = (lineId: string | undefined, productId: string, batchNumber: string | undefined) => {\n    setEditedItems(prev => prev.filter(item => !matchesLedgerLine(item, lineId, productId, batchNumber)));\n  };\n\n  const addProductToLedgerEdit = (product: Product, requestedTierCode?: SellingTierCode) => {""",
    'ledger stable line edit functions'
)
regex_replace_once(
    'src/pages/Sales.tsx',
    r"  const addProductToLedgerEdit = \(product: Product, requestedTierCode\?: SellingTierCode\) => \{.*?    toast\.success\(`Added \$\{product\.name\} to the list`\);\n  \};",
    """  const addProductToLedgerEdit = (product: Product, requestedTierCode?: SellingTierCode) => {\n    const resolution = resolveSellingTiers(product, systemSettings);\n    if (resolution.mode === 'multi-tier') {\n      const tier = requestedTierCode\n        ? resolution.tiers.find(candidate => candidate.code === requestedTierCode)\n        : resolution.defaultTier;\n      if (!tier) {\n        toast.error('The selected selling tier is not available.');\n        return;\n      }\n      if (editedItems.some(item => item.productId === product.id && item.tierCode === tier.code)) {\n        toast.info(`${product.name} ${tier.label} is already in the receipt.`);\n        return;\n      }\n      const editBranchId = ledgerEditingSale?.branchId || activeBranchId;\n      if (!profile?.tenantId || !editBranchId) {\n        toast.error('A tenant and branch are required before adding this line.');\n        return;\n      }\n      try {\n        const newItem = buildTierCartItem({ product, tier, batches, tenantId: profile.tenantId, branchId: editBranchId, commercialQuantity: 1 });\n        setEditedItems(prev => [...prev, newItem]);\n        setLedgerEditSearchTerm('');\n        toast.success(`Added ${product.name} ${tier.label} to the list`);\n      } catch (error) {\n        toast.error(error instanceof Error ? error.message : 'Unable to add tier line.');\n      }\n      return;\n    }\n\n    const existing = editedItems.find(item => item.productId === product.id && !item.tierCode);\n    if (existing) {\n      toast.info(`${product.name} is already in the receipt!`);\n      return;\n    }\n    const productBatches = batches\n      .filter(b => b.productId === product.id && b.quantity > 0)\n      .sort((a, b) => new Date(a.expiryDate || '9999-12-31').getTime() - new Date(b.expiryDate || '9999-12-31').getTime());\n    const oldestBatch = productBatches[0];\n    if (!oldestBatch) {\n      toast.error(`${product.name} has no available stock.`);\n      return;\n    }\n    const multiplier = product.unitOfSell === 'pack' ? (product.unitsPerPack || 1) :\n      product.unitOfSell === 'strip' ? (product.unitsPerStrip || 1) : 1;\n    const unitPrice = oldestBatch ? oldestBatch.sellingPrice * multiplier : (product.sellingPricePerUnit || 0);\n    const costPrice = oldestBatch ? oldestBatch.purchasePrice * multiplier : (product.costPricePerPack || 0);\n    const newItem: SaleItem = {\n      productId: product.id, batchId: oldestBatch.id || '', name: product.name, productName: product.name,\n      genericName: product.genericName, quantity: 1, unitPrice, total: unitPrice, subtotal: unitPrice, costPrice,\n      isService: false, batchNumber: oldestBatch.batchNumber, expiryDate: oldestBatch.expiryDate\n    };\n    setEditedItems(prev => [...prev, newItem]);\n    setLedgerEditSearchTerm('');\n    toast.success(`Added ${product.name} to the list`);\n  };""",
    'ledger tier-aware add product'
)
replace_once(
    'src/pages/Sales.tsx',
    """                                  onClick={() => updateLedgerItemQuantity(item.productId, item.batchNumber, -1)}\n""",
    """                                  onClick={() => updateLedgerItemQuantity(item.lineId, item.productId, item.batchNumber, -1)}\n""",
    'ledger decrement line identity'
)
replace_once(
    'src/pages/Sales.tsx',
    """                                    updateLedgerItemQuantity(item.productId, item.batchNumber, delta);\n""",
    """                                    updateLedgerItemQuantity(item.lineId, item.productId, item.batchNumber, delta);\n""",
    'ledger input line identity'
)
replace_once(
    'src/pages/Sales.tsx',
    """                                  onClick={() => updateLedgerItemQuantity(item.productId, item.batchNumber, 1)}\n""",
    """                                  onClick={() => updateLedgerItemQuantity(item.lineId, item.productId, item.batchNumber, 1)}\n""",
    'ledger increment line identity'
)
replace_once(
    'src/pages/Sales.tsx',
    """                                  onChange={(e) => updateLedgerItemPrice(item.productId, item.batchNumber, parseInt(e.target.value) || 0)}\n""",
    """                                  onChange={(e) => updateLedgerItemPrice(item.lineId, item.productId, item.batchNumber, parseInt(e.target.value) || 0)}\n""",
    'ledger price line identity'
)
replace_once(
    'src/pages/Sales.tsx',
    """                                onClick={() => removeLedgerItem(item.productId, item.batchNumber)}\n""",
    """                                onClick={() => removeLedgerItem(item.lineId, item.productId, item.batchNumber)}\n""",
    'ledger remove line identity'
)
replace_once(
    'src/pages/Sales.tsx',
    """                                  {item.isService ? 'Standard Service' : `Batch: ${item.batchNumber || 'N/A'}`}\n""",
    """                                  {item.isService ? 'Standard Service' : item.tierCode ? `${item.tierLabel || item.tierCode} • ${item.baseQuantity ?? 0} base units • ${item.batchAllocations?.length || 0} allocation${item.batchAllocations?.length === 1 ? '' : 's'}` : `Batch: ${item.batchNumber || 'N/A'}`}\n""",
    'ledger tier history display'
)
