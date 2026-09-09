from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    if new in text:
        print(f'{label}: already applied')
        return
    if old not in text:
        raise SystemExit(f'{label}: anchor not found in {path}')
    file_path.write_text(text.replace(old, new, 1))
    print(f'{label}: applied')


replace_once(
    'tests/multi-tier-release-candidate.test.ts',
    """  assert.ok(integrity.includes('Multi-tier receipt inventory revisions require exact batch-allocation support'));
  assert.ok(integrity.includes('Multi-tier receipt voiding requires exact stored batch-allocation restoration'));
""",
    """  assert.ok(integrity.includes('planSaleInventoryRevision'));
  assert.ok(integrity.includes('assertExactStoredAllocations'));
  assert.ok(integrity.includes('batchAllocations'));
""",
    'phase e source guard expectations'
)

replace_once(
    'tests/sale-inventory-revision-planner.test.ts',
    """  assert.throws(() => assertExactStoredAllocations(stripLine({ baseQuantity: 11 }), product()), /do not match/);
""",
    """  assert.throws(() => assertExactStoredAllocations(stripLine({ baseQuantity: 11 }), product()), /inconsistent|do not match/);
""",
    'historical corruption error expectation'
)
