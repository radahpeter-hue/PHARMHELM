export type OperationalFinanceEventKind = 'OPERATIONAL_CONSUMABLE_OPEX' | 'FIXED_ASSET_ACQUISITION';

export interface OperationalGrnFinanceLine {
  operationalType: 'CONSUMABLE_OPERATIONAL' | 'FIXED_ASSET';
  itemId: string;
  itemName: string;
  quantity: number;
  totalValueUGX: number;
}

export function planOperationalGrnFinanceEvents(lines: OperationalGrnFinanceLine[]) {
  if (!lines.length) throw new Error('A finalized Operational GRN must contain lines.');
  const groups = new Map<OperationalGrnFinanceLine['operationalType'], OperationalGrnFinanceLine[]>();
  for (const line of lines) {
    if (!['CONSUMABLE_OPERATIONAL', 'FIXED_ASSET'].includes(line.operationalType)) throw new Error('Every Operational GRN line must have a valid subtype.');
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0 || !Number.isSafeInteger(line.totalValueUGX) || line.totalValueUGX < 0) throw new Error('Operational GRN quantities and values must be valid whole numbers of units and UGX.');
    groups.set(line.operationalType, [...(groups.get(line.operationalType) || []), line]);
  }
  return [...groups.entries()].map(([operationalType, groupedLines]) => {
    const amountUGX = groupedLines.reduce((sum, line) => sum + line.totalValueUGX, 0);
    if (!Number.isSafeInteger(amountUGX)) throw new Error('Operational GRN event total exceeds safe whole-number UGX range.');
    return {
      operationalType,
      eventKind: operationalType === 'FIXED_ASSET' ? 'FIXED_ASSET_ACQUISITION' as const : 'OPERATIONAL_CONSUMABLE_OPEX' as const,
      amountUGX,
      lines: groupedLines
    };
  });
}
