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
    if (!Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.totalValueUGX) || line.totalValueUGX < 0) throw new Error('Operational GRN quantities and values must be valid.');
    groups.set(line.operationalType, [...(groups.get(line.operationalType) || []), line]);
  }
  return [...groups.entries()].map(([operationalType, groupedLines]) => ({
    operationalType,
    eventKind: operationalType === 'FIXED_ASSET' ? 'FIXED_ASSET_ACQUISITION' as const : 'OPERATIONAL_CONSUMABLE_OPEX' as const,
    amountUGX: groupedLines.reduce((sum, line) => sum + line.totalValueUGX, 0),
    lines: groupedLines
  }));
}
