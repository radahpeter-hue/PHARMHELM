from pathlib import Path

path = Path('src/pages/Sales.tsx')
text = path.read_text()
old = """        additionalCartItems.push({
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
        } as SaleItem);"""
new = """        additionalCartItems.push({
          productId,
          batchId: batch.id,
          name: currentCartItem.productName || currentCartItem.name || productId,
          productName: currentCartItem.productName,
          genericName: currentCartItem.genericName,
          batchNumber: batch.batchNumber,
          expiryDate: batch.expiryDate,
          quantity: qtyToTake,
          unitPrice,
          total: qtyToTake * unitPrice,
          costPrice: batch.purchasePrice * multiplier,
          subtotal: qtyToTake * unitPrice,
          isService: false
        });"""
if old not in text:
    raise SystemExit('Generated legacy SaleItem anchor not found')
path.write_text(text.replace(old, new, 1))
