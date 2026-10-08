const clean = value => String(value ?? '').trim();
const sameNumber = (left, right) => Number.isFinite(Number(left)) && Number.isFinite(Number(right))
  && Math.abs(Number(left) - Number(right)) <= 0.0001;

/** A reviewed draft may not carry a different hidden checkout quantity/price. */
export function assertRevisionDraftCommercialFields(items) {
  for (const item of items || []) {
    if (item.commercialQuantity != null && !sameNumber(item.quantity, item.commercialQuantity)) {
      throw new Error('Revision draft quantity differs from its checkout quantity. Reopen the editor.');
    }
    if (item.actualUnitPrice != null && !sameNumber(item.unitPrice, item.actualUnitPrice)) {
      throw new Error('Revision draft price differs from its checkout price. Reopen the editor.');
    }
  }
}

const lineKey = item => JSON.stringify([clean(item.productId), Boolean(item.isService), clean(item.tierCode)]);
function commercialLines(items, requested) {
  return (items || []).map(item => JSON.stringify([lineKey(item),
    Number(requested ? item.quantity : item.commercialQuantity ?? item.quantity),
    Number(requested ? item.unitPrice : item.actualUnitPrice ?? item.unitPrice)
  ])).sort();
}

/** Compare reviewed commercial intent with canonical output, allowing FEFO allocation to change. */
export function revisionCommercialEvidenceIssues({ request, replacementSale, payment = null }) {
  const issues = [];
  if (!replacementSale) return ['The corrected receipt is missing.'];
  const total = replacementSale.totalAmount ?? replacementSale.total;
  if (!sameNumber(request.revisedTotal, total)) issues.push('Corrected receipt total differs from the reviewed total.');
  if (replacementSale.total != null && replacementSale.totalAmount != null
    && !sameNumber(replacementSale.total, replacementSale.totalAmount)) issues.push('Corrected receipt total fields disagree.');
  const expected = request.envelope?.replacementSaleSeed?.items || request.revisedItems;
  if (Array.isArray(expected) && expected.length) {
    if (JSON.stringify(commercialLines(expected, true)) !== JSON.stringify(commercialLines(replacementSale.items, false))) {
      issues.push('Corrected receipt items differ from the reviewed quantities or prices.');
    }
    for (const item of expected) {
      if (item.isService || !(Number(item.tierMultiplier) > 0)) continue;
      const actual = (replacementSale.items || []).filter(row => lineKey(row) === lineKey(item));
      if (actual.length !== 1 || !sameNumber(actual[0].baseQuantity, Number(item.quantity) * Number(item.tierMultiplier))) {
        issues.push('Corrected receipt base units differ from the reviewed quantity and multiplier.');
        break;
      }
    }
  } else {
    // Older request records still contain the requested changed quantities/prices.
    for (const change of request.itemChanges || []) {
      if (change.afterQuantity == null && change.afterUnitPrice == null) continue;
      const matches = (replacementSale.items || []).filter(item => clean(item.productId) === clean(change.productId));
      if (matches.length !== 1 || (change.afterQuantity != null && !sameNumber(change.afterQuantity, matches[0].commercialQuantity ?? matches[0].quantity))
        || (change.afterUnitPrice != null && !sameNumber(change.afterUnitPrice, matches[0].actualUnitPrice ?? matches[0].unitPrice))) {
        issues.push('Corrected receipt items differ from the reviewed quantities or prices.');
        break;
      }
    }
  }
  for (const item of replacementSale.items || []) {
    const gross = Number(item.commercialQuantity ?? item.quantity) * Number(item.actualUnitPrice ?? item.unitPrice);
    if (['subtotal', 'total', 'lineTotal'].some(key => item[key] != null && !sameNumber(item[key], gross))) {
      issues.push('Corrected receipt line totals disagree with its quantity and price.');
      break;
    }
    if (Array.isArray(item.batchAllocations) && !item.isService
      && !sameNumber(item.batchAllocations.reduce((sum, row) => sum + Number(row.baseQuantity), 0), item.baseQuantity)) {
      issues.push('Corrected receipt batch allocations disagree with its base units.');
      break;
    }
  }
  if (payment && !sameNumber(payment.amount, total)) issues.push('Canonical payment amount differs from the corrected receipt.');
  if (payment?.components && (!sameNumber(payment.components.reduce((sum, row) => sum + Number(row.amount), 0), total)
    || !sameNumber(Number(payment.settledAmount) + Number(payment.outstandingAmount), total))) {
    issues.push('Canonical payment components do not reconcile with the corrected receipt.');
  }
  for (const field of ['paymentMethod', 'context', 'patientId', 'institutionId', 'prescriberId', 'discountPercentage']) {
    if (!request.after || !(field in request.after)) continue;
    const matches = field === 'discountPercentage' ? sameNumber(request.after[field] ?? 0, replacementSale[field] ?? 0)
      : clean(request.after[field]) === clean(replacementSale[field]);
    if (!matches) issues.push(`Corrected receipt ${field} differs from the reviewed context.`);
  }
  return issues;
}

export function assertRevisionCommercialEvidence(input) {
  const issues = revisionCommercialEvidenceIssues(input);
  if (issues.length) throw new Error(`Revision commercial evidence mismatch: ${issues.join(' ')}`);
}
