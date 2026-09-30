from pathlib import Path
import runpy

runpy.run_path('scripts/apply-phase1-ui-docs.py', run_name='__main__')

invoice_path = Path('src/components/sales/A4InvoiceTemplate.tsx')
invoice = invoice_path.read_text()
old = "let branchName = String(sale.branchName || '').trim();"
new = "let branchName = String((sale as Sale & { branchName?: string }).branchName || '').trim();"
if invoice.count(old) != 1:
    raise SystemExit(f'branchName typing repair: expected exactly one match, found {invoice.count(old)}')
invoice_path.write_text(invoice.replace(old, new, 1))
