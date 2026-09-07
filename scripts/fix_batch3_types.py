from pathlib import Path

path = Path('src/pages/Sales.tsx')
text = path.read_text()
old = "        const uniqueProductIds = Array.from(new Set(stockItems.map(item => item.productId)));"
new = "        const uniqueProductIds: string[] = Array.from(new Set<string>(stockItems.map(item => String(item.productId))));"
if old not in text:
    raise RuntimeError('Batch 3 TypeScript target not found')
path.write_text(text.replace(old, new, 1))
print('Fixed Batch 3 uniqueProductIds typing')
