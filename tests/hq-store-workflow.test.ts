import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateHqNetRequirement } from '../src/services/forecastingService';
import { isBranchReturnToHq, isHqProcurementDelivery } from '../src/services/hqStockReceiptService';
import { TransferInvoice } from '../src/types';
import { getHqAutoOrderId } from '../src/services/orderSubmissionService';

const transfer = (overrides: Partial<TransferInvoice>): TransferInvoice => ({
  id: 'transfer-1',
  tenantId: 'tenant-1',
  transfer_number: 'TI-1',
  source_branch_id: 'PROCUREMENT',
  destination_branch_id: 'HQ',
  transfer_type: 'procurement_grn',
  status: 'dispatched',
  dispatched_by: 'user-1',
  dispatched_at: '2026-09-04T00:00:00.000Z',
  total_value_ugx: 1000,
  items: [],
  ...overrides
});

test('HQ procurement GRNs are separated from real branch returns', () => {
  const grn = transfer({});
  const branchReturn = transfer({
    id: 'return-1',
    source_branch_id: 'branch-a',
    transfer_type: 'branch_to_central'
  });

  assert.equal(isHqProcurementDelivery(grn), true);
  assert.equal(isBranchReturnToHq(grn), false);
  assert.equal(isHqProcurementDelivery(branchReturn), false);
  assert.equal(isBranchReturnToHq(branchReturn), true);
});

test('legacy GRN dispatches are recognized by their stable GRN link', () => {
  const legacy = transfer({
    source_branch_id: 'HQ',
    transfer_type: 'central_to_branch',
    ...({ grn_id: 'grn-legacy-1' } as any)
  });

  assert.equal(isHqProcurementDelivery(legacy), true);
  assert.equal(isBranchReturnToHq(legacy), false);
});

test('HQ aggregate requirement deducts HQ stock and confirmed incoming once', () => {
  assert.equal(calculateHqNetRequirement(1000, 250, 150), 600);
  assert.equal(calculateHqNetRequirement(300, 250, 150), 0);
});

test('retrying the same HQ auto-run targets the same purchase order', () => {
  const first = getHqAutoOrderId('run-123', 'sellable::supplier/one');
  const retry = getHqAutoOrderId('run-123', 'sellable::supplier/one');
  assert.equal(first, retry);
  assert.notEqual(first, getHqAutoOrderId('run-124', 'sellable::supplier/one'));
});
