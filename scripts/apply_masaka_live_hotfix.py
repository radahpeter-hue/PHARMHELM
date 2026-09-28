from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"Expected patch anchor not found in {path}: {old[:120]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"Patch anchor is not unique in {path}: found {text.count(old)}")
    p.write_text(text.replace(old, new, 1))


def ensure_file(path: str, content: str) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)


# 1. POS branch card must use authoritative active branch and no generic Main Branch fallback.
replace_once(
    "src/pages/Sales.tsx",
    "{profile?.branch || 'Main Branch'}",
    "{activeBranch?.name || 'No branch selected'}",
)

# 2. Shared Firestore undefined pruning helper.
ensure_file(
    "src/utils/firestoreData.ts",
    """function isPlainObject(value: unknown): value is Record<string, unknown> {\n  if (!value || typeof value !== 'object') return false;\n  const prototype = Object.getPrototypeOf(value);\n  return prototype === Object.prototype || prototype === null;\n}\n\nexport function omitUndefinedDeep<T>(value: T): T {\n  if (Array.isArray(value)) {\n    return value\n      .filter(entry => entry !== undefined)\n      .map(entry => omitUndefinedDeep(entry)) as T;\n  }\n\n  if (!isPlainObject(value)) return value;\n\n  const result: Record<string, unknown> = {};\n  for (const [key, entry] of Object.entries(value)) {\n    if (entry === undefined) continue;\n    result[key] = omitUndefinedDeep(entry);\n  }\n  return result as T;\n}\n""",
)

# 3. Shared safe date normalization for ISO strings, Date, Firestore Timestamp/toDate and timestamp-shaped values.
ensure_file(
    "src/utils/dateValue.ts",
    """import { format } from 'date-fns';\n\ntype TimestampLike = {\n  toDate?: () => Date;\n  seconds?: number;\n  nanoseconds?: number;\n};\n\nexport function normalizeDateValue(value: unknown): Date | null {\n  if (value === null || value === undefined || value === '') return null;\n\n  if (value instanceof Date) {\n    return Number.isNaN(value.getTime()) ? null : value;\n  }\n\n  if (typeof value === 'string' || typeof value === 'number') {\n    const parsed = new Date(value);\n    return Number.isNaN(parsed.getTime()) ? null : parsed;\n  }\n\n  if (typeof value === 'object') {\n    const timestamp = value as TimestampLike;\n    if (typeof timestamp.toDate === 'function') {\n      try {\n        const parsed = timestamp.toDate();\n        return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;\n      } catch {\n        return null;\n      }\n    }\n\n    if (typeof timestamp.seconds === 'number') {\n      const milliseconds = timestamp.seconds * 1000 + Math.floor((timestamp.nanoseconds || 0) / 1_000_000);\n      const parsed = new Date(milliseconds);\n      return Number.isNaN(parsed.getTime()) ? null : parsed;\n    }\n  }\n\n  return null;\n}\n\nexport function formatDateValue(value: unknown, pattern: string, fallback = 'Invalid date'): string {\n  const parsed = normalizeDateValue(value);\n  return parsed ? format(parsed, pattern) : fallback;\n}\n""",
)

# 4. POS V2 repository: preserve atomicity but sanitize every canonical write and normalize batch expiry.
replace_once(
    "src/services/pos-v2/posCheckoutV2Repository.ts",
    "import { db } from '../../firebase';\n",
    "import { db } from '../../firebase';\nimport { omitUndefinedDeep } from '../../utils/firestoreData';\nimport { normalizeDateValue } from '../../utils/dateValue';\n",
)
replace_once(
    "src/services/pos-v2/posCheckoutV2Repository.ts",
    "        expiryDate: batch.expiryDate,",
    "        expiryDate: normalizeDateValue(batch.expiryDate)?.toISOString() ?? null,",
)
replace_once(
    "src/services/pos-v2/posCheckoutV2Repository.ts",
    "    transaction.set(prepared.saleRef, {\n      ...sale,\n      engineVersion: 2,\n      integrityVersion: 3,\n      checkoutAttemptId: request.attemptId,\n      checkoutIntentFingerprint: prepared.fingerprint,",
    "    transaction.set(prepared.saleRef, omitUndefinedDeep({\n      ...sale,\n      engineVersion: 2,\n      integrityVersion: 3,\n      checkoutAttemptId: request.attemptId,\n      checkoutIntentFingerprint: prepared.fingerprint,",
)
replace_once(
    "src/services/pos-v2/posCheckoutV2Repository.ts",
    "      v2CompletedAt: serverTimestamp()\n    });\n\n    transaction.set(prepared.paymentRef, {\n      ...payment,\n      createdAt: serverTimestamp(),\n      updatedAt: serverTimestamp()\n    });\n\n    transaction.set(prepared.outboxRef, {\n      ...outboxEvent,",
    "      v2CompletedAt: serverTimestamp()\n    }));\n\n    transaction.set(prepared.paymentRef, omitUndefinedDeep({\n      ...payment,\n      createdAt: serverTimestamp(),\n      updatedAt: serverTimestamp()\n    }));\n\n    transaction.set(prepared.outboxRef, omitUndefinedDeep({\n      ...outboxEvent,",
)
replace_once(
    "src/services/pos-v2/posCheckoutV2Repository.ts",
    "      lastAttemptAt: null,",
    "      lastAttemptAt: null,",
)
# Close the outbox wrapper at the unique processedAt/error block before attempt creation.
replace_once(
    "src/services/pos-v2/posCheckoutV2Repository.ts",
    "      errorMessage: null\n    });\n\n    const attempt: PosCheckoutV2AttemptRecord = {",
    "      errorMessage: null\n    }));\n\n    const attempt: PosCheckoutV2AttemptRecord = {",
)
replace_once(
    "src/services/pos-v2/posCheckoutV2Repository.ts",
    "    transaction.set(prepared.attemptRef, attempt);",
    "    transaction.set(prepared.attemptRef, omitUndefinedDeep(attempt));",
)

# 5. Product Stockcard: safe rendering and permission-gated adjustment control.
replace_once(
    "src/components/inventory/ProductStockcard.tsx",
    "import { format, subMonths } from 'date-fns';",
    "import { subMonths } from 'date-fns';\nimport { formatDateValue } from '../../utils/dateValue';",
)
replace_once(
    "src/components/inventory/ProductStockcard.tsx",
    "  const { profile, activeBranchId } = useAuth();",
    "  const { profile, activeBranchId, hasPermission } = useAuth();\n  const canOperateInventory = hasPermission('inventory', 'operate');",
)
replace_once(
    "src/components/inventory/ProductStockcard.tsx",
    "                            <button \n                              onClick={() => {\n                                setAdjustingBatch(batch);\n                                setAdjustmentQty(batch.quantity);\n                              }}\n                              className=\"p-2 bg-white border border-zinc-200 rounded-xl text-zinc-400 hover:text-emerald-600 hover:border-emerald-200 transition-all shadow-sm opacity-0 group-hover:opacity-100\"\n                            >\n                              <Edit3 size={14} />\n                            </button>",
    "                            {canOperateInventory && (\n                              <button \n                                onClick={() => {\n                                  setAdjustingBatch(batch);\n                                  setAdjustmentQty(batch.quantity);\n                                }}\n                                className=\"p-2 bg-white border border-zinc-200 rounded-xl text-zinc-400 hover:text-emerald-600 hover:border-emerald-200 transition-all shadow-sm opacity-0 group-hover:opacity-100\"\n                              >\n                                <Edit3 size={14} />\n                              </button>\n                            )}",
)
replace_once(
    "src/components/inventory/ProductStockcard.tsx",
    "{format(new Date(batch.expiryDate), 'MMM dd, yyyy')}",
    "{formatDateValue(batch.expiryDate, 'MMM dd, yyyy')}",
)
replace_once(
    "src/components/inventory/ProductStockcard.tsx",
    "{format(new Date(m.timestamp), 'MMM dd, HH:mm')}",
    "{formatDateValue(m.timestamp, 'MMM dd, HH:mm')}",
)
# Do not render adjustment modal for view-only users even if stale state somehow exists.
replace_once(
    "src/components/inventory/ProductStockcard.tsx",
    "{adjustingBatch && (",
    "{canOperateInventory && adjustingBatch && (",
)

# 6. Inventory page: use effective built-in RBAC permission and hide operational controls from view-only users.
replace_once(
    "src/pages/Inventory.tsx",
    "  const { profile, activeBranchId, activeBranch } = useAuth();",
    "  const { profile, activeBranchId, activeBranch, hasPermission } = useAuth();\n  const canOperateInventory = hasPermission('inventory', 'operate');",
)
replace_once(
    "src/pages/Inventory.tsx",
    "        {isCEO && (",
    "        {isCEO && canOperateInventory && (",
)
replace_once(
    "src/pages/Inventory.tsx",
    "        <TabButton \n          active={activeTab === 'stock'} \n          onClick={() => setActiveTab('stock')} \n          label=\"Stock Adjustments\" \n          icon={<Activity size={16} />} \n        />",
    "        {canOperateInventory && (\n          <TabButton \n            active={activeTab === 'stock'} \n            onClick={() => setActiveTab('stock')} \n            label=\"Stock Adjustments\" \n            icon={<Activity size={16} />} \n          />\n        )}",
)
replace_once(
    "src/pages/Inventory.tsx",
    "        {showOperational && (",
    "        {showOperational && canOperateInventory && (",
)
replace_once(
    "src/pages/Inventory.tsx",
    "                <button \n                  onClick={() => {\n                    setEditingProduct(null);\n                    setIsProductModalOpen(true);\n                  }}\n                  className=\"px-6 py-3 bg-zinc-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest flex items-center gap-2 hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-900/20 active:scale-95\"\n                >\n                  <Plus size={18} />\n                  Add Product\n                </button>",
    "                {canOperateInventory && (\n                  <button \n                    onClick={() => {\n                      setEditingProduct(null);\n                      setIsProductModalOpen(true);\n                    }}\n                    className=\"px-6 py-3 bg-zinc-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest flex items-center gap-2 hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-900/20 active:scale-95\"\n                  >\n                    <Plus size={18} />\n                    Add Product\n                  </button>\n                )}",
)
# Gate row action buttons without removing the row click/stockcard view.
replace_once(
    "src/pages/Inventory.tsx",
    "                          <div className=\"flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity\">",
    "                          {canOperateInventory && (\n                            <div className=\"flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity\">",
)
replace_once(
    "src/pages/Inventory.tsx",
    "                          </div>\n                        </td>\n                      </tr>",
    "                            </div>\n                          )}\n                        </td>\n                      </tr>",
)
replace_once(
    "src/pages/Inventory.tsx",
    "      {isProductModalOpen && (",
    "      {canOperateInventory && isProductModalOpen && (",
)
replace_once(
    "src/pages/Inventory.tsx",
    "        {activeTab === 'stock' && <StockManagementTab />}",
    "        {canOperateInventory && activeTab === 'stock' && <StockManagementTab />}",
)
replace_once(
    "src/pages/Inventory.tsx",
    "        {activeTab === 'operational' && <OperationalInventoryTab />}",
    "        {canOperateInventory && activeTab === 'operational' && <OperationalInventoryTab />}",
)

# 7. Regression tests: utilities plus source-contract assertions for the live regressions.
ensure_file(
    "tests/live-pos-inventory-regressions.test.ts",
    """import fs from 'node:fs';\nimport path from 'node:path';\nimport { describe, expect, it } from 'vitest';\nimport { omitUndefinedDeep } from '../src/utils/firestoreData';\nimport { formatDateValue, normalizeDateValue } from '../src/utils/dateValue';\n\nconst root = process.cwd();\nconst read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');\n\ndescribe('Masaka live POS and inventory regressions', () => {\n  it('normalizes Firestore Timestamp-like values and rejects invalid dates', () => {\n    const fromToDate = normalizeDateValue({ toDate: () => new Date('2027-01-31T00:00:00.000Z') });\n    expect(fromToDate?.toISOString()).toBe('2027-01-31T00:00:00.000Z');\n    expect(normalizeDateValue({ seconds: 1_800_000_000 })?.getTime()).toBe(1_800_000_000_000);\n    expect(normalizeDateValue('not-a-date')).toBeNull();\n    expect(formatDateValue('not-a-date', 'MMM dd, yyyy')).toBe('Invalid date');\n  });\n\n  it('removes undefined deeply while preserving null, Date and class instances', () => {\n    class Sentinel { constructor(public value: number) {} }\n    const date = new Date('2026-09-29T00:00:00.000Z');\n    const sentinel = new Sentinel(7);\n    const result = omitUndefinedDeep({\n      keep: null,\n      remove: undefined,\n      nested: { remove: undefined, keep: 1 },\n      array: [1, undefined, { remove: undefined, keep: 2 }],\n      date,\n      sentinel\n    });\n    expect(result).toEqual({ keep: null, nested: { keep: 1 }, array: [1, { keep: 2 }], date, sentinel });\n    expect(result.date).toBe(date);\n    expect(result.sentinel).toBe(sentinel);\n  });\n\n  it('uses the authoritative active branch in the POS card', () => {\n    const sales = read('src/pages/Sales.tsx');\n    expect(sales).toContain("activeBranch?.name || 'No branch selected'");\n    expect(sales).not.toContain("profile?.branch || 'Main Branch'");\n  });\n\n  it('separates inventory view access from operational controls', () => {\n    const inventory = read('src/pages/Inventory.tsx');\n    const stockcard = read('src/components/inventory/ProductStockcard.tsx');\n    expect(inventory).toContain("const canOperateInventory = hasPermission('inventory', 'operate')");\n    expect(inventory).toContain('{canOperateInventory && (');\n    expect(stockcard).toContain("const canOperateInventory = hasPermission('inventory', 'operate')");\n    expect(stockcard).toContain('canOperateInventory && adjustingBatch');\n  });\n\n  it('sanitizes POS V2 Firestore writes and normalizes batch expiry values', () => {\n    const repo = read('src/services/pos-v2/posCheckoutV2Repository.ts');\n    expect(repo).toContain('omitUndefinedDeep({');\n    expect(repo).toContain('omitUndefinedDeep(attempt)');\n    expect(repo).toContain('normalizeDateValue(batch.expiryDate)?.toISOString() ?? null');\n  });\n});\n""",
)

print('Masaka production hotfix patch applied successfully.')
