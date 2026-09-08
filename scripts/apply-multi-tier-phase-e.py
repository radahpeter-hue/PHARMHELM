from pathlib import Path


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


replace_once(
    'src/services/saleInventoryRevisionPlanner.ts',
    """    const commercialQuantity = getStoredCommercialQuantity(item);\n    if (!Number.isInteger(commercialQuantity) || commercialQuantity <= 0) {\n      throw new Error(`${item.productName || item.name || product.name} must have a positive whole commercial quantity.`);\n    }\n    const targetBaseQuantity = getStoredBaseQuantity({ ...item, baseQuantity: undefined } as SaleItem, product);\n    if (!Number.isFinite(targetBaseQuantity) || targetBaseQuantity <= 0) throw new Error(`${product.name} has an invalid revised base quantity.`);\n""",
    """    const commercialQuantity = Number(item.quantity ?? item.commercialQuantity ?? 0);\n    if (!Number.isInteger(commercialQuantity) || commercialQuantity <= 0) {\n      throw new Error(`${item.productName || item.name || product.name} must have a positive whole commercial quantity.`);\n    }\n    const storedMultiplier = Number(item.tierMultiplier || 0);\n    const legacyUnit = String(product.unitOfSell || product.unit || '').trim().toLowerCase();\n    const legacyMultiplier = legacyUnit === 'pack'\n      ? Math.max(1, Number(product.unitsPerPack || 1))\n      : legacyUnit === 'strip'\n        ? Math.max(1, Number(product.unitsPerStrip || 1))\n        : 1;\n    const multiplier = Number.isFinite(storedMultiplier) && storedMultiplier > 0 ? storedMultiplier : legacyMultiplier;\n    const targetBaseQuantity = commercialQuantity * multiplier;\n    if (!Number.isFinite(targetBaseQuantity) || targetBaseQuantity <= 0) throw new Error(`${product.name} has an invalid revised base quantity.`);\n""",
    'revision quantity authority'
)
