import fs from 'node:fs';

const path = 'src/pages/Sales.tsx';
let source = fs.readFileSync(path, 'utf8');

const legacy = "staff.find(s => s.uid === selectedSale.servedBy)?.displayName || staff.find(s => s.id === selectedSale.servedBy)?.displayName || selectedSale.servedBy || 'Operator'";
const replacement = "resolveSaleOperatorName(selectedSale, staff)";

const matches = source.split(legacy).length - 1;
if (matches !== 2) {
  throw new Error(`Expected exactly 2 remaining legacy reprint seller expressions, found ${matches}`);
}

source = source.split(legacy).join(replacement);
fs.writeFileSync(path, source);

fs.writeFileSync('tests/thermal-reprint-seller.test.ts', `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\n\ntest('receipt reprint preview and plain-text sharing use canonical seller resolver', () => {\n  const source = readFileSync('src/pages/Sales.tsx', 'utf8');\n  const directUidFallback = \"staff.find(s => s.uid === selectedSale.servedBy)?.displayName || staff.find(s => s.id === selectedSale.servedBy)?.displayName || selectedSale.servedBy || 'Operator'\";\n  assert.equal(source.includes(directUidFallback), false);\n  const occurrences = source.match(/resolveSaleOperatorName\\(selectedSale, staff\\)/g) || [];\n  assert.ok(occurrences.length >= 3, 'expected canonical resolver in preview, thermal print, and sharing path');\n});\n`);

console.log('Thermal reprint seller presentation patch applied.');
