from pathlib import Path

sales_path = Path('src/pages/Sales.tsx')
sales = sales_path.read_text()

old_sale_item = """        additionalCartItems.push({
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
new_sale_item = """        additionalCartItems.push({
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
if old_sale_item in sales:
    sales = sales.replace(old_sale_item, new_sale_item, 1)
elif new_sale_item not in sales:
    raise SystemExit('Legacy SaleItem completion anchor not found')

old_quote_button = """                  <button 
                    type="button"
                    onClick={() => setShowQuotationModal(true)}
                    disabled={cart.length === 0}
                    className="w-full sm:w-auto px-6 py-4 bg-zinc-100 hover:bg-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400 text-zinc-700 rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                  >"""
new_quote_button = """                  <button 
                    type="button"
                    onClick={() => setShowQuotationModal(true)}
                    disabled={cart.length === 0 || cart.some(item => !item.isService && Boolean(item.tierCode))}
                    title={cart.some(item => !item.isService && Boolean(item.tierCode)) ? 'Multi-tier quotations will be enabled in the quotation integration phase.' : undefined}
                    className="w-full sm:w-auto px-6 py-4 bg-zinc-100 hover:bg-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400 text-zinc-700 rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                  >"""
if old_quote_button in sales:
    sales = sales.replace(old_quote_button, new_quote_button, 1)
elif new_quote_button not in sales:
    raise SystemExit('Quotation boundary anchor not found')

sales_path.write_text(sales)

product_path = Path('src/components/inventory/ProductModal.tsx')
product_modal = product_path.read_text()
old_strip_gate = "{(formData.dosageForm === 'Tablet' || formData.dosageForm === 'Capsule') && ("
new_strip_gate = "{tierEligibility.eligible && ("
if old_strip_gate in product_modal:
    product_modal = product_modal.replace(old_strip_gate, new_strip_gate, 1)
elif new_strip_gate not in product_modal:
    raise SystemExit('Eligible Strip selector anchor not found')
product_path.write_text(product_modal)
