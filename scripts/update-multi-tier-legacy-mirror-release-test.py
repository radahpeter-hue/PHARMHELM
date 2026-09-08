from pathlib import Path

path = Path('tests/multi-tier-release-candidate.test.ts')
text = path.read_text()
old = """test('release candidate: legacy mirror follows only the configured default tier', () => {
  const mirrored = applyLegacySellingTierMirror(product());
  assert.equal(mirrored.unitOfSell, 'strip');
  assert.equal(mirrored.sellingPricePerUnit, 2500);
});
"""
new = """test('release candidate: legacy compatibility preserves base-unit pricing semantics', () => {
  const mirrored = applyLegacySellingTierMirror(product({ unitOfSell: 'unit', sellingPricePerUnit: 200 }));
  assert.equal(mirrored.unitOfSell, 'unit');
  assert.equal(mirrored.sellingPricePerUnit, 300);
  assert.notEqual(mirrored.sellingPricePerUnit, 2500);
  assert.notEqual(mirrored.sellingPricePerUnit, 22000);
});
"""
if old not in text:
    raise SystemExit('Legacy mirror release-test anchor not found')
path.write_text(text.replace(old, new, 1))
print('Release candidate legacy mirror assertion updated.')
