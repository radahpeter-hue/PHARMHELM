from pathlib import Path

BASE = '944c571e4f547904697e781c135c4fdd1f2e3c36'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


def replace_between(text: str, start: str, end: str, replacement: str, label: str) -> str:
    i = text.find(start)
    if i < 0:
        raise SystemExit(f'{label}: start marker not found')
    j = text.find(end, i)
    if j < 0:
        raise SystemExit(f'{label}: end marker not found')
    return text[:i] + replacement + text[j:]


helper = """import type { Sale } from '../types';

export const getReceiptLedgerReference = (sale: Sale): string => {
  const receiptNumber = String(sale.receiptNumber || '').trim();
  if (receiptNumber) return receiptNumber;
  const suffix = String(sale.id || '').slice(-8).toUpperCase();
  return suffix ? `REF-${suffix}` : 'Reference unavailable';
};

export const getSaleIdentityLabel = (sale: Sale): string => {
  const institutionName = String(sale.institutionName || '').trim();
  if (institutionName) return institutionName;

  const patientName = String(sale.patientName || '').trim();
  if (patientName) return patientName;

  return sale.context === 'walk-in' ? 'Anonymous' : 'Identity not recorded';
};

export const matchesReceiptLedgerSearch = (sale: Sale, searchTerm: string): boolean => {
  const query = searchTerm.trim().toLowerCase();
  if (!query) return true;

  return [sale.receiptNumber, sale.patientName, sale.institutionName]
    .some(value => String(value || '').toLowerCase().includes(query));
};
"""
Path('src/utils/salePresentation.ts').write_text(helper)

sales_path = Path('src/pages/Sales.tsx')
sales = sales_path.read_text()
sales = replace_once(
    sales,
    "import { canOperatePos, formatPosCheckoutError } from '../utils/posAuthorization';\n",
    "import { canOperatePos, formatPosCheckoutError } from '../utils/posAuthorization';\nimport { getReceiptLedgerReference, getSaleIdentityLabel, matchesReceiptLedgerSearch } from '../utils/salePresentation';\n",
    'Sales helper import'
)
sales = replace_once(
    sales,
    "  const filteredSales = sales.filter(sale => {\n    const matchesSearch = sale.id.toLowerCase().includes(searchTerm.toLowerCase()) ||\n                         (sale.receiptNumber || '').toLowerCase().includes(searchTerm.toLowerCase());\n",
    "  const filteredSales = sales.filter(sale => {\n    const matchesSearch = matchesReceiptLedgerSearch(sale, searchTerm);\n",
    'ledger search'
)
sales = replace_once(
    sales,
    'placeholder="Search by receipt ID or patient..."',
    'placeholder="Search by receipt number, patient or institution..."',
    'ledger search placeholder'
)
sales = replace_once(
    sales,
    '<span className="font-mono text-xs font-bold text-zinc-900">{sale.id.slice(0, 8).toUpperCase()}</span>',
    '<span className="font-mono text-xs font-bold text-zinc-900">{getReceiptLedgerReference(sale)}</span>',
    'ledger receipt cell'
)
sales = replace_once(
    sales,
    '<span className="text-sm font-medium text-zinc-900">{sale.receiptNumber}</span>\n                        <span className="text-xs text-zinc-400 uppercase tracking-tighter">{sale.context}</span>',
    '<span className="text-sm font-medium text-zinc-900">{getSaleIdentityLabel(sale)}</span>\n                        <span className="text-xs text-zinc-400 uppercase tracking-tighter">{sale.context}</span>',
    'ledger identity cell'
)
sales = replace_once(
    sales,
    '<div className="lg:col-span-4 flex flex-col gap-6 overflow-hidden min-h-0">',
    '<div className="lg:col-span-4 flex flex-col gap-6 overflow-visible lg:overflow-hidden min-h-0">',
    'right column containment'
)
sales = replace_once(
    sales,
    '<div className="bg-white p-5 rounded-3xl border border-zinc-200/90 shadow-lg shadow-zinc-100/10 space-y-4 relative">',
    '<div className="bg-white p-5 rounded-3xl border border-zinc-200/90 shadow-lg shadow-zinc-100/10 space-y-4 relative shrink-0 lg:max-h-[48%] lg:overflow-y-auto custom-scrollbar">',
    'context card desktop bound'
)
sales = replace_once(
    sales,
    '<div className="flex-1 bg-white rounded-3xl border border-zinc-200/95 shadow-xl shadow-zinc-100/10 flex flex-col overflow-hidden">',
    '<div className="flex-1 min-h-0 bg-white rounded-3xl border border-zinc-200/95 shadow-xl shadow-zinc-100/10 flex flex-col overflow-hidden">',
    'catalog min height'
)
sales = replace_once(
    sales,
    '<div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar min-h-[250px]">',
    '<div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar min-h-[250px] lg:min-h-0">',
    'catalog independent scroll'
)
sales_path.write_text(sales)

invoice_path = Path('src/components/sales/A4InvoiceTemplate.tsx')
invoice = invoice_path.read_text()
invoice = replace_once(
    invoice,
    "  const [receipt, setReceipt] = useState<Sale | null>(null);\n  const [loading, setLoading] = useState(false);\n",
    "  const [receipt, setReceipt] = useState<Sale | null>(null);\n  const [loading, setLoading] = useState(false);\n  const [resolvedBranchName, setResolvedBranchName] = useState('Branch not available');\n",
    'invoice branch state'
)
invoice = replace_once(
    invoice,
    "          if (docSnap.exists()) {\n            setReceipt({ id: docSnap.id, ...docSnap.data() } as Sale);\n          } else {",
    "          if (docSnap.exists()) {\n            const sale = { id: docSnap.id, ...docSnap.data() } as Sale;\n            setReceipt(sale);\n\n            let branchName = String(sale.branchName || '').trim();\n            if (!branchName && sale.branchId) {\n              try {\n                const branchSnap = await getDoc(doc(db, 'branches', sale.branchId));\n                if (branchSnap.exists()) {\n                  const branchData = branchSnap.data();\n                  const sameTenant = !sale.tenantId || branchData.tenantId === sale.tenantId;\n                  if (sameTenant) branchName = String(branchData.name || '').trim();\n                }\n              } catch (branchError) {\n                console.warn('Invoice branch lookup failed:', branchError);\n              }\n            }\n            if (!branchName && sale.branchId && activeBranch?.id === sale.branchId) {\n              branchName = String(activeBranch?.name || '').trim();\n            }\n            setResolvedBranchName(branchName || 'Branch not available');\n          } else {",
    'invoice receipt/branch fetch'
)
invoice = replace_once(
    invoice,
    "  }, [isOpen, receiptId, onClose]);",
    "  }, [isOpen, receiptId, onClose, activeBranch?.id, activeBranch?.name]);",
    'invoice effect deps'
)

pdf_block = """  const waitForInvoiceAssets = async (element: HTMLElement) => {
    const fontSet = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    if (fontSet?.ready) await fontSet.ready;

    const images = Array.from(element.querySelectorAll('img'));
    await Promise.all(images.map(image => new Promise<void>(resolve => {
      if (image.complete) {
        resolve();
        return;
      }
      const finish = () => resolve();
      image.addEventListener('load', finish, { once: true });
      image.addEventListener('error', finish, { once: true });
      window.setTimeout(finish, 3000);
    })));
  };

  const renderInvoiceCanvas = (element: HTMLElement, ignoreImages = false) => html2canvas(element, {
    scale: Math.min(2, Math.max(1, window.devicePixelRatio || 1)),
    useCORS: true,
    allowTaint: false,
    backgroundColor: '#ffffff',
    logging: false,
    imageTimeout: 4000,
    scrollX: 0,
    scrollY: -window.scrollY,
    windowWidth: Math.max(element.scrollWidth, 790),
    windowHeight: Math.max(element.scrollHeight, element.clientHeight),
    ignoreElements: ignoreImages ? node => node.tagName === 'IMG' : undefined
  });

  const handleDownloadPDF = async () => {
    const element = document.getElementById('a4-invoice-container');
    if (!element) return;

    try {
      await waitForInvoiceAssets(element);

      let canvas: HTMLCanvasElement;
      try {
        canvas = await renderInvoiceCanvas(element);
      } catch (firstRenderError) {
        console.warn('Invoice PDF render with images failed; retrying without external images.', firstRenderError);
        canvas = await renderInvoiceCanvas(element, true);
      }

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
      const pageWidth = 210;
      const pageHeight = 297;
      const margin = 10;
      const printableWidth = pageWidth - (margin * 2);
      const printableHeight = pageHeight - (margin * 2);
      const imgHeight = (canvas.height * printableWidth) / canvas.width;

      let renderedHeight = 0;
      let pageIndex = 0;
      do {
        if (pageIndex > 0) pdf.addPage();
        const y = margin - renderedHeight;
        pdf.addImage(imgData, 'JPEG', margin, y, printableWidth, imgHeight, undefined, 'FAST');
        renderedHeight += printableHeight;
        pageIndex += 1;
      } while (renderedHeight < imgHeight);

      const pdfBlob = pdf.output('blob');
      const objectUrl = URL.createObjectURL(pdfBlob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `Invoice_${receipt.receiptNumber || 'receipt'}.pdf`;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
      toast.success('Invoice PDF downloaded.');
    } catch (e) {
      console.error('Invoice PDF export failed:', e);
      toast.error('Failed to generate PDF. You can still use Print A4.');
    }
  };

"""
invoice = replace_between(
    invoice,
    '  const handleDownloadPDF = async () => {',
    '  return (',
    pdf_block,
    'PDF export block'
)
invoice = replace_once(
    invoice,
    "{receipt.branchName || 'Main Store'}",
    '{resolvedBranchName}',
    'invoice branch display'
)
invoice_path.write_text(invoice)

package_path = Path('package.json')
package = package_path.read_text()
package = replace_once(
    package,
    '    "lint": "tsc --noEmit",\n    "test":',
    '    "lint": "tsc --noEmit",\n    "typecheck": "tsc --noEmit",\n    "test":',
    'typecheck script'
)
package_path.write_text(package)

tests = """import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getReceiptLedgerReference, getSaleIdentityLabel, matchesReceiptLedgerSearch } from '../src/utils/salePresentation';

const salesSource = readFileSync(new URL('../src/pages/Sales.tsx', import.meta.url), 'utf8');
const invoiceSource = readFileSync(new URL('../src/components/sales/A4InvoiceTemplate.tsx', import.meta.url), 'utf8');

const sale = (overrides: Record<string, unknown> = {}) => ({
  id: 'V2SALE_Z_internal_12345678',
  receiptNumber: 'BR-3QLNF-2026-000123',
  context: 'walk-in',
  items: [],
  subtotal: 0,
  total: 0,
  totalAmount: 0,
  discountAmount: 0,
  paymentMethod: 'cash',
  timestamp: new Date().toISOString(),
  status: 'completed',
  ...overrides
}) as any;

test('Receipt Ledger displays receiptNumber as the receipt reference', () => {
  assert.equal(getReceiptLedgerReference(sale()), 'BR-3QLNF-2026-000123');
  assert.ok(salesSource.includes('{getReceiptLedgerReference(sale)}'));
});

test('Receipt Ledger fallback is readable and does not expose the V2 prefix', () => {
  assert.equal(getReceiptLedgerReference(sale({ receiptNumber: '' })), 'REF-12345678');
});

test('Institutional sale displays institutionName first', () => {
  assert.equal(getSaleIdentityLabel(sale({ context: 'institutional', institutionName: 'Mulago Hospital', patientName: 'Patient A' })), 'Mulago Hospital');
});

test('Named patient sale displays patientName', () => {
  assert.equal(getSaleIdentityLabel(sale({ patientName: 'Jane Doe' })), 'Jane Doe');
});

test('Anonymous walk-in displays Anonymous', () => {
  assert.equal(getSaleIdentityLabel(sale({ patientName: null, institutionName: null })), 'Anonymous');
});

test('Non-walk-in without an identity shows the missing identity warning', () => {
  assert.equal(getSaleIdentityLabel(sale({ context: 'telepharmacy', patientName: null, institutionName: null })), 'Identity not recorded');
});

test('Receipt Ledger search matches receiptNumber', () => {
  assert.equal(matchesReceiptLedgerSearch(sale(), '000123'), true);
});

test('Receipt Ledger search matches institutionName', () => {
  assert.equal(matchesReceiptLedgerSearch(sale({ institutionName: 'Mengo Hospital' }), 'mengo'), true);
});

test('Receipt Ledger search matches patientName', () => {
  assert.equal(matchesReceiptLedgerSearch(sale({ patientName: 'Peter Kato' }), 'kato'), true);
});

test('A4 invoice resolves correct branch and never uses false Main Store fallback', () => {
  assert.ok(invoiceSource.includes("getDoc(doc(db, 'branches', sale.branchId))"));
  assert.ok(invoiceSource.includes("activeBranch?.id === sale.branchId"));
  assert.ok(invoiceSource.includes("setResolvedBranchName(branchName || 'Branch not available')"));
  assert.equal(invoiceSource.includes("receipt.branchName || 'Main Store'"), false);
  assert.ok(invoiceSource.includes('{resolvedBranchName}'));
});

test('A4 PDF export has asset wait, image-free retry, blob download and print fallback', () => {
  assert.ok(invoiceSource.includes('waitForInvoiceAssets(element)'));
  assert.ok(invoiceSource.includes('renderInvoiceCanvas(element, true)'));
  assert.ok(invoiceSource.includes("pdf.output('blob')"));
  assert.ok(invoiceSource.includes('You can still use Print A4'));
});

test('Institutional desktop layout retains an independently scrollable product region', () => {
  assert.ok(salesSource.includes('lg:max-h-[48%] lg:overflow-y-auto custom-scrollbar'));
  assert.ok(salesSource.includes('flex-1 min-h-0 bg-white rounded-3xl'));
  assert.ok(salesSource.includes('min-h-[250px] lg:min-h-0'));
});
"""
Path('tests/pos-phase1-ui-docs.test.ts').write_text(tests)
