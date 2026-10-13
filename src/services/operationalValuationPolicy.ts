/** Moving average in issue units, stored in the existing cost-per-pack field. */
export function operationalReceiptCostPerPack(stockBefore: number, receivedUnits: number, currentPackCost: number, receivedUnitCost: number, unitsPerPack: number): number {
  if (![stockBefore, receivedUnits, currentPackCost, receivedUnitCost, unitsPerPack].every(Number.isFinite) ||
      stockBefore < 0 || receivedUnits <= 0 || currentPackCost < 0 || receivedUnitCost < 0 || unitsPerPack <= 0) {
    throw new Error('Operational receipt quantities and costs are invalid.');
  }
  return ((stockBefore * currentPackCost / unitsPerPack + receivedUnits * receivedUnitCost) / (stockBefore + receivedUnits)) * unitsPerPack;
}
