from pathlib import Path

path = Path('src/services/networkFulfilmentService.ts')
text = path.read_text()
old = '''  for (const transferDoc of activeTransfers) {
    const transfer = transferDoc.data() as any;
    const embeddedItems = Array.isArray(transfer.items) ? transfer.items : [];
    for (const item of embeddedItems) {
      if (item.product_id === productId) {
        transferQty += Math.max(0, Number(item.qty_dispatched ?? item.qty_requested ?? 0));
      }
    }

    const lineSnap = await getDocs(query(
      collection(db, 'transfer_invoice_lines'),
      where('tenantId', '==', tenantId),
      where('transfer_id', '==', transferDoc.id)
    ));
    lineSnap.forEach(lineDoc => {
      const line = lineDoc.data() as any;
      if (line.product_id === productId) {
        transferQty += Math.max(0, Number(line.qty_dispatched ?? line.qty_requested ?? 0));
      }
    });
  }
'''
new = '''  for (const transferDoc of activeTransfers) {
    const transfer = transferDoc.data() as any;
    const lineSnap = await getDocs(query(
      collection(db, 'transfer_invoice_lines'),
      where('tenantId', '==', tenantId),
      where('transfer_id', '==', transferDoc.id)
    ));

    // Separate line documents are the canonical representation in current transfer flows.
    // Fall back to embedded legacy items only when no canonical lines exist so commitments
    // are never counted twice for transfers that carry both representations.
    if (!lineSnap.empty) {
      lineSnap.forEach(lineDoc => {
        const line = lineDoc.data() as any;
        if (line.product_id === productId) {
          transferQty += Math.max(0, Number(line.qty_dispatched ?? line.qty_requested ?? 0));
        }
      });
    } else {
      const embeddedItems = Array.isArray(transfer.items) ? transfer.items : [];
      for (const item of embeddedItems) {
        if (item.product_id === productId) {
          transferQty += Math.max(0, Number(item.qty_dispatched ?? item.qty_requested ?? 0));
        }
      }
    }
  }
'''
if old not in text:
    raise SystemExit('Commitment correction target not found')
path.write_text(text.replace(old, new, 1))
print('patched: avoid duplicate transfer commitment counting')
