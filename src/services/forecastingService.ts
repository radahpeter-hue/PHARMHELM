import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where,
  limit,
  Timestamp
} from 'firebase/firestore';
import { db } from '../firebase';
import { 
  Product, 
  ProductBatch, 
  Sale, 
  GRNRecord, 
  StockOrder, 
  StockOrderLine,
  TransferInvoice, 
  ReplenishmentEngineSettings,
  ForecastCalculationInput,
  ForecastCalculationOutput,
  BranchConsumptionDaily
} from '../types';
import { getBaseUnitMultiplier, getDateKeyForTimezone } from './consumptionService';

const DEFAULT_SETTINGS: ReplenishmentEngineSettings = {
  tenantId: 'default',
  defaultLookbackDays: 30,
  defaultCoverageDays: 30,
  defaultLeadTimeDays: 7,
  defaultSafetyDays: 7,
  trendWeight: 0.40,
  trendMinimumMultiplier: 0.50,
  trendMaximumMultiplier: 1.50,
  stockoutAdjustmentCap: 3.0,
  minimumValidHistoryDays: 14,
  seasonalityEnabled: false,
  seasonalityMinimumMonths: 24,
  currentPeriodWeight: 0.70,
  historicalPeriodWeight: 0.30,
  observedLeadTimeDeliveryCount: 10,
  minimumLeadTimeObservations: 3,
  leadTimeMethod: 'HIGHER_OF_MANUAL_AND_OBSERVED',
  confidenceHighThreshold: 80,
  confidenceModerateThreshold: 55
};

/**
 * Fetch tenant settings or return defaults.
 */
export async function getReplenishmentSettings(tenantId: string): Promise<ReplenishmentEngineSettings> {
  try {
    const docRef = doc(db, 'replenishmentEngineSettings', `${tenantId}_settings`);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return { ...DEFAULT_SETTINGS, ...docSnap.data(), tenantId } as ReplenishmentEngineSettings;
    }
  } catch (e) {
    console.warn('Failed to load replenishment settings, using defaults:', e);
  }
  return { ...DEFAULT_SETTINGS, tenantId };
}

/**
 * Calculate the median observed lead time in days from completed deliveries (GRNs).
 */
export async function calculateObservedLeadTime(
  tenantId: string,
  supplierId: string,
  observedCount: number = 10
): Promise<number | null> {
  try {
    // Load last N completed GRNs for this supplier
    const grnQuery = query(
      collection(db, 'grn_records'),
      where('tenantId', '==', tenantId),
      where('supplier_id', '==', supplierId),
      where('status', 'in', ['completed', 'verified']),
      limit(observedCount)
    );
    const grnSnap = await getDocs(grnQuery);
    const grns = grnSnap.docs.map(d => d.data() as GRNRecord);

    if (grns.length === 0) return null;

    const leadTimes: number[] = [];

    for (const grn of grns) {
      if (!grn.order_id) continue;
      
      // Load corresponding PO
      const orderRef = doc(db, 'stock_orders', grn.order_id);
      const orderSnap = await getDoc(orderRef);
      if (orderSnap.exists()) {
        const order = orderSnap.data() as StockOrder;
        const startStr = order.approved_at || order.submitted_at || order.created_at;
        const endStr = grn.receivedAt;
        if (startStr && endStr) {
          const diffMs = new Date(endStr).getTime() - new Date(startStr).getTime();
          const diffDays = diffMs / (24 * 60 * 60 * 1000);
          if (diffDays >= 0) {
            leadTimes.push(diffDays);
          }
        }
      }
    }

    if (leadTimes.length === 0) return null;

    // Calculate median
    leadTimes.sort((a, b) => a - b);
    const mid = Math.floor(leadTimes.length / 2);
    if (leadTimes.length % 2 !== 0) {
      return leadTimes[mid];
    } else {
      return (leadTimes[mid - 1] + leadTimes[mid]) / 2;
    }
  } catch (e) {
    console.error('Failed calculating observed lead time:', e);
    return null;
  }
}

/**
 * Runs deterministic forecasting and gross requirements calculation for a single product.
 */
export async function calculateProductForecast(
  input: ForecastCalculationInput,
  cachedProduct?: Product,
  cachedSettings?: ReplenishmentEngineSettings
): Promise<ForecastCalculationOutput> {
  const {
    tenantId,
    branchId,
    productId,
    analysisStartDate,
    analysisEndDate,
    forecastCoverageDays,
    leadTimeMethod: inputLeadTimeMethod,
    manualLeadTimeOverrideDays,
    safetyPolicy,
    safetyDaysOverride,
    includeExceptionalConsumption,
    temporaryDemandMultiplier = 1.0,
    useSeasonality
  } = input as any;

  const settings = cachedSettings || await getReplenishmentSettings(tenantId);
  
  // Calculate total lookback days
  const start = new Date(analysisStartDate);
  const end = new Date(analysisEndDate);
  const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1);

  const output: ForecastCalculationOutput = {
    tenantId,
    branchId,
    productId,
    analysisPeriod: {
      startDate: analysisStartDate,
      endDate: analysisEndDate,
      totalDays,
      validStockedDays: 0
    },
    actualConsumption: 0,
    adjustedConsumption: 0,
    adc: 0,
    earlierHalfAdc: 0,
    recentHalfAdc: 0,
    trendMultiplier: 1.0,
    seasonalityStatus: 'INSUFFICIENT_HISTORY',
    projectedDailyConsumption: 0,
    projectedConsumption: 0,
    effectiveLeadTimeDays: settings.defaultLeadTimeDays,
    leadTimeSource: 'TENANT_DEFAULT',
    leadTimeStock: 0,
    effectiveSafetyDays: safetyDaysOverride || settings.defaultSafetyDays,
    safetyBuffer: 0,
    targetStockLevel: 0,
    expiryAdjustedUsableStock: 0,
    confirmedIncoming: 0,
    grossNetRequirement: 0,
    confidenceScore: 100,
    confidenceLabel: 'HIGH',
    calculationAllowed: true,
    manualReviewReasons: [],
    warnings: []
  };

  // Load product catalog for base unit multiplier
  let product = cachedProduct;
  if (!product) {
    const prodSnap = await getDoc(doc(db, 'products', productId));
    if (prodSnap.exists()) {
      product = prodSnap.data() as Product;
    }
  }

  if (!product) {
    output.calculationAllowed = false;
    output.confidenceLabel = 'MISSING_PRODUCT';
    output.confidenceScore = 0;
    output.manualReviewReasons.push(`Product metadata not found for ID: ${productId}`);
    return output;
  }

  const multiplier = getBaseUnitMultiplier(product);
  if (!multiplier || multiplier <= 0) {
    output.calculationAllowed = false;
    output.confidenceLabel = 'MISSING_CONVERSION';
    output.confidenceScore = 0;
    output.manualReviewReasons.push(`Missing or invalid commercial multiplier for product ${productId}`);
    return output;
  }

  // Load daily summaries
  const summariesSnap = await getDocs(
    query(
      collection(db, 'branchConsumptionDaily'),
      where('tenantId', '==', tenantId),
      where('branchId', '==', branchId),
      where('productId', '==', productId)
    )
  );

  const summaryMap = new Map<string, BranchConsumptionDaily>();
  summariesSnap.forEach(d => {
    const s = d.data() as BranchConsumptionDaily;
    summaryMap.set(s.dateKey, s);
  });

  // 1. Calculate stocked availability days and ratio
  let validStockedDays = 0;
  let totalValidConsumption = 0;
  let totalExceptionalConsumption = 0;
  
  // Also track daily consumption values for trend calculations
  const dailyValues: { dateKey: string; ord: number; exp: number }[] = [];

  const tempDate = new Date(start);
  for (let i = 0; i < totalDays; i++) {
    const dateKey = getDateKeyForTimezone(tempDate);
    const summary = summaryMap.get(dateKey);
    let availability = 1.0; // Default to fully stocked if summary doesn't exist

    let ordUnits = 0;
    let expUnits = 0;

    if (summary) {
      if (summary.wasStockedAllDay === false) {
        if (summary.stockoutMinutes !== undefined && summary.stockoutMinutes !== null) {
          availability = Math.max(0, 1 - (summary.stockoutMinutes / 1440));
        } else if ((summary.closingUsableStock || 0) > 0) {
          availability = 0.5;
        } else {
          availability = 0.0;
        }
      }
      ordUnits = summary.validConsumptionUnits || 0;
      expUnits = summary.exceptionalUnits || 0;
    }

    validStockedDays += availability;
    totalValidConsumption += ordUnits;
    totalExceptionalConsumption += expUnits;

    dailyValues.push({ dateKey, ord: ordUnits, exp: expUnits });
    tempDate.setDate(tempDate.getDate() + 1);
  }

  output.analysisPeriod.validStockedDays = validStockedDays;

  // Check cold start: insufficient history
  if (validStockedDays < settings.minimumValidHistoryDays) {
    output.calculationAllowed = false;
    output.confidenceLabel = 'INSUFFICIENT_HISTORY';
    output.confidenceScore = 0;
    output.manualReviewReasons.push(`Insufficient history: only ${validStockedDays.toFixed(1)} stocked days (required: ${settings.minimumValidHistoryDays})`);
    return output;
  }

  // 2. Consumption units calculation
  let actualConsumption = 0;
  if (includeExceptionalConsumption) {
    actualConsumption = totalValidConsumption;
  } else {
    actualConsumption = Math.max(0, totalValidConsumption - totalExceptionalConsumption);
  }

  output.actualConsumption = actualConsumption;

  // 3. Stockout adjustment
  const availabilityRatio = validStockedDays / totalDays;
  let adjustedConsumption = actualConsumption;
  let wasCapApplied = false;

  if (availabilityRatio === 0) {
    output.calculationAllowed = false;
    output.confidenceLabel = 'INSUFFICIENT_AVAILABILITY_DATA';
    output.confidenceScore = 0;
    output.manualReviewReasons.push('Availability ratio is zero. Product was out of stock all day.');
    return output;
  }

  if (availabilityRatio > 0 && availabilityRatio < 1.0) {
    const rawAdjusted = actualConsumption / availabilityRatio;
    const cappedAdjusted = actualConsumption * settings.stockoutAdjustmentCap;
    if (rawAdjusted > cappedAdjusted) {
      adjustedConsumption = cappedAdjusted;
      wasCapApplied = true;
      output.warnings.push(`Stockout adjustment capped at ${settings.stockoutAdjustmentCap}x multiplier limit.`);
    } else {
      adjustedConsumption = rawAdjusted;
    }
  }

  output.adjustedConsumption = adjustedConsumption;

  // 4. ADC
  const adc = adjustedConsumption / totalDays;
  output.adc = adc;

  // 5. Trend Calculation
  // Split lookback into recent and earlier halves
  const halfSize = Math.floor(totalDays / 2);
  let earlierConsumption = 0;
  let recentConsumption = 0;

  if (halfSize > 0) {
    // Recent half values are the last halfSize elements
    const recentHalf = dailyValues.slice(-halfSize);
    // Earlier half values are the preceding halfSize elements
    const earlierHalf = dailyValues.slice(0, halfSize);

    let recentStocked = 0;
    let earlierStocked = 0;

    recentHalf.forEach(v => {
      const summary = summaryMap.get(v.dateKey);
      let avail = summary ? (summary.wasStockedAllDay ? 1 : 0.5) : 1;
      recentStocked += avail;
      recentConsumption += includeExceptionalConsumption ? v.ord : Math.max(0, v.ord - v.exp);
    });

    earlierHalf.forEach(v => {
      const summary = summaryMap.get(v.dateKey);
      let avail = summary ? (summary.wasStockedAllDay ? 1 : 0.5) : 1;
      earlierStocked += avail;
      earlierConsumption += includeExceptionalConsumption ? v.ord : Math.max(0, v.ord - v.exp);
    });

    // Stockout adjust the halves
    const recentRatio = recentStocked / halfSize;
    const earlierRatio = earlierStocked / halfSize;

    const recentAdjusted = recentRatio > 0 ? (recentConsumption / recentRatio) : recentConsumption;
    const earlierAdjusted = earlierRatio > 0 ? (earlierConsumption / earlierRatio) : earlierConsumption;

    const recentAdc = recentAdjusted / halfSize;
    const earlierAdc = earlierAdjusted / halfSize;

    output.recentHalfAdc = recentAdc;
    output.earlierHalfAdc = earlierAdc;

    let trendMultiplier = 1.0;
    if (earlierAdc === 0) {
      if (recentAdc > 0) {
        trendMultiplier = 1.5; // New demand growth rule
        output.warnings.push('Trend calculation triggered new-demand rule (earlier half ADC was zero).');
      } else {
        trendMultiplier = 1.0;
      }
    } else {
      const rawTrend = recentAdc / earlierAdc;
      const weightedTrend = 1 + (rawTrend - 1) * settings.trendWeight;
      trendMultiplier = Math.max(settings.trendMinimumMultiplier, Math.min(settings.trendMaximumMultiplier, weightedTrend));
    }

    output.trendMultiplier = trendMultiplier;
  }

  // 6. Seasonality (Optional stub check)
  let blendedAdc = adc;
  if (useSeasonality) {
    output.seasonalityStatus = 'INSUFFICIENT_HISTORY'; // Defaults to skip in this version
  }

  // 7. Projected consumption
  const projectedDaily = blendedAdc * output.trendMultiplier;
  output.projectedDailyConsumption = projectedDaily;

  const tempMultiplier = temporaryDemandMultiplier || 1.0;
  const projectedConsumption = projectedDaily * forecastCoverageDays * tempMultiplier;
  output.projectedConsumption = projectedConsumption;

  // 8. Effective Lead Time Hierarchy
  let manualLeadTime = settings.defaultLeadTimeDays;
  if (product && (product as any).leadTimeDays) {
    manualLeadTime = (product as any).leadTimeDays;
  }

  // Look up observed median
  let observedMedian: number | null = null;
  const supplierId = (product as any).supplierId || null;
  if (supplierId) {
    observedMedian = await calculateObservedLeadTime(tenantId, supplierId, settings.observedLeadTimeDeliveryCount);
  }

  let effectiveLeadTime = settings.defaultLeadTimeDays;
  let leadTimeSource = 'TENANT_DEFAULT';

  const method = inputLeadTimeMethod || settings.leadTimeMethod;

  if (manualLeadTimeOverrideDays !== undefined && manualLeadTimeOverrideDays !== null) {
    effectiveLeadTime = manualLeadTimeOverrideDays;
    leadTimeSource = 'MANUAL_OVERRIDE';
  } else if (method === 'MANUAL') {
    effectiveLeadTime = manualLeadTime;
    leadTimeSource = 'MANUAL';
  } else if (method === 'OBSERVED_MEDIAN' && observedMedian !== null) {
    effectiveLeadTime = Math.round(observedMedian);
    leadTimeSource = 'OBSERVED_MEDIAN';
  } else if (method === 'HIGHER_OF_MANUAL_AND_OBSERVED') {
    const obs = observedMedian !== null ? Math.round(observedMedian) : 0;
    effectiveLeadTime = Math.max(manualLeadTime, obs);
    leadTimeSource = 'HIGHER_OF_MANUAL_AND_OBSERVED';
  } else {
    effectiveLeadTime = settings.defaultLeadTimeDays;
    leadTimeSource = 'TENANT_DEFAULT';
  }

  output.effectiveLeadTimeDays = effectiveLeadTime;
  output.leadTimeSource = leadTimeSource;

  // 9. Lead time stock & safety buffer
  const leadTimeStock = projectedDaily * effectiveLeadTime;
  output.leadTimeStock = leadTimeStock;

  const safetyDays = safetyDaysOverride || settings.defaultSafetyDays;
  output.effectiveSafetyDays = safetyDays;

  const safetyBuffer = projectedDaily * safetyDays;
  output.safetyBuffer = safetyBuffer;

  // 10. Target Stock Level
  const targetStockLevel = projectedConsumption + leadTimeStock + safetyBuffer;
  output.targetStockLevel = targetStockLevel;

  // 11. Expiry-adjusted Usable Stock
  const batchesSnap = await getDocs(
    query(
      collection(db, 'product_batches'),
      where('tenantId', '==', tenantId),
      where('branchId', '==', branchId),
      where('productId', '==', productId)
    )
  );

  let totalUsableStock = 0;
  const currentDate = new Date();
  const shelfLifePolicyDays = (product as any).minimumAcceptableShelfLifeDays || 90;

  batchesSnap.forEach(d => {
    const batch = d.data() as ProductBatch;
    
    // Exclude unusable statuses
    if (batch.batch_status === 'quarantined' || batch.batch_status === 'expired' || batch.batch_status === 'in_transit') {
      return;
    }

    if (batch.expiryDate) {
      const expDate = new Date(batch.expiryDate);
      expDate.setHours(0, 0, 0, 0);
      const currDate = new Date(currentDate);
      currDate.setHours(0, 0, 0, 0);
      const remainingDays = Math.round((expDate.getTime() - currDate.getTime()) / (24 * 60 * 60 * 1000));
      if (remainingDays < shelfLifePolicyDays) {
        // Violates shelf life threshold, excluded entirely
        return;
      }
      
      const acceptableConsumptionDays = remainingDays - shelfLifePolicyDays;
      if (projectedDaily > 0) {
        const expectedConsumptionBeforeExpiry = projectedDaily * acceptableConsumptionDays;
        totalUsableStock += Math.min(batch.quantity || 0, expectedConsumptionBeforeExpiry);
      } else {
        totalUsableStock += batch.quantity || 0;
      }
    } else {
      totalUsableStock += batch.quantity || 0;
    }
  });

  output.expiryAdjustedUsableStock = totalUsableStock;

  // 12. Confirmed Incoming deduction
  let confirmedIncoming = 0;

  // Query dispatched POs
  const poSnap = await getDocs(
    query(
      collection(db, 'stock_orders'),
      where('tenantId', '==', tenantId),
      where('requesting_branch_id', '==', branchId),
      where('status', '==', 'dispatched')
    )
  );

  for (const docObj of poSnap.docs) {
    const linesSnap = await getDocs(
      query(
        collection(db, 'stock_order_lines'),
        where('tenantId', '==', tenantId),
        where('order_id', '==', docObj.id),
        where('product_id', '==', productId)
      )
    );
    linesSnap.forEach(lDoc => {
      const line = lDoc.data() as StockOrderLine;
      if (line.line_status === 'dispatched') {
        confirmedIncoming += (line.qty_supplied || line.qty_ordered || 0) * multiplier;
      }
    });
  }

  // Query dispatched transfers
  const transferSnap = await getDocs(
    query(
      collection(db, 'transfer_invoices'),
      where('tenantId', '==', tenantId),
      where('destination_branch_id', '==', branchId),
      where('status', '==', 'dispatched')
    )
  );

  transferSnap.forEach(dDoc => {
    const transfer = dDoc.data() as TransferInvoice;
    (transfer.items || []).forEach(item => {
      if (item.product_id === productId) {
        confirmedIncoming += (item.qty_dispatched || 0) * multiplier;
      }
    });
  });

  output.confirmedIncoming = confirmedIncoming;

  // 13. Gross Net Requirement
  const grossNet = targetStockLevel - totalUsableStock - confirmedIncoming;
  output.grossNetRequirement = Math.max(0, grossNet);

  // 14. Confidence Score logic
  let historyScore = 35 * (validStockedDays / totalDays);
  let stabilityScore = 30; // Default stable demand
  let reliabilityScore = 20; // Default high reliability
  let stockoutScore = 15 * availabilityRatio;

  // Deduct points for exceptional consumption volatility
  let penalty = 0;
  if (totalExceptionalConsumption > 0) {
    penalty = Math.min(20, Math.round(20 * (totalExceptionalConsumption / (totalValidConsumption || 1))));
  }

  const baseConfidence = historyScore + stabilityScore + reliabilityScore + stockoutScore;
  const finalConfidence = Math.max(0, Math.round(baseConfidence - penalty));

  output.confidenceScore = finalConfidence;
  
  if (finalConfidence >= settings.confidenceHighThreshold) {
    output.confidenceLabel = 'HIGH';
  } else if (finalConfidence >= settings.confidenceModerateThreshold) {
    output.confidenceLabel = 'MODERATE';
  } else {
    output.confidenceLabel = 'LOW';
  }

  return output;
}
