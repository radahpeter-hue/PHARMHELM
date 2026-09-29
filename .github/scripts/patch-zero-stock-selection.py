from pathlib import Path

sales_path = Path('src/pages/Sales.tsx')
sales = sales_path.read_text()
old_filter = """  const filteredItems = activeTab === 'products' 
    ? products.filter(p => {
        const hasStock = getProductUsableBaseStock(batches, p.id) > 0;
        const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          p.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
          p.genericName?.toLowerCase().includes(searchTerm.toLowerCase());
        return hasStock && matchesSearch;
      })
"""
new_filter = """  const filteredItems = activeTab === 'products' 
    ? products.filter(p => {
        const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          p.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
          p.genericName?.toLowerCase().includes(searchTerm.toLowerCase());
        return matchesSearch;
      })
"""
if sales.count(old_filter) != 1:
    raise SystemExit('Expected exactly one product search stock filter anchor.')
sales = sales.replace(old_filter, new_filter, 1)
old_message = "        toast.error('No active/unexpired stock available for this product');"
new_message = "        toast.error(`Insufficient eligible stock for ${product.name}. No sellable batch is available.`);"
if sales.count(old_message) != 1:
    raise SystemExit('Expected exactly one no-stock basket message anchor.')
sales = sales.replace(old_message, new_message, 1)
sales_path.write_text(sales)

test_path = Path('tests/pos-final-eligibility-regression.test.ts')
tests = test_path.read_text()
append = r'''

test('product search keeps zero-eligible-stock products selectable so basket validation can explain rejection', () => {
  const sales = readFileSync('src/pages/Sales.tsx', 'utf8');
  assert.doesNotMatch(sales, /return hasStock && matchesSearch/);
  assert.match(sales, /Insufficient eligible stock for \$\{product\.name\}\. No sellable batch is available\./);
});

test('QA quarantine rule preserves branch scope for non-head QA users', () => {
  const rules = readFileSync('firestore.rules', 'utf8');
  assert.match(rules, /isQA\(\)[\s\S]{0,220}isAssignedToBranch\(resource\.data\.branchId\)/);
  assert.match(rules, /QA Head/);
  assert.match(rules, /request\.resource\.data\.batch_status == 'quarantined'/);
});
'''
if 'zero-eligible-stock products selectable' in tests:
    raise SystemExit('Regression test already present.')
test_path.write_text(tests.rstrip() + append)
