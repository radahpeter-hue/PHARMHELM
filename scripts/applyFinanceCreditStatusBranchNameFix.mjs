import fs from 'node:fs';

function replaceOnce(source, oldText, newText, label) {
  const count = source.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return source.replace(oldText, newText);
}

// Branch Ops: reconcile sale rows with authoritative credit_receivables state.
const financePath = 'src/pages/Finance.tsx';
let finance = fs.readFileSync(financePath, 'utf8');

finance = replaceOnce(
  finance,
`const BranchCreditView: React.FC = () => {
  const { profile, activeBranchId } = useAuth();
  const [sales, setSales] = useState<any[]>([]);
  const [dateRange, setDateRange] = useState({`,
`const BranchCreditView: React.FC = () => {
  const { profile, activeBranchId } = useAuth();
  const [sales, setSales] = useState<any[]>([]);
  const [receivables, setReceivables] = useState<any[]>([]);
  const [dateRange, setDateRange] = useState({`,
  'branch receivables state'
);

finance = replaceOnce(
  finance,
`  useEffect(() => {
    if (profile?.tenantId && activeBranchId) {
      const unsubscribe = firestoreService.subscribeToCollection('sales', profile.tenantId, (data: any[]) => {
        const filtered = data.filter(s => {
          const primaryMethod = s.paymentMethod;
          const secondaryMethod = s.secondaryPaymentMethod;
          const isCreditOrInsurance =
            primaryMethod === 'insurance' ||
            primaryMethod === 'institutional_credit' ||
            primaryMethod === 'credit' ||
            secondaryMethod === 'insurance' ||
            secondaryMethod === 'institutional_credit' ||
            secondaryMethod === 'credit';

          return s.branchId === activeBranchId && isCreditOrInsurance;
        });
        setSales(filtered);
      });
      return () => unsubscribe();
    }
  }, [profile?.tenantId, activeBranchId]);`,
`  useEffect(() => {
    if (profile?.tenantId && activeBranchId) {
      const unsubscribeSales = firestoreService.subscribeToCollection('sales', profile.tenantId, (data: any[]) => {
        const filtered = data.filter(s => {
          const primaryMethod = s.paymentMethod;
          const secondaryMethod = s.secondaryPaymentMethod;
          const isCreditOrInsurance =
            primaryMethod === 'insurance' ||
            primaryMethod === 'institutional_credit' ||
            primaryMethod === 'credit' ||
            secondaryMethod === 'insurance' ||
            secondaryMethod === 'institutional_credit' ||
            secondaryMethod === 'credit';

          return s.branchId === activeBranchId && isCreditOrInsurance;
        });
        setSales(filtered);
      });

      // Settlement status is authoritative in credit_receivables, not the immutable POS sale.
      const unsubscribeReceivables = firestoreService.subscribeToCollection('credit_receivables', profile.tenantId, (data: any[]) => {
        setReceivables(data.filter(r => (r.branch_id || r.branchId) === activeBranchId));
      });

      return () => {
        unsubscribeSales();
        unsubscribeReceivables();
      };
    }
  }, [profile?.tenantId, activeBranchId]);`,
  'branch subscriptions'
);

finance = replaceOnce(
  finance,
`              const amount = credit.total || credit.totalAmount || 0;
              const status = credit.creditStatus || 'Unpaid';`,
`              const amount = credit.total || credit.totalAmount || 0;
              const receivable = receivables.find((r: any) =>
                r.id === credit.id ||
                r.receipt_id === credit.id ||
                r.invoice_number === invNum ||
                r.receipt_id === invNum
              );
              const receivableStatus = String(receivable?.status || '').toLowerCase();
              const receivableOutstanding = Number(receivable?.outstanding_ugx);
              const receivableOriginal = Number(receivable?.amount_ugx);
              const status = receivable
                ? (receivableStatus === 'paid' || receivableOutstanding === 0
                    ? 'Paid'
                    : (Number.isFinite(receivableOriginal) && Number.isFinite(receivableOutstanding) && receivableOutstanding < receivableOriginal
                        ? 'Partial'
                        : 'Outstanding'))
                : (credit.creditStatus || 'Unpaid');`,
  'branch status resolution'
);

finance = replaceOnce(
  finance,
`                      status === 'Paid' ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"`,
`                      status === 'Paid'
                        ? "bg-emerald-50 text-emerald-600"
                        : status === 'Partial'
                          ? "bg-blue-50 text-blue-600"
                          : "bg-amber-50 text-amber-600"`,
  'branch status badge'
);

fs.writeFileSync(financePath, finance);

// Management Ops: resolve raw branch IDs to tenant branch names.
const ledgerPath = 'src/pages/finance/management/CreditLedger.tsx';
let ledger = fs.readFileSync(ledgerPath, 'utf8');

ledger = replaceOnce(
  ledger,
`      const recSnapshot = await getDocs(recQ);
      const recData = recSnapshot.docs.map(doc => ({
        ...(doc.data() as any),
        id: doc.id
      }));`,
`      const recSnapshot = await getDocs(recQ);

      // Resolve branch document IDs to human-readable tenant branch names.
      const branchCol = collection(db, 'branches');
      const branchQ = query(branchCol, where('tenantId', '==', profile.tenantId));
      const branchSnapshot = await getDocs(branchQ);
      const branchNameById = new Map<string, string>();
      branchSnapshot.docs.forEach(branchDoc => {
        const branch = branchDoc.data() as any;
        branchNameById.set(
          branchDoc.id,
          branch.name || branch.branch_name || branch.branchName || branchDoc.id
        );
      });

      const recData = recSnapshot.docs.map(doc => {
        const rec = doc.data() as any;
        const branchId = rec.branch_id || rec.branchId || 'HQ';
        return {
          ...rec,
          id: doc.id,
          branch_name: rec.branch_name || rec.branchName || branchNameById.get(branchId) || branchId
        };
      });`,
  'management branch lookup'
);

ledger = replaceOnce(
  ledger,
`            branch_id: sale.branchId || 'HQ',
            due_date: sale.timestamp || new Date().toISOString(),`,
`            branch_id: sale.branchId || 'HQ',
            branch_name: branchNameById.get(sale.branchId || '') || sale.branchName || sale.branchId || 'HQ',
            due_date: sale.timestamp || new Date().toISOString(),`,
  'dynamic receivable branch name'
);

ledger = replaceOnce(
  ledger,
`          'Branch': c.branch_id || 'HQ',`,
`          'Branch': c.branch_name || c.branch_id || 'HQ',`,
  'receivable export branch name'
);

ledger = replaceOnce(
  ledger,
`                          <td className="px-6 py-4 text-zinc-600">{rec.branch_id || 'HQ'}</td>`,
`                          <td className="px-6 py-4 text-zinc-600">{rec.branch_name || rec.branch_id || 'HQ'}</td>`,
  'receivable table branch name'
);

fs.writeFileSync(ledgerPath, ledger);

const testPath = 'tests/finance-credit-status-branch-name.test.ts';
fs.writeFileSync(testPath, `import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const finance = fs.readFileSync('src/pages/Finance.tsx', 'utf8');
const ledger = fs.readFileSync('src/pages/finance/management/CreditLedger.tsx', 'utf8');

test('Branch Credit View subscribes to authoritative credit receivables', () => {
  assert.match(finance, /subscribeToCollection\('credit_receivables'/);
  assert.match(finance, /r\.id === credit\.id/);
  assert.match(finance, /r\.invoice_number === invNum/);
});

test('Branch Credit View derives paid and partial states from receivable balance', () => {
  assert.match(finance, /receivableStatus === 'paid' \|\| receivableOutstanding === 0/);
  assert.match(finance, /receivableOutstanding < receivableOriginal/);
  assert.match(finance, /\? 'Partial'/);
});

test('Management Credit Ledger resolves branch IDs through tenant branches', () => {
  assert.match(ledger, /collection\(db, 'branches'\)/);
  assert.match(ledger, /branch\.name \|\| branch\.branch_name \|\| branch\.branchName/);
  assert.match(ledger, /branch_name: rec\.branch_name \|\| rec\.branchName \|\| branchNameById\.get\(branchId\) \|\| branchId/);
});

test('Management receivable table and export prefer resolved branch name', () => {
  assert.match(ledger, /'Branch': c\.branch_name \|\| c\.branch_id \|\| 'HQ'/);
  assert.match(ledger, /\{rec\.branch_name \|\| rec\.branch_id \|\| 'HQ'\}/);
});
`);

console.log('Applied Finance credit settlement-status and branch-name display patch.');
