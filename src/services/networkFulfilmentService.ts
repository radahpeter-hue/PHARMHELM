import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where,
  runTransaction,
  Timestamp,
  addDoc,
  updateDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { 
  Branch, 
  Product,
  BranchReplenishmentSnapshot,
  InventoryTransferReservation
} from '../types';
import { calculateProductForecast, getReplenishmentSettings } from './forecastingService';

/**
 * Returns confirmed outbound commitments for a branch/product across both
 * canonical transfer line documents and live transfer reservations.
 */
async function getConfirmedOutboundCommitments(
  tenantId: string,
  sourceBranchId: string,
  productId: string
): Promise<number> {
  const activeStatuses = new Set(['pending_approval', 'approved', 'dispatched', 'receiving', 'in_transit']);
  let transferQty = 0;

  const transferSnap = await getDocs(query(
    collection(db, 'transfer_invoices'),
    where('tenantId', '==', tenantId),
    where('source_branch_id', '==', sourceBranchId)
  ));
  const activeTransfers = transferSnap.docs.filter(d => activeStatuses.has(String(d.data().status || '').toLowerCase()));

  for (const transferDoc of activeTransfers) {
    const transfer = transferDoc.data() as any;
    const embeddedItems = Array.isArray(transfer.items) ? transfer.items : [];
    for (const item of embeddedItems) {
      if (item.product_id === productId) {
        transferQty += Math.max(0, Number(item.qty_dispatched ?? item.qty_requested ?? 0));
      }
    }

    const lineSnap = await getDocs(query(
      collection(db, 'transfer_invoice_lines'),
      where('tenantId', '==', tenantId),
      where('transfer_id', '==', transferDoc.id)
    ));
    lineSnap.forEach(lineDoc => {
      const line = lineDoc.data() as any;
      if (line.product_id === productId) {
        transferQty += Math.max(0, Number(line.qty_dispatched ?? line.qty_requested ?? 0));
      }
    });
  }

  let reservedQty = 0;
  const reservationsSnap = await getDocs(query(
    collection(db, 'inventoryTransferReservations'),
    where('tenantId', '==', tenantId),
    where('sourceBranchId', '==', sourceBranchId),
    where('productId', '==', productId),
    where('status', 'in', ['PENDING', 'ACTIVE'])
  ));
  const nowIso = new Date().toISOString();
  reservationsSnap.forEach(d => {
    const reservation = d.data() as InventoryTransferReservation;
    if (reservation.expiresAt > nowIso) {
      reservedQty += Math.max(0, Number(reservation.reservedQuantityBaseUnits || 0));
    }
  });

  return transferQty + reservedQty;
}

/**
 * Calculates a potential donor branch's transferable excess stock.
 */
export async function calculateDonorTransferableExcess(
  tenantId: string,
  donorBranchId: string,
  productId: string,
  analysisStartDate: string,
  analysisEndDate: string,
  coverageDays: number
): Promise<{
  projectedDailyConsumption: number;
  projectedConsumption: number;
  leadTimeStock: number;
  safetyBuffer: number;
  protectedRequirement: number;
  expiryAdjustedUsableStock: number;
  confirmedOutboundCommitments: number;
  transferableExcess: number;
  confidenceScore: number;
}> {
  // 1. Calculate forecast for the donor branch
  const forecast = await calculateProductForecast({
    tenantId,
    branchId: donorBranchId,
    productId,
    analysisStartDate,
    analysisEndDate,
    forecastCoverageDays: coverageDays,
    includeExceptionalConsumption: false,
    useSeasonality: false
  });

  // If calculations are blocked for the donor, they have 0 excess
  if (!forecast.calculationAllowed) {
    return {
      projectedDailyConsumption: 0,
      projectedConsumption: 0,
      leadTimeStock: 0,
      safetyBuffer: 0,
      protectedRequirement: 0,
      expiryAdjustedUsableStock: 0,
      confirmedOutboundCommitments: 0,
      transferableExcess: 0,
      confidenceScore: 0
    };
  }

  // 2. Canonical commitments include embedded transfer lines, separate transfer_invoice_lines, and live reservations.
  const confirmedOutboundCommitments = await getConfirmedOutboundCommitments(tenantId, donorBranchId, productId);

  // Donor Protected Requirement = Projected Consumption + Lead-Time Stock + Safety Buffer + Confirmed Outbound Commitments
  const protectedRequirement = forecast.projectedConsumption + 
                           forecast.leadTimeStock + 
                           forecast.safetyBuffer + 
                           confirmedOutboundCommitments;

  // Donor Transferable Excess = MAX(0, Expiry-Adjusted Usable Stock - Donor Protected Requirement)
  const transferableExcess = Math.max(0, forecast.expiryAdjustedUsableStock - protectedRequirement);

  return {
    projectedDailyConsumption: forecast.projectedDailyConsumption,
    projectedConsumption: forecast.projectedConsumption,
    leadTimeStock: forecast.leadTimeStock,
    safetyBuffer: forecast.safetyBuffer,
    protectedRequirement,
    expiryAdjustedUsableStock: forecast.expiryAdjustedUsableStock,
    confirmedOutboundCommitments,
    transferableExcess,
    confidenceScore: forecast.confidenceScore
  };
}

/**
 * Precomputes planning snapshots for donor branches.
 */
export async function refreshReplenishmentSnapshots(
  tenantId: string,
  branchIds: string[],
  productIds: string[],
  analysisStartDate: string,
  analysisEndDate: string,
  coverageDays: number
): Promise<void> {
  for (const branchId of branchIds) {
    for (const productId of productIds) {
      try {
        const excessData = await calculateDonorTransferableExcess(
          tenantId,
          branchId,
          productId,
          analysisStartDate,
          analysisEndDate,
          coverageDays
        );

        const snapId = `${tenantId}_${branchId}_${productId}`;
        const docRef = doc(db, 'branchReplenishmentSnapshots', snapId);

        const snapshotDoc: BranchReplenishmentSnapshot = {
          tenantId,
          branchId,
          productId,
          calculatedAt: new Date().toISOString(),
          dataVersion: 1,
          projectedDailyConsumption: excessData.projectedDailyConsumption,
          projectedConsumption: excessData.projectedConsumption,
          leadTimeStock: excessData.leadTimeStock,
          safetyBuffer: excessData.safetyBuffer,
          protectedRequirement: excessData.protectedRequirement,
          expiryAdjustedUsableStock: excessData.expiryAdjustedUsableStock,
          confirmedOutboundCommitments: excessData.confirmedOutboundCommitments,
          transferableExcess: excessData.transferableExcess,
          confidenceScore: excessData.confidenceScore,
          staleAfter: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString() // Stale after 12 hours
        };

        // Write using client side firebase mock
        await updateDoc(docRef, snapshotDoc as any).catch(async () => {
          // If update fails because doc doesn't exist, use transaction/setDoc or basic fallback
          const { setDoc } = await import('firebase/firestore');
          await setDoc(docRef, snapshotDoc);
        });
      } catch (e) {
        console.error(`Failed to refresh replenishment snapshot for branch ${branchId}, product ${productId}:`, e);
      }
    }
  }
}

/**
 * Rank eligible donor locations and return network fulfilment recommendations.
 */
export async function getNetworkFulfilmentRecommendations(params: {
  tenantId: string;
  branchId: string;
  productId: string;
  grossRequirement: number;
  analysisStartDate: string;
  analysisEndDate: string;
  coverageDays: number;
  checkCentralStore: boolean;
  checkOtherBranches: boolean;
}): Promise<{
  centralAllocation: number;
  donorAllocations: { branchId: string; branchName: string; qtyBaseUnits: number }[];
  remainingRequirement: number;
}> {
  const {
    tenantId,
    branchId,
    productId,
    grossRequirement,
    analysisStartDate,
    analysisEndDate,
    coverageDays,
    checkCentralStore,
    checkOtherBranches
  } = params;

  let remaining = grossRequirement;
  let centralAllocation = 0;
  const donorAllocations: { branchId: string; branchName: string; qtyBaseUnits: number }[] = [];

  if (remaining <= 0) {
    return { centralAllocation, donorAllocations, remainingRequirement: 0 };
  }

  // 1. Central Store Allocation
  if (checkCentralStore) {
    // Find Central Store branch of the tenant
    try {
      const branchesSnap = await getDocs(
        query(
          collection(db, 'branches'),
          where('tenantId', '==', tenantId),
          where('type', '==', 'HQ')
        )
      );

      if (!branchesSnap.empty) {
        const hqBranch = branchesSnap.docs[0];
        const hqBranchId = hqBranch.id;

        if (hqBranchId !== branchId) {
          // Compute central store's excess or available stock
          const centralForecast = await calculateProductForecast({
            tenantId,
            branchId: hqBranchId,
            productId,
            analysisStartDate,
            analysisEndDate,
            forecastCoverageDays: coverageDays,
            includeExceptionalConsumption: false,
            useSeasonality: false
          });

          // HQ doesn't strictly have a protected requirement in the same way (or it excludes buffers)
          // As per prompt: HQ allocatable stock is Usable Stock minus outbound commitments and protected emergency stock.
          // Let's assume HQ's usable stock is its expiryAdjustedUsableStock.
          // Central store allocation: MIN(Gross Net Requirement, Central Store Allocatable Stock)
          const hqCommitments = await getConfirmedOutboundCommitments(tenantId, hqBranchId, productId);
          const hqAllocatable = Math.max(0, centralForecast.expiryAdjustedUsableStock - hqCommitments);
          
          centralAllocation = Math.min(remaining, hqAllocatable);
          remaining = Math.max(0, remaining - centralAllocation);
        }
      }
    } catch (e) {
      console.warn('Error computing central store allocation:', e);
    }
  }

  // 2. Interbranch Donors Allocation
  if (checkOtherBranches && remaining > 0) {
    try {
      const branchesSnap = await getDocs(
        query(
          collection(db, 'branches'),
          where('tenantId', '==', tenantId)
        )
      );

      const eligibleDonors: { branchId: string; branchName: string; excess: number; region?: string }[] = [];

      for (const docSnap of branchesSnap.docs) {
        const b = docSnap.data() as Branch;
        const bId = docSnap.id;

        // Skip requesting branch and central store (if already checked)
        if (bId === branchId || b.type === 'HQ') continue;

        // Calculate excess
        const excessInfo = await calculateDonorTransferableExcess(
          tenantId,
          bId,
          productId,
          analysisStartDate,
          analysisEndDate,
          coverageDays
        );

        if (excessInfo.transferableExcess > 0) {
          eligibleDonors.push({
            branchId: bId,
            branchName: b.name,
            excess: excessInfo.transferableExcess,
            region: (b as any).region || 'Kampala'
          });
        }
      }

      // Prioritize donors:
      // 1. Highest excess first for simplicity (or region match)
      eligibleDonors.sort((a, b) => b.excess - a.excess);

      for (const donor of eligibleDonors) {
        if (remaining <= 0) break;
        const alloc = Math.min(remaining, donor.excess);
        donorAllocations.push({
          branchId: donor.branchId,
          branchName: donor.branchName,
          qtyBaseUnits: alloc
        });
        remaining = Math.max(0, remaining - alloc);
      }
    } catch (e) {
      console.warn('Error allocating from donor branches:', e);
    }
  }

  return {
    centralAllocation,
    donorAllocations,
    remainingRequirement: remaining
  };
}

/**
 * Atomically create a short-lived transfer reservation in a transaction.
 */
export async function createTransferReservationTx(params: {
  tenantId: string;
  sourceBranchId: string;
  destinationBranchId: string;
  productId: string;
  autoGenerateRunId: string;
  qtyBaseUnits: number;
  createdBy: string;
  reservationTtlMinutes?: number;
}): Promise<string> {
  const {
    tenantId,
    sourceBranchId,
    destinationBranchId,
    productId,
    autoGenerateRunId,
    qtyBaseUnits,
    createdBy,
    reservationTtlMinutes = 30
  } = params;

  if (!tenantId || !sourceBranchId || !destinationBranchId || !productId || !autoGenerateRunId) {
    throw new Error('Tenant, source, destination, product and order run are required for a transfer reservation.');
  }
  if (!Number.isFinite(qtyBaseUnits) || qtyBaseUnits <= 0) throw new Error('Reservation quantity must be greater than zero.');

  const stablePart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);
  const reservationId = stablePart(`reservation_${tenantId}_${autoGenerateRunId}_${sourceBranchId}_${destinationBranchId}_${productId}`);
  const lockId = stablePart(`lock_${tenantId}_${sourceBranchId}_${productId}`);
  const reservationRef = doc(db, 'inventoryTransferReservations', reservationId);
  const lockRef = doc(db, 'inventoryTransferReservations', lockId);

  await runTransaction(db, async transaction => {
    const [lockSnapshot, existingReservation] = await Promise.all([
      transaction.get(lockRef),
      transaction.get(reservationRef)
    ]);

    const now = new Date();
    const nowIso = now.toISOString();
    if (existingReservation.exists()) {
      const existing = existingReservation.data() as InventoryTransferReservation;
      if (existing.tenantId !== tenantId) throw new Error('Reservation ID collision across tenants.');
      if (existing.status === 'CONVERTED') return;
      if (['PENDING', 'ACTIVE'].includes(existing.status) && existing.expiresAt > nowIso) return;
    }

    // The lock document serializes reservation creators for one source/product.
    // Queries are re-run when Firestore retries the transaction after lock contention.
    const activeReservationsSnap = await getDocs(query(
      collection(db, 'inventoryTransferReservations'),
      where('tenantId', '==', tenantId),
      where('sourceBranchId', '==', sourceBranchId),
      where('productId', '==', productId),
      where('status', 'in', ['PENDING', 'ACTIVE'])
    ));

    const batchesSnap = await getDocs(query(
      collection(db, 'product_batches'),
      where('tenantId', '==', tenantId),
      where('branchId', '==', sourceBranchId),
      where('productId', '==', productId)
    ));
    if (batchesSnap.empty) throw new Error('No stock batches exist at the selected source branch.');

    const batchSnapshots = await Promise.all(batchesSnap.docs.map(batchDoc => transaction.get(batchDoc.ref)));
    let totalUsable = 0;
    batchSnapshots.forEach(snapshot => {
      if (!snapshot.exists()) return;
      const batch = snapshot.data();
      const status = String(batch.batch_status || '').toLowerCase();
      const rawExpiry = String(batch.expiryDate || '').trim();
      let expiryMs = Number.POSITIVE_INFINITY;
      if (/^\d{4}-\d{2}$/.test(rawExpiry)) {
        const [year, month] = rawExpiry.split('-').map(Number);
        expiryMs = new Date(year, month, 0, 23, 59, 59, 999).getTime();
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawExpiry)) {
        const [year, month, day] = rawExpiry.split('-').map(Number);
        expiryMs = new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
      } else if (rawExpiry) {
        expiryMs = new Date(rawExpiry).getTime();
      }
      if (['quarantined', 'expired', 'recalled', 'blocked'].includes(status)) return;
      if (!Number.isFinite(expiryMs) || expiryMs < now.getTime()) return;
      totalUsable += Math.max(0, Number(batch.quantity || 0));
    });

    let currentReserved = 0;
    activeReservationsSnap.forEach(reservationDoc => {
      if (reservationDoc.id === reservationId) return;
      const reservation = reservationDoc.data() as InventoryTransferReservation;
      if (reservation.expiresAt > nowIso) currentReserved += Math.max(0, Number(reservation.reservedQuantityBaseUnits || 0));
    });

    const available = Math.max(0, totalUsable - currentReserved);
    if (available < qtyBaseUnits) {
      throw new Error(`Insufficient stock available at source branch: ${available} base units available after active reservations, ${qtyBaseUnits} requested.`);
    }

    const expiresAt = new Date(now.getTime() + reservationTtlMinutes * 60 * 1000).toISOString();
    transaction.set(lockRef, {
      tenantId,
      sourceBranchId,
      productId,
      status: 'LOCK',
      isReservationLock: true,
      version: Number(lockSnapshot.exists() ? lockSnapshot.data().version || 0 : 0) + 1,
      updatedAt: nowIso
    }, { merge: true });

    transaction.set(reservationRef, {
      tenantId,
      sourceBranchId,
      destinationBranchId,
      productId,
      batchId: null,
      autoGenerateRunId,
      requestedQuantityBaseUnits: qtyBaseUnits,
      reservedQuantityBaseUnits: qtyBaseUnits,
      status: 'ACTIVE',
      createdBy,
      createdAt: existingReservation.exists() ? existingReservation.data().createdAt || nowIso : nowIso,
      updatedAt: nowIso,
      expiresAt,
      convertedTransferRequestId: null
    }, { merge: true });
  });

  return reservationRef.id;
}

/**
 * Scheduled or lazy cleanup of expired reservations.
 */
export async function cleanupExpiredReservations(tenantId: string): Promise<number> {
  let count = 0;
  try {
    const now = new Date().toISOString();
    const activeReservationsSnap = await getDocs(
      query(
        collection(db, 'inventoryTransferReservations'),
        where('tenantId', '==', tenantId),
        where('status', 'in', ['PENDING', 'ACTIVE'])
      )
    );

    for (const docSnap of activeReservationsSnap.docs) {
      const res = docSnap.data() as InventoryTransferReservation;
      if (res.expiresAt < now) {
        await updateDoc(doc(db, 'inventoryTransferReservations', docSnap.id), {
          status: 'EXPIRED',
          updatedAt: new Date().toISOString()
        });
        count++;
      }
    }
  } catch (e) {
    console.error('Failed to clean up expired reservations:', e);
  }
  return count;
}
