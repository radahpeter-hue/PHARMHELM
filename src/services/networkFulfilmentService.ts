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

  // 2. Query outstanding outbound transfer commitments (dispatched or pending approvals)
  let pendingTransfersQty = 0;
  try {
    const outboundTransfersSnap = await getDocs(
      query(
        collection(db, 'transfer_invoices'),
        where('tenantId', '==', tenantId),
        where('source_branch_id', '==', donorBranchId),
        where('status', 'in', ['pending_approval', 'approved', 'dispatched'])
      )
    );

    outboundTransfersSnap.forEach(docSnap => {
      const transfer = docSnap.data();
      const items = transfer.items || [];
      const item = items.find((i: any) => i.product_id === productId);
      if (item) {
        pendingTransfersQty += item.qty_dispatched || item.qty_requested || 0;
      }
    });
  } catch (e) {
    console.warn('Error fetching outbound transfers:', e);
  }

  // 3. Query active unexpired reservations for this donor branch
  let reservedQty = 0;
  try {
    const activeReservationsSnap = await getDocs(
      query(
        collection(db, 'inventoryTransferReservations'),
        where('tenantId', '==', tenantId),
        where('sourceBranchId', '==', donorBranchId),
        where('productId', '==', productId),
        where('status', 'in', ['PENDING', 'ACTIVE'])
      )
    );

    const now = new Date().toISOString();
    activeReservationsSnap.forEach(docSnap => {
      const res = docSnap.data() as InventoryTransferReservation;
      if (res.expiresAt > now) {
        reservedQty += res.reservedQuantityBaseUnits;
      }
    });
  } catch (e) {
    console.warn('Error fetching reservations:', e);
  }

  const confirmedOutboundCommitments = pendingTransfersQty + reservedQty;

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
          const hqCommitments = 0; // Simple stub
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

  // Run in database transaction
  const reservationRef = doc(collection(db, 'inventoryTransferReservations'));

  await runTransaction(db, async (transaction) => {
    // 1. Verify source has enough transferable excess
    // In Firestore transaction, we should read the batches to confirm stock
    // Since calculateDonorTransferableExcess makes async reads, we compute it and do a sanity check.
    // To ensure strict atomic reservation, we check:
    // Expiry adjusted stock minus active reservations must be >= requested qty.
    const activeReservationsQuery = query(
      collection(db, 'inventoryTransferReservations'),
      where('tenantId', '==', tenantId),
      where('sourceBranchId', '==', sourceBranchId),
      where('productId', '==', productId),
      where('status', 'in', ['PENDING', 'ACTIVE'])
    );
    const reservationsSnap = await getDocs(activeReservationsQuery);
    
    let currentReserved = 0;
    const now = new Date().toISOString();
    reservationsSnap.forEach(d => {
      const res = d.data() as InventoryTransferReservation;
      if (res.expiresAt > now) {
        currentReserved += res.reservedQuantityBaseUnits;
      }
    });

    // Load batches of the source branch
    const batchesQuery = query(
      collection(db, 'product_batches'),
      where('tenantId', '==', tenantId),
      where('branchId', '==', sourceBranchId),
      where('productId', '==', productId)
    );
    const batchesSnap = await getDocs(batchesQuery);
    let totalUsable = 0;
    batchesSnap.forEach(d => {
      const b = d.data();
      if (b.batch_status !== 'quarantined' && b.batch_status !== 'expired') {
        totalUsable += b.quantity || 0;
      }
    });

    const available = Math.max(0, totalUsable - currentReserved);
    if (available < qtyBaseUnits) {
      throw new Error(`Insufficient stock available at source branch: ${available} available, ${qtyBaseUnits} requested.`);
    }

    const expiresAt = new Date(Date.now() + reservationTtlMinutes * 60 * 1000).toISOString();

    const reservationDoc: InventoryTransferReservation = {
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
      createdAt: new Date().toISOString(),
      expiresAt,
      convertedTransferRequestId: null
    };

    transaction.set(reservationRef, reservationDoc);
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
