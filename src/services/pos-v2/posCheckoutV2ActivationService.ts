import type { PosCheckoutEngineMode } from './posCheckoutV2Types';

export type PosCheckoutExecutionEngine = 'legacy' | 'v2';

export interface PosCheckoutAttemptSelection {
  attemptId: string;
  engine?: PosCheckoutExecutionEngine;
}

export function executionEngineForMode(mode: PosCheckoutEngineMode): PosCheckoutExecutionEngine {
  // Shadow has no write-safe comparison implementation yet. It deliberately
  // remains legacy-authoritative and never invokes the V2 commit path.
  return mode === 'v2' ? 'v2' : 'legacy';
}

export function pinCheckoutAttemptEngine(
  attempt: PosCheckoutAttemptSelection,
  mode: PosCheckoutEngineMode
): PosCheckoutAttemptSelection & { engine: PosCheckoutExecutionEngine } {
  return {
    ...attempt,
    engine: attempt.engine ?? executionEngineForMode(mode)
  };
}

export async function executeSelectedCheckout<TLegacy, TV2>(params: {
  engine: PosCheckoutExecutionEngine;
  executeLegacy: () => Promise<TLegacy>;
  executeV2: () => Promise<TV2>;
}): Promise<
  | { engine: 'legacy'; result: TLegacy }
  | { engine: 'v2'; result: TV2 }
> {
  if (params.engine === 'v2') {
    return { engine: 'v2', result: await params.executeV2() };
  }
  return { engine: 'legacy', result: await params.executeLegacy() };
}
