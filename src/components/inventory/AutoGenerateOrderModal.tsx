import React, { useState, useEffect } from 'react';
import { 
  X, 
  ChevronRight, 
  Play, 
  Layers, 
  Truck, 
  AlertTriangle, 
  Check, 
  Plus, 
  Trash2, 
  Info,
  Calendar,
  DollarSign,
  TrendingUp,
  Activity,
  UserCheck,
  RotateCw
} from 'lucide-react';
import { toast } from 'sonner';
import { 
  collection, 
  getDocs, 
  addDoc, 
  setDoc,
  doc, 
  query, 
  where 
} from 'firebase/firestore';
import { db } from '../../firebase';
import { 
  Branch, 
  Product, 
  AutoGenerateOrderRun, 
  AutoGenerateOrderLine 
} from '../../types';
import { getReplenishmentSettings, calculateProductForecast } from '../../services/forecastingService';
import { getNetworkFulfilmentRecommendations, createTransferReservationTx } from '../../services/networkFulfilmentService';
import { revalidateOrderRun, submitOrderRun } from '../../services/orderSubmissionService';
import { useAuth } from '../../contexts/AuthContext';

interface AutoGenerateOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  branches: Branch[];
}

export const AutoGenerateOrderModal: React.FC<AutoGenerateOrderModalProps> = ({ 
  isOpen, 
  onClose,
  branches
}) => {
  const { profile, activeBranchId } = useAuth();
  
  // Wizard steps: 'config' | 'processing' | 'results' | 'success'
  const [step, setStep] = useState<'config' | 'processing' | 'results' | 'success'>('config');
  
  // Progress states
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  
  // Config parameters
  const [selectedBranchId, setSelectedBranchId] = useState(activeBranchId || '');
  const [lookbackDays, setLookbackDays] = useState(30);
  const [coverageDays, setCoverageDays] = useState(30);
  const [deliveryDate, setDeliveryDate] = useState('');
  const [leadTimeMethod, setLeadTimeMethod] = useState<'MANUAL' | 'OBSERVED_MEDIAN' | 'HIGHER_OF_MANUAL_AND_OBSERVED' | 'TENANT_DEFAULT'>('HIGHER_OF_MANUAL_AND_OBSERVED');
  const [safetyPolicy, setSafetyPolicy] = useState('TENANT_DEFAULT');
  const [checkCentralStore, setCheckCentralStore] = useState(true);
  const [checkOtherBranches, setCheckOtherBranches] = useState(true);
  const [includeExceptional, setIncludeExceptional] = useState(false);
  const [applySeasonality, setApplySeasonality] = useState(false);
  const [budgetCeiling, setBudgetCeiling] = useState<number | ''>('');
  const [tempMultiplier, setTempMultiplier] = useState<number>(1.0);

  // Results state
  const [runId, setRunId] = useState<string>('');
  const [runData, setRunData] = useState<AutoGenerateOrderRun | null>(null);
  const [lines, setLines] = useState<AutoGenerateOrderLine[]>([]);
  const [activeTab, setActiveTab] = useState<'external' | 'internal' | 'review' | 'excluded'>('external');
  
  // Manual add product state
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [manualQtyPacks, setManualQtyPacks] = useState(1);
  const [manualReason, setManualReason] = useState('');

  // Revalidation & submission states
  const [revalidating, setRevalidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [revalChanges, setRevalChanges] = useState<any[]>([]);
  const [showRevalDialog, setShowRevalDialog] = useState(false);

  // Fetch products on load
  useEffect(() => {
    if (profile?.tenantId && isOpen) {
      const fetchProds = async () => {
        const prodSnap = await getDocs(query(collection(db, 'products'), where('tenantId', '==', profile.tenantId)));
        const prods = prodSnap.docs.map(d => ({ id: d.id, ...d.data() } as Product));
        setAllProducts(prods);
      };
      fetchProds();
    }
  }, [profile?.tenantId, isOpen]);

  if (!isOpen) return null;

  // Step 2: Engine calculations trigger
  const runGenerationEngine = async () => {
    if (!selectedBranchId) {
      toast.error('Please select a target branch.');
      return;
    }

    setStep('processing');
    setProgress(5);
    setProgressMsg('Verifying security and tenant memberships...');

    const tenantId = profile?.tenantId || 'demo';
    const generatedBy = profile?.email || 'System';
    const generatedAt = new Date().toISOString();

    try {
      await new Promise(r => setTimeout(r, 600));
      setProgress(15);
      setProgressMsg('Fetching replenishment configuration rules...');
      const settings = await getReplenishmentSettings(tenantId);

      // Determine analysis date ranges
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - lookbackDays);

      const analysisStartDate = start.toISOString().split('T')[0];
      const analysisEndDate = end.toISOString().split('T')[0];

      await new Promise(r => setTimeout(r, 600));
      setProgress(35);
      setProgressMsg('Evaluating daily consumption summaries...');

      // Find sellable products
      const activeProducts = allProducts.filter(p => p.status !== 'inactive');
      
      setProgress(50);
      setProgressMsg(`Running Core Forecasting models on ${activeProducts.length} items...`);

      const tempRunId = `run_${Date.now()}`;
      const results: AutoGenerateOrderLine[] = [];

      let externalCount = 0;
      let internalCount = 0;
      let manualCount = 0;

      for (let i = 0; i < activeProducts.length; i++) {
        const product = activeProducts[i];
        
        // 1. Core Forecasting
        const forecast = await calculateProductForecast({
          tenantId,
          branchId: selectedBranchId,
          productId: product.id,
          analysisStartDate,
          analysisEndDate,
          forecastCoverageDays: coverageDays,
          leadTimeMethod,
          includeExceptionalConsumption: includeExceptional,
          temporaryDemandMultiplier: tempMultiplier,
          useSeasonality: applySeasonality
        }, product, settings);

        // Calculate suggested purchase packs
        const unitsPerPack = product.unitsPerPack || 1;
        
        let originalRecommendationBaseUnits = 0;
        let originalPurchasePacks = 0;
        let originalCentralAllocation = 0;
        let originalDonorAllocations: { branchId: string; branchName: string; qtyBaseUnits: number }[] = [];

        if (forecast.calculationAllowed && forecast.grossNetRequirement > 0) {
          // 2. Network Fulfilment calculations
          const allocation = await getNetworkFulfilmentRecommendations({
            tenantId,
            branchId: selectedBranchId,
            productId: product.id,
            grossRequirement: forecast.grossNetRequirement,
            analysisStartDate,
            analysisEndDate,
            coverageDays,
            checkCentralStore,
            checkOtherBranches
          });

          originalCentralAllocation = allocation.centralAllocation;
          originalDonorAllocations = allocation.donorAllocations;
          originalRecommendationBaseUnits = allocation.remainingRequirement;

          // Convert unrounded requirement to purchase packs
          originalPurchasePacks = Math.ceil(allocation.remainingRequirement / unitsPerPack);
          
          if (originalCentralAllocation > 0 || originalDonorAllocations.length > 0) {
            internalCount++;
            
            // Create active reservations for internal allocations
            if (checkOtherBranches) {
              for (const donor of originalDonorAllocations) {
                await createTransferReservationTx({
                  tenantId,
                  sourceBranchId: donor.branchId,
                  destinationBranchId: selectedBranchId,
                  productId: product.id,
                  autoGenerateRunId: tempRunId,
                  qtyBaseUnits: donor.qtyBaseUnits,
                  createdBy: generatedBy
                });
              }
            }
          }
        }

        if (forecast.confidenceLabel === 'LOW' || !forecast.calculationAllowed) {
          manualCount++;
        }

        if (originalPurchasePacks > 0) {
          externalCount++;
        }

        const runLine: AutoGenerateOrderLine = {
          tenantId,
          runId: tempRunId,
          productId: product.id,
          productName: product.name,
          sku: product.sku || '',
          genericName: product.genericName || '',
          dosageForm: product.dosageForm || '',
          baseUnit: product.unitOfSell || 'unit',
          purchasePack: 'pack',
          unitsPerPack,
          venClass: (product as any).venClass || 'N/A',
          movementClass: (product as any).movementClass || 'N/A',
          
          originalRecommendationBaseUnits,
          originalPurchasePacks,
          originalInternalAllocation: originalCentralAllocation + originalDonorAllocations.reduce((sum, d) => sum + d.qtyBaseUnits, 0),
          originalCentralAllocation,
          originalDonorAllocations: originalDonorAllocations.map(d => ({ branchId: d.branchId, qtyBaseUnits: d.qtyBaseUnits })),

          finalRecommendationBaseUnits: originalRecommendationBaseUnits,
          finalPurchasePacks: originalPurchasePacks,
          finalInternalAllocation: originalCentralAllocation + originalDonorAllocations.reduce((sum, d) => sum + d.qtyBaseUnits, 0),
          finalCentralAllocation: originalCentralAllocation,
          finalDonorAllocations: originalDonorAllocations.map(d => ({ branchId: d.branchId, qtyBaseUnits: d.qtyBaseUnits })),

          calculationInputs: {
            costPricePerPack: product.costPricePerPack || 0,
            supplierId: product.supplierId || 'unknown'
          },
          calculationOutputs: forecast,
          confidenceScore: forecast.confidenceScore,
          warnings: forecast.warnings,
          explanation: `Projected daily requirement is ${forecast.projectedDailyConsumption.toFixed(2)} units. Gross requirement: ${forecast.grossNetRequirement.toFixed(0)} units.`,
          wasOverridden: false,
          overrideReason: null,
          overriddenBy: null,
          overriddenAt: null
        };

        results.push(runLine);

        // Update progress dynamically
        if (i % 5 === 0) {
          const progVal = Math.min(90, Math.floor(50 + (i / activeProducts.length) * 35));
          setProgress(progVal);
        }
      }

      setProgress(90);
      setProgressMsg('Saving calculations and metadata snapdocs...');

      // Save Run Document
      const runDoc: AutoGenerateOrderRun = {
        tenantId,
        runId: tempRunId,
        branchId: selectedBranchId,
        status: 'READY',
        configuration: {
          analysisStartDate,
          analysisEndDate,
          forecastCoverageDays: coverageDays,
          requiredDeliveryDate: deliveryDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          safetyPolicy,
          leadTimeMethod,
          checkCentralStore,
          checkOtherBranches,
          includeExceptionalConsumption: includeExceptional,
          applySeasonality,
          budgetCeiling: budgetCeiling === '' ? null : budgetCeiling,
          temporaryDemandMultiplier: tempMultiplier
        },
        calculationVersion: 1,
        productCountAnalysed: activeProducts.length,
        externalLineCount: externalCount,
        internalLineCount: internalCount,
        manualReviewCount: manualCount,
        generatedBy,
        generatedAt,
        updatedAt: generatedAt,
        submissionIdempotencyKey: null,
        submittedAt: null
      };

      await setDoc(doc(db, 'autoGenerateOrderRuns', tempRunId), runDoc);

      // Save Line Documents
      for (const line of results) {
        await addDoc(collection(db, 'autoGenerateOrderLines'), line);
      }

      setRunId(tempRunId);
      setRunData(runDoc);
      setLines(results);

      setProgress(100);
      toast.success('Calculations completed successfully!');
      await new Promise(r => setTimeout(r, 400));
      setStep('results');
    } catch (e: any) {
      console.error(e);
      toast.error('Failed running calculations: ' + e.message);
      setStep('config');
    }
  };

  // Override Quantity Packs
  const handleQtyOverride = (lineId: string, packs: number) => {
    const updated = lines.map(line => {
      if (line.productId === lineId) {
        const reason = window.prompt('Specify override reason code:', line.overrideReason || '');
        if (reason === null) return line; // Cancelled
        
        return {
          ...line,
          finalPurchasePacks: packs,
          finalRecommendationBaseUnits: packs * line.unitsPerPack,
          wasOverridden: true,
          overrideReason: reason || 'Manual user adjustments',
          overriddenBy: profile?.email || 'User',
          overriddenAt: new Date().toISOString()
        };
      }
      return line;
    });
    setLines(updated);
  };

  // Remove Product Line
  const handleRemoveLine = (lineId: string) => {
    if (window.confirm('Are you sure you want to remove this suggestion?')) {
      setLines(lines.filter(l => l.productId !== lineId));
    }
  };

  // Manual Add Product
  const handleManualAddProduct = () => {
    if (!selectedProductId) {
      toast.error('Select a product to add.');
      return;
    }
    const product = allProducts.find(p => p.id === selectedProductId);
    if (!product) return;

    if (lines.find(l => l.productId === selectedProductId)) {
      toast.error('Product already exists in this run.');
      return;
    }

    const unitsPerPack = product.unitsPerPack || 1;
    const newLine: AutoGenerateOrderLine = {
      tenantId: profile?.tenantId || 'demo',
      runId,
      productId: product.id,
      productName: product.name,
      sku: product.sku || '',
      genericName: product.genericName || '',
      dosageForm: product.dosageForm || '',
      baseUnit: product.unitOfSell || 'unit',
      purchasePack: 'pack',
      unitsPerPack,
      
      originalRecommendationBaseUnits: 0,
      originalPurchasePacks: 0,
      originalInternalAllocation: 0,
      originalCentralAllocation: 0,
      originalDonorAllocations: [],

      finalRecommendationBaseUnits: manualQtyPacks * unitsPerPack,
      finalPurchasePacks: manualQtyPacks,
      finalInternalAllocation: 0,
      finalCentralAllocation: 0,
      finalDonorAllocations: [],

      calculationInputs: {
        costPricePerPack: product.costPricePerPack || 0,
        supplierId: product.supplierId || 'unknown'
      },
      calculationOutputs: null,
      confidenceScore: 100,
      warnings: [],
      explanation: 'Manually added by operator.',
      wasOverridden: true,
      overrideReason: manualReason || 'Manual addition',
      overriddenBy: profile?.email || 'User',
      overriddenAt: new Date().toISOString(),
      isManualAdd: true
    };

    setLines([newLine, ...lines]);
    setShowAddProduct(false);
    setSelectedProductId('');
    setManualQtyPacks(1);
    setManualReason('');
    toast.success(`${product.name} added manually.`);
  };

  // Live Revalidation trigger
  const triggerRevalidation = async () => {
    setRevalidating(true);
    try {
      const res = await revalidateOrderRun(runId);
      if (res.hasChanges) {
        setRevalChanges(res.warnings);
        setShowRevalDialog(true);
      } else {
        // Safe to submit immediately
        await executeFinalSubmission();
      }
    } catch (e: any) {
      toast.error('Revalidation failed.');
    } finally {
      setRevalidating(false);
    }
  };

  // Execute Submission
  const executeFinalSubmission = async () => {
    setSubmitting(true);
    try {
      // First save overrides of lines back to firestore
      for (const line of lines) {
        // Query to find line id matching productId
        const linesSnap = await getDocs(
          query(
            collection(db, 'autoGenerateOrderLines'),
            where('runId', '==', runId),
            where('productId', '==', line.productId)
          )
        );
        if (!linesSnap.empty) {
          const docId = linesSnap.docs[0].id;
          await setDoc(doc(db, 'autoGenerateOrderLines', docId), line);
        } else {
          // Manual adds don't have firestore records yet, add them
          await addDoc(collection(db, 'autoGenerateOrderLines'), line);
        }
      }

      await submitOrderRun(runId, profile?.uid || '', profile?.email || '');
      toast.success('Replenishments submitted successfully!');
      setStep('success');
    } catch (e: any) {
      toast.error('Submission failed: ' + e.message);
    } finally {
      setSubmitting(false);
      setShowRevalDialog(false);
    }
  };

  // Computed values
  const totalExternalCost = lines.reduce((sum, l) => sum + (l.finalPurchasePacks * ((l.calculationInputs as any)?.costPricePerPack || 0)), 0);
  const budgetVariance = runData?.configuration.budgetCeiling 
    ? runData.configuration.budgetCeiling - totalExternalCost 
    : 0;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-[1400px] max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-zinc-100 animate-scale-up">
        
        {/* Header */}
        <div className="px-8 py-5 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600">
              <RotateCw className="animate-spin-slow" size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-900">Auto-Generate Order Replenishment</h2>
              <p className="text-xs text-zinc-500">Deterministic multi-criteria forecasting & network donor allocation</p>
            </div>
          </div>
          {step !== 'processing' && (
            <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-full text-zinc-400 hover:text-zinc-600 transition-colors">
              <X size={20} />
            </button>
          )}
        </div>

        {/* Wizard Steps */}
        {step === 'config' && (
          <div className="p-8 flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <h3 className="text-lg font-bold text-zinc-900 border-b pb-2">replenishment config</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-600">Requesting Branch</label>
                  <select 
                    value={selectedBranchId}
                    onChange={(e) => setSelectedBranchId(e.target.value)}
                    className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm font-semibold"
                  >
                    <option value="">Select Branch</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-600">Forecast Coverage Days</label>
                  <select 
                    value={coverageDays}
                    onChange={(e) => setCoverageDays(Number(e.target.value))}
                    className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm font-semibold"
                  >
                    <option value={14}>14 Days Cover</option>
                    <option value={30}>30 Days Cover</option>
                    <option value={45}>45 Days Cover</option>
                    <option value={60}>60 Days Cover</option>
                    <option value={90}>90 Days Cover</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-600">Analysis Lookback</label>
                  <select 
                    value={lookbackDays}
                    onChange={(e) => setLookbackDays(Number(e.target.value))}
                    className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm font-semibold"
                  >
                    <option value={14}>Last 14 Days</option>
                    <option value={30}>Last 30 Days (Default)</option>
                    <option value={60}>Last 60 Days</option>
                    <option value={90}>Last 90 Days</option>
                    <option value={180}>Last 180 Days</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-600">Required Delivery Date</label>
                  <div className="relative">
                    <input 
                      type="date" 
                      value={deliveryDate}
                      onChange={(e) => setDeliveryDate(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm font-semibold"
                    />
                    <Calendar className="absolute left-3 top-3.5 text-zinc-400" size={16} />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-600">Lead-Time Method</label>
                  <select 
                    value={leadTimeMethod}
                    onChange={(e) => setLeadTimeMethod(e.target.value as any)}
                    className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm font-semibold"
                  >
                    <option value="TENANT_DEFAULT">Tenant Defaults</option>
                    <option value="MANUAL">Manual Configuration</option>
                    <option value="OBSERVED_MEDIAN">Observed Medians (GRNs)</option>
                    <option value="HIGHER_OF_MANUAL_AND_OBSERVED">Higher of Manual & Observed</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-600">Safety Policy</label>
                  <select 
                    value={safetyPolicy}
                    onChange={(e) => setSafetyPolicy(e.target.value)}
                    className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm font-semibold"
                  >
                    <option value="TENANT_DEFAULT">Tenant Policy Cover</option>
                    <option value="VEN">VEN Priority Buffer</option>
                    <option value="FAST">Fast Mover Multiplier</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <h3 className="text-lg font-bold text-zinc-900 border-b pb-2">replenishment methods & constraints</h3>
              <div className="space-y-4">
                <label className="flex items-center gap-3 p-4 bg-zinc-50 rounded-2xl hover:bg-zinc-100/50 cursor-pointer transition-colors border border-zinc-150">
                  <input 
                    type="checkbox" 
                    checked={checkCentralStore}
                    onChange={(e) => setCheckCentralStore(e.target.checked)}
                    className="w-4.5 h-4.5 text-emerald-600 border-zinc-300 rounded focus:ring-emerald-500"
                  />
                  <div>
                    <span className="text-sm font-bold text-zinc-800 block">Check Central HQ Store</span>
                    <span className="text-xs text-zinc-500 block">Exempts stock from external order if available at HQ store.</span>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-4 bg-zinc-50 rounded-2xl hover:bg-zinc-100/50 cursor-pointer transition-colors border border-zinc-150">
                  <input 
                    type="checkbox" 
                    checked={checkOtherBranches}
                    onChange={(e) => setCheckOtherBranches(e.target.checked)}
                    className="w-4.5 h-4.5 text-emerald-600 border-zinc-300 rounded focus:ring-emerald-500"
                  />
                  <div>
                    <span className="text-sm font-bold text-zinc-800 block">Scan Interbranch Networks</span>
                    <span className="text-xs text-zinc-500 block">Safeguards other branch inventory and transfers excess allocations.</span>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-4 bg-zinc-50 rounded-2xl hover:bg-zinc-100/50 cursor-pointer transition-colors border border-zinc-150">
                  <input 
                    type="checkbox" 
                    checked={includeExceptional}
                    onChange={(e) => setIncludeExceptional(e.target.checked)}
                    className="w-4.5 h-4.5 text-emerald-600 border-zinc-300 rounded focus:ring-emerald-500"
                  />
                  <div>
                    <span className="text-sm font-bold text-zinc-800 block">Include Exceptional Demands</span>
                    <span className="text-xs text-zinc-500 block">Keeps erratic campaigns or high-bulk clinic requisitions in calculation.</span>
                  </div>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-600">Budget Ceiling (UGX)</label>
                  <input 
                    type="number" 
                    value={budgetCeiling}
                    onChange={(e) => setBudgetCeiling(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="None limit"
                    className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm font-semibold"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-600">Temp Demand Multiplier</label>
                  <input 
                    type="number" 
                    step="0.1"
                    value={tempMultiplier}
                    onChange={(e) => setTempMultiplier(Number(e.target.value))}
                    className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm font-semibold"
                  />
                </div>
              </div>
            </div>

            <div className="md:col-span-2 border-t pt-6 flex justify-end gap-3">
              <button onClick={onClose} className="px-6 py-2.5 border border-zinc-200 hover:bg-zinc-50 text-zinc-700 font-bold rounded-xl text-sm transition-colors">
                Cancel
              </button>
              <button 
                onClick={runGenerationEngine}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm transition-colors inline-flex items-center gap-2"
              >
                <Play size={16} fill="white" />
                Launch Calculations
              </button>
            </div>
          </div>
        )}

        {step === 'processing' && (
          <div className="p-12 flex-1 flex flex-col items-center justify-center space-y-6">
            <div className="relative w-24 h-24">
              <div className="absolute inset-0 rounded-full border-4 border-emerald-50 border-t-emerald-600 animate-spin"></div>
              <div className="absolute inset-2 rounded-full border-4 border-zinc-50 border-t-zinc-300 animate-spin-reverse"></div>
            </div>
            <div className="text-center space-y-2">
              <h4 className="text-lg font-bold text-zinc-900">Calculating replenishment requirements...</h4>
              <p className="text-sm text-zinc-500">{progressMsg}</p>
            </div>
            <div className="w-full max-w-md bg-zinc-100 h-2.5 rounded-full overflow-hidden">
              <div className="bg-emerald-600 h-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
            </div>
            <span className="text-xs font-bold text-emerald-600">{progress}% COMPLETE</span>
          </div>
        )}

        {step === 'results' && (
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Quick stats cards */}
            <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-4 bg-zinc-50/50 border-b border-zinc-100">
              <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm flex items-center gap-3">
                <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                  <DollarSign size={20} />
                </div>
                <div>
                  <span className="text-xs text-zinc-500 block">External Cost</span>
                  <span className="text-base font-bold text-zinc-900 block">UGX {totalExternalCost.toLocaleString()}</span>
                </div>
              </div>

              {runData?.configuration.budgetCeiling && (
                <div className={`p-4 rounded-2xl border shadow-sm flex items-center gap-3 bg-white ${budgetVariance < 0 ? 'border-red-200' : 'border-zinc-200'}`}>
                  <div className={`p-2.5 rounded-xl ${budgetVariance < 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                    <AlertTriangle size={20} />
                  </div>
                  <div>
                    <span className="text-xs text-zinc-500 block">Budget Variance</span>
                    <span className={`text-base font-bold block ${budgetVariance < 0 ? 'text-red-600' : 'text-green-600'}`}>
                      UGX {budgetVariance.toLocaleString()}
                    </span>
                  </div>
                </div>
              )}

              <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm flex items-center gap-3">
                <div className="p-2.5 bg-purple-50 text-purple-600 rounded-xl">
                  <Layers size={20} />
                </div>
                <div>
                  <span className="text-xs text-zinc-500 block">PO Draft Lines</span>
                  <span className="text-base font-bold text-zinc-900 block">
                    {lines.filter(l => l.finalPurchasePacks > 0).length} Items
                  </span>
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm flex items-center gap-3">
                <div className="p-2.5 bg-yellow-50 text-yellow-600 rounded-xl">
                  <Truck size={20} />
                </div>
                <div>
                  <span className="text-xs text-zinc-500 block">Network Transfers</span>
                  <span className="text-base font-bold text-zinc-900 block">
                    {lines.filter(l => l.finalInternalAllocation > 0).length} Items
                  </span>
                </div>
              </div>
            </div>

            {/* Results sections tabs */}
            <div className="px-6 py-2 border-b flex items-center justify-between">
              <div className="flex gap-2">
                <button 
                  onClick={() => setActiveTab('external')}
                  className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${activeTab === 'external' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}
                >
                  A. External Purchase Draft ({lines.filter(l => l.finalPurchasePacks > 0).length})
                </button>
                <button 
                  onClick={() => setActiveTab('internal')}
                  className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${activeTab === 'internal' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}
                >
                  B. Internal Fulfilment ({lines.filter(l => l.finalInternalAllocation > 0).length})
                </button>
                <button 
                  onClick={() => setActiveTab('review')}
                  className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${activeTab === 'review' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}
                >
                  C. Manual Review ({lines.filter(l => l.confidenceScore < 55 || !l.calculationOutputs?.calculationAllowed).length})
                </button>
                <button 
                  onClick={() => setActiveTab('excluded')}
                  className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${activeTab === 'excluded' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}
                >
                  D. Excluded ({lines.filter(l => l.finalPurchasePacks === 0 && l.finalInternalAllocation === 0).length})
                </button>
              </div>

              <div className="flex gap-2">
                <button 
                  onClick={() => setShowAddProduct(true)}
                  className="px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold rounded-lg text-xs inline-flex items-center gap-1.5 transition-colors"
                >
                  <Plus size={14} /> Add Product
                </button>
              </div>
            </div>

            {/* Tables Area */}
            <div className="flex-1 overflow-y-auto p-6">
              {activeTab === 'external' && (
                <div className="overflow-x-auto border border-zinc-200 rounded-2xl">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-zinc-50 text-zinc-600 font-bold border-b border-zinc-200">
                        <th className="p-3">Product Name</th>
                        <th className="p-3">Usable Stock</th>
                        <th className="p-3">Incoming</th>
                        <th className="p-3">Projected Cover</th>
                        <th className="p-3">Requirement</th>
                        <th className="p-3">Suggested Packs</th>
                        <th className="p-3">Unit Cost</th>
                        <th className="p-3">Total Cost</th>
                        <th className="p-3">Confidence</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.filter(l => l.finalPurchasePacks > 0).map(line => {
                        const cost = line.finalPurchasePacks * ((line.calculationInputs as any)?.costPricePerPack || 0);
                        return (
                          <tr key={line.productId} className="border-b border-zinc-150 hover:bg-zinc-50/50">
                            <td className="p-3 font-semibold text-zinc-900">{line.productName}</td>
                            <td className="p-3 text-zinc-600">{line.calculationOutputs?.expiryAdjustedUsableStock || 0}</td>
                            <td className="p-3 text-zinc-600">{line.calculationOutputs?.confirmedIncoming || 0}</td>
                            <td className="p-3 text-zinc-600">{line.calculationOutputs?.projectedConsumption?.toFixed(0) || 0}</td>
                            <td className="p-3 font-bold text-zinc-900">{line.finalRecommendationBaseUnits}</td>
                            <td className="p-3">
                              <input 
                                type="number" 
                                value={line.finalPurchasePacks}
                                onChange={(e) => handleQtyOverride(line.productId, Number(e.target.value))}
                                className="w-16 px-2 py-1 bg-zinc-50 border rounded text-center text-zinc-800 font-bold outline-none focus:ring-1 focus:ring-emerald-500"
                              />
                            </td>
                            <td className="p-3 text-zinc-500">UGX {((line.calculationInputs as any)?.costPricePerPack || 0).toLocaleString()}</td>
                            <td className="p-3 font-bold text-zinc-800">UGX {cost.toLocaleString()}</td>
                            <td className="p-3">
                              <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                                line.confidenceScore >= 80 ? 'bg-green-50 text-green-700' :
                                line.confidenceScore >= 55 ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700'
                              }`}>
                                {line.confidenceScore}%
                              </span>
                            </td>
                            <td className="p-3 text-right">
                              <button onClick={() => handleRemoveLine(line.productId)} className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg hover:text-red-700 transition-colors">
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'internal' && (
                <div className="overflow-x-auto border border-zinc-200 rounded-2xl">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-zinc-50 text-zinc-600 font-bold border-b border-zinc-200">
                        <th className="p-3">Product Name</th>
                        <th className="p-3">Gross Net Shortage</th>
                        <th className="p-3">Central HQ Allocation</th>
                        <th className="p-3">Interbranch Donors</th>
                        <th className="p-3">Unrounded External Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.filter(l => l.finalInternalAllocation > 0).map(line => (
                        <tr key={line.productId} className="border-b border-zinc-150 hover:bg-zinc-50/50">
                          <td className="p-3 font-semibold text-zinc-900">{line.productName}</td>
                          <td className="p-3 font-bold text-zinc-700">{line.calculationOutputs?.grossNetRequirement || 0}</td>
                          <td className="p-3 text-emerald-600 font-bold">+{line.finalCentralAllocation || 0}</td>
                          <td className="p-3">
                            {line.finalDonorAllocations?.length > 0 ? (
                              <div className="space-y-1">
                                {line.finalDonorAllocations.map(d => (
                                  <div key={d.branchId} className="text-xs bg-zinc-100 text-zinc-700 px-2 py-0.5 rounded-md inline-block mr-1">
                                    Branch {branches.find(b => b.id === d.branchId)?.name || d.branchId}: +{d.qtyBaseUnits} units
                                  </div>
                                ))}
                              </div>
                            ) : 'None'}
                          </td>
                          <td className="p-3 font-bold text-zinc-900">{line.finalRecommendationBaseUnits} units</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'review' && (
                <div className="overflow-x-auto border border-zinc-200 rounded-2xl">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-zinc-50 text-zinc-600 font-bold border-b border-zinc-200">
                        <th className="p-3">Product Name</th>
                        <th className="p-3">Confidence Status</th>
                        <th className="p-3">Reason / Details</th>
                        <th className="p-3">Suggested Packs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.filter(l => l.confidenceScore < 55 || !l.calculationOutputs?.calculationAllowed).map(line => (
                        <tr key={line.productId} className="border-b border-zinc-150 hover:bg-zinc-50/50 bg-yellow-50/10">
                          <td className="p-3 font-semibold text-zinc-900">{line.productName}</td>
                          <td className="p-3">
                            <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-xs">
                              {line.calculationOutputs?.calculationAllowed === false ? 'BLOCKED' : 'LOW CONFIDENCE'}
                            </span>
                          </td>
                          <td className="p-3 text-zinc-600 text-xs font-semibold">
                            {line.calculationOutputs?.manualReviewReasons?.join(', ') || line.warnings?.join(', ') || 'Low statistical demand history'}
                          </td>
                          <td className="p-3">
                            <input 
                              type="number" 
                              value={line.finalPurchasePacks}
                              onChange={(e) => handleQtyOverride(line.productId, Number(e.target.value))}
                              className="w-16 px-2 py-1 bg-zinc-50 border rounded text-center text-zinc-800 font-bold outline-none"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'excluded' && (
                <div className="overflow-x-auto border border-zinc-200 rounded-2xl">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-zinc-50 text-zinc-600 font-bold border-b border-zinc-200">
                        <th className="p-3">Product Name</th>
                        <th className="p-3">Usable Stock</th>
                        <th className="p-3">Incoming Commitments</th>
                        <th className="p-3">Gross Requirement</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.filter(l => l.finalPurchasePacks === 0 && l.finalInternalAllocation === 0).map(line => (
                        <tr key={line.productId} className="border-b border-zinc-150 hover:bg-zinc-50/20 bg-zinc-50/10">
                          <td className="p-3 text-zinc-500 font-semibold">{line.productName}</td>
                          <td className="p-3 text-zinc-400">{line.calculationOutputs?.expiryAdjustedUsableStock || 0}</td>
                          <td className="p-3 text-zinc-400">{line.calculationOutputs?.confirmedIncoming || 0}</td>
                          <td className="p-3 text-zinc-400">{line.calculationOutputs?.grossNetRequirement || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Bottom Actions */}
            <div className="p-6 border-t flex justify-between items-center bg-zinc-50">
              <span className="text-xs text-zinc-500 font-bold uppercase">
                CALCULATION RUN KEY: <span className="font-mono text-zinc-800">{runId}</span>
              </span>
              <div className="flex gap-3">
                <button onClick={() => setStep('config')} className="px-5 py-2.5 border rounded-xl font-bold text-sm text-zinc-700 hover:bg-white transition-colors bg-transparent">
                  Back Configuration
                </button>
                <button 
                  onClick={triggerRevalidation}
                  disabled={revalidating}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm transition-colors inline-flex items-center gap-1.5 shadow-md shadow-emerald-600/10"
                >
                  {revalidating ? 'Revalidating...' : 'Review & Submit'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Success Screen */}
        {step === 'success' && (
          <div className="p-12 flex-1 flex flex-col items-center justify-center space-y-6 animate-fade-in">
            <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center text-green-600 shadow-md">
              <Check size={32} />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-xl font-bold text-zinc-900">Replenishments Staged Successfully!</h3>
              <p className="text-sm text-zinc-500">Draft orders and interbranch transfer invoices have been generated and reservations completed.</p>
            </div>
            <button onClick={onClose} className="px-6 py-2.5 bg-zinc-900 text-white font-bold rounded-xl text-sm hover:bg-zinc-800 transition-colors shadow-lg">
              Close Console
            </button>
          </div>
        )}

        {/* Manual Add Product dialog overlay */}
        {showAddProduct && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-55 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl border animate-scale-up">
              <div className="flex justify-between items-center border-b pb-2">
                <h4 className="font-bold text-zinc-800 text-base">Add Product Manually</h4>
                <button onClick={() => setShowAddProduct(false)} className="text-zinc-400 hover:text-zinc-600">
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-600">Product</label>
                  <select 
                    value={selectedProductId}
                    onChange={(e) => setSelectedProductId(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-50 border rounded-lg text-sm"
                  >
                    <option value="">Select product...</option>
                    {allProducts.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-600">Purchase Packs Qty</label>
                  <input 
                    type="number" 
                    value={manualQtyPacks}
                    onChange={(e) => setManualQtyPacks(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-zinc-50 border rounded-lg text-sm text-center font-bold"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-600">Reason Override</label>
                  <textarea 
                    value={manualReason}
                    onChange={(e) => setManualReason(e.target.value)}
                    placeholder="Enter reason..."
                    className="w-full px-3 py-2 bg-zinc-50 border rounded-lg text-sm h-16 outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t pt-3">
                <button onClick={() => setShowAddProduct(false)} className="px-4 py-2 border rounded-lg text-xs font-semibold hover:bg-zinc-50">
                  Cancel
                </button>
                <button onClick={handleManualAddProduct} className="px-4 py-2 bg-emerald-600 text-white font-bold rounded-lg text-xs hover:bg-emerald-700">
                  Confirm Add
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Live Revalidation warning dialog */}
        {showRevalDialog && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-55 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-xl border animate-scale-up">
              <div className="flex items-center gap-3 border-b pb-2 text-yellow-600">
                <AlertTriangle size={24} />
                <h4 className="font-bold text-zinc-800 text-base">Live Data Changes Detected</h4>
              </div>
              <p className="text-xs text-zinc-500">
                Some inventory levels or pricing configurations modified after generating this draft. Please review before final submission:
              </p>
              <div className="space-y-2 max-h-48 overflow-y-auto border p-3 rounded-lg bg-zinc-50">
                {revalChanges.map((warning, i) => (
                  <div key={i} className="text-xs border-b pb-1 last:border-0 last:pb-0 space-y-1">
                    <span className="font-bold text-zinc-800 block">{warning.productName}</span>
                    <span className="text-zinc-600 block">{warning.message}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 border-t pt-3">
                <button onClick={() => setShowRevalDialog(false)} className="px-4 py-2 border rounded-lg text-xs font-semibold hover:bg-zinc-50">
                  Return Review
                </button>
                <button 
                  onClick={executeFinalSubmission}
                  disabled={submitting}
                  className="px-4 py-2 bg-emerald-600 text-white font-bold rounded-lg text-xs hover:bg-emerald-700"
                >
                  {submitting ? 'Submitting...' : 'Accept & Force Submit'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
