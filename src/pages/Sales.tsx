import React, { useState, useEffect } from 'react';
import { 
  Search, ShoppingCart, Plus, Minus, Trash2, CreditCard, Banknote, 
  Smartphone, Receipt, Package, User, Building2, Stethoscope, 
  Truck, Percent, Check, X, ChevronRight, ChevronDown, Video, Printer, ShieldCheck,
  History, Filter, Calendar, ArrowLeft, AlertCircle, RotateCcw, Edit2, FileText
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { firestoreService } from '../services/firestore';
import { 
  logMovementAndAggregateInTx, 
  getBranchProductBatchRefs, 
  getBaseUnitMultiplier,
  logSaleMovements,
  reconcileSaleConsumptionMovements,
  isInventoryBatchUnexpired
} from '../services/consumptionService';
import { 
  Product, Sale, SaleItem, SaleContext, PaymentMethodType, 
  Staff, Branch, ProductBatch, BillableService, 
  InstitutionRegistry, EODReconciliation, Client, SystemSettings,
  AuditLog, SaleRevision
} from '../types';
import { toast } from 'sonner';
import { format, startOfDay, endOfDay } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { where, query, collection, doc, serverTimestamp } from 'firebase/firestore';
import { QuotationPreview } from '../components/sales/QuotationPreview';
import { A4InvoiceTemplate } from '../components/sales/A4InvoiceTemplate';
import { QuotationsLog } from '../components/sales/QuotationsLog';
import { openReceiptPrintWindow, printThermalReceipt } from '../utils/receiptPrinting';
import { canOperatePos, formatPosCheckoutError } from '../utils/posAuthorization';
import type { SellingTierCode } from '../types/sellingTier';
import { resolveSellingTiers } from '../services/sellingTierService';
import { buildTierCartItem, getCartLineIdentity, getProductUsableBaseStock, getReservedBaseQuantityForProduct, mergeTierCartItem, replaceTierCartPrice, replaceTierCartQuantity } from '../services/posTierCartService';
import { reviseSaleInventoryAtomically, voidSaleInventoryAtomically } from '../services/saleInventoryIntegrityService';
import { convertQuotationToSale, reconcilePendingPosFinancials, reconcilePosWelfarePosting } from '../services/posFinancialPostingService';
import { db } from '../firebase';


function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function generateUUID() {
  if (typeof window !== 'undefined' && window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const Sales: React.FC = () => {
  const { profile, activeBranchId, activeBranch, hasPermission } = useAuth();
  const canProcessSales = canOperatePos(profile, hasPermission('sales', 'operate'));
  const [view, setView] = useState<'pos' | 'ledger' | 'quotations'>('pos');
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [services, setServices] = useState<BillableService[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [institutions, setInstitutions] = useState<InstitutionRegistry[]>([]);
  const [prescribers, setPrescribers] = useState<any[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  
  // Dynamic branch-specific branding falling back to global systemSettings branding if branch-specific is not set
  const brandCompanyName = activeBranch?.brandName || systemSettings?.branding?.companyName || 'PharmHelm Pharmacy';
  const brandLogoUrl = activeBranch?.brandLogoUrl || systemSettings?.branding?.logoUrl;
  const brandNdaReg = activeBranch?.brandNdaRegNumber || systemSettings?.branding?.ndaRegNumber || 'NDA/WHL/2026/0847';
  const brandReceiptFooter = activeBranch?.brandReceiptFooter || systemSettings?.branding?.receiptFooter || 'Thank you for your business!';
  
  const [activeTab, setActiveTab] = useState<'products' | 'services'>('products');
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [context, setContext] = useState<SaleContext>('walk-in');
  
  const [selectedPatient, setSelectedPatient] = useState<Client | null>(null);
  const [selectedInstitution, setSelectedInstitution] = useState<InstitutionRegistry | null>(null);
  const [selectedPrescriber, setSelectedPrescriber] = useState<any>(null);
  
  const [discountPercentage, setDiscountPercentage] = useState<number>(0);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isExceptionalConsumption, setIsExceptionalConsumption] = useState(false);
  const [exceptionalConsumptionReason, setExceptionalConsumptionReason] = useState('');
  const [isServiceModalOpen, setIsServiceModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<BillableService | null>(null);
  const [editingSaleId, setEditingSaleId] = useState<string | null>(null);
  const [isReceiptEditModalOpen, setIsReceiptEditModalOpen] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<Sale | null>(null);

  const [showQuotationModal, setShowQuotationModal] = useState(false);
  const [resumedQuotationId, setResumedQuotationId] = useState<string | null>(null);
  const [showA4InvoiceModal, setShowA4InvoiceModal] = useState(false);
  const [selectedA4ReceiptId, setSelectedA4ReceiptId] = useState<string | null>(null);

  // Direct Ledger Edit states
  const [ledgerEditingSale, setLedgerEditingSale] = useState<Sale | null>(null);
  const [editedItems, setEditedItems] = useState<SaleItem[]>([]);
  const [editedDiscountPercentage, setEditedDiscountPercentage] = useState<number>(0);
  const [editedPaymentMethod, setEditedPaymentMethod] = useState<string>('cash');
  const [editedContext, setEditedContext] = useState<string>('walk-in');
  const [editedPatientId, setEditedPatientId] = useState<string | null>(null);
  const [editedPatientName, setEditedPatientName] = useState<string | null>(null);
  const [ledgerEditSearchTerm, setLedgerEditSearchTerm] = useState('');
  const [isSavingLedgerEdit, setIsSavingLedgerEdit] = useState(false);

  useEffect(() => {
    if (ledgerEditingSale) {
      setEditedItems(ledgerEditingSale.items.map(item => ({ ...item })));
      setEditedDiscountPercentage(ledgerEditingSale.discountPercentage || 0);
      setEditedPaymentMethod(ledgerEditingSale.paymentMethod);
      setEditedContext(ledgerEditingSale.context || 'walk-in');
      setEditedPatientId(ledgerEditingSale.patientId || null);
      setEditedPatientName(ledgerEditingSale.patientName || null);
    } else {
      setEditedItems([]);
      setEditedDiscountPercentage(0);
      setEditedPaymentMethod('cash');
      setEditedContext('walk-in');
      setEditedPatientId(null);
      setEditedPatientName(null);
    }
  }, [ledgerEditingSale]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>('cash');
  const [secondaryPaymentMethod, setSecondaryPaymentMethod] = useState<PaymentMethodType>('cash');
  const [isProcessing, setIsProcessing] = useState(false);
  const checkoutAttemptRef = React.useRef<{ saleId: string; receiptNumber: string } | null>(null);
  const [isNewPatientModalOpen, setIsNewPatientModalOpen] = useState(false);
  const [isPatientDropdownOpen, setIsPatientDropdownOpen] = useState(false);
  const [patientSearchTerm, setPatientSearchTerm] = useState('');
  const [isInstitutionDropdownOpen, setIsInstitutionDropdownOpen] = useState(false);
  const [institutionSearchTerm, setInstitutionSearchTerm] = useState('');
  const [isPrescriberDropdownOpen, setIsPrescriberDropdownOpen] = useState(false);
  const [prescriberSearchTerm, setPrescriberSearchTerm] = useState('');

  // Fetch sales for ledger
  useEffect(() => {
    if (view === 'ledger' && profile?.tenantId && activeBranchId) {
      const unsubscribe = firestoreService.subscribeToCollectionByQuery<Sale>(
        'sales',
        profile.tenantId,
        [
          where('status', 'in', ['completed', 'voided']),
          where('branchId', '==', activeBranchId)
        ],
        (data) => setSales(data.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()))
      );
      return () => unsubscribe();
    }
  }, [view, profile?.tenantId, activeBranchId]);

  // Fetch staff for ledger filters
  useEffect(() => {
    if (profile?.tenantId) {
      const unsubscribe = firestoreService.subscribeToCollection<Staff>('staff', profile.tenantId, setStaff);
      return () => unsubscribe();
    }
  }, [profile?.tenantId]);

  const isEmployee = selectedPatient?.labels?.includes('EMPLOYEE');
  const defaultWelfare = systemSettings?.operationalConfig?.pos?.welfareAllocationDefault || 50000;

  const combinedPatients = [
    ...clients.map(c => ({ ...c, isStaff: false })),
    ...staff.map(s => ({
      id: s.id,
      full_name: s.full_name || s.username || 'Unknown Staff',
      phone_number: s.phone_number || 'N/A',
      labels: ['EMPLOYEE', ...(s.assigned_branches || [])],
      welfare_allocation_ugx: s.welfare_limit || defaultWelfare,
      welfare_used_ytd: s.welfare_spent || 0,
      isStaff: true
    }))
  ];

  const currentAllocation = selectedPatient?.welfare_allocation_ugx || defaultWelfare;
  const welfareBalance = selectedPatient ? (currentAllocation - (selectedPatient.welfare_used_ytd || 0)) : 0;

  useEffect(() => {
    if (profile?.tenantId) {
      const unsubProducts = firestoreService.subscribeToCollection<Product>('products', profile.tenantId, setProducts);
      
      // Only subscribe to batches for the active branch
      let unsubBatches = () => {};
      if (activeBranchId) {
        unsubBatches = firestoreService.subscribeToCollectionByQuery<ProductBatch>(
          'product_batches',
          profile.tenantId,
          [where('branchId', '==', activeBranchId), where('batch_status', '==', 'active')],
          setBatches
        );
      } else {
        unsubBatches = firestoreService.subscribeToCollection<ProductBatch>('product_batches', profile.tenantId, setBatches);
      }

      const unsubServices = firestoreService.subscribeToCollection<BillableService>('billable_services', profile.tenantId, setServices);
      const unsubClients = firestoreService.subscribeToCollection<any>('clients', profile.tenantId, setClients);
      const unsubInstitutions = firestoreService.subscribeToCollection<any>('institutions', profile.tenantId, setInstitutions);
      const unsubPrescribers = firestoreService.subscribeToCollection<any>('prescribers', profile.tenantId, setPrescribers);
      
      const unsubSettings = firestoreService.subscribeToCollection<SystemSettings>('system_settings', profile.tenantId, (docs) => {
        if (docs.length > 0) setSystemSettings(docs[0]);
      });
      
      return () => {
        unsubProducts();
        unsubBatches();
        unsubServices();
        unsubClients();
        unsubInstitutions();
        unsubPrescribers();
        unsubSettings();
      };
    }
  }, [profile?.tenantId, activeBranchId]);

  useEffect(() => {
    if (!profile?.tenantId || !activeBranchId) return;
    reconcilePendingPosFinancials({
      tenantId: profile.tenantId, branchId: activeBranchId, actorId: profile.uid,
      actorName: profile.full_name || profile.displayName || 'POS Staff'
    }).catch(error => console.warn('Pending POS finance reconciliation could not complete:', error));
  }, [profile?.tenantId, profile?.uid, activeBranchId]);

  useEffect(() => {
    if (!profile?.tenantId || !activeBranchId) return;
    reconcileSaleConsumptionMovements({
      tenantId: profile.tenantId,
      branchId: activeBranchId,
      createdBy: profile.uid,
      maxSales: 100
    }).catch(error => console.warn('Pending sale consumption reconciliation could not complete:', error));
  }, [profile?.tenantId, profile?.uid, activeBranchId]);

  useEffect(() => {
    if (selectedPatient?.discountRate) {
      setDiscountPercentage(selectedPatient.discountRate);
    } else if (selectedInstitution?.discountRate) {
      setDiscountPercentage(selectedInstitution.discountRate);
    } else {
      setDiscountPercentage(0);
    }
  }, [selectedPatient, selectedInstitution]);

  const filteredItems = activeTab === 'products' 
    ? products.filter(p => {
        const hasStock = batches.some(b => b.productId === p.id && b.quantity > 0);
        const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          p.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
          p.genericName?.toLowerCase().includes(searchTerm.toLowerCase());
        return hasStock && matchesSearch;
      })
    : services.filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase()));

  const filteredPatients = combinedPatients.filter(p => 
    (p.full_name || '').toLowerCase().includes(patientSearchTerm.toLowerCase()) ||
    (p.phone_number || '').includes(patientSearchTerm)
  );

  const filteredInstitutions = institutions.filter(inst => 
    (inst.supplier_name || '').toLowerCase().includes(institutionSearchTerm.toLowerCase())
  );

  const filteredPrescribers = prescribers.filter(pr => 
    (pr.full_name || '').toLowerCase().includes(prescriberSearchTerm.toLowerCase())
  );

  // Global F12 Shortcut to open checkout modal
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F12') {
        e.preventDefault();
        if (cart.length > 0) {
          handleCheckout();
        } else {
          toast.warning("Cannot checkout: Basket is empty");
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [cart, context, selectedPatient, selectedInstitution, selectedPrescriber]);

  const addToCart = (item: Product | BillableService, requestedTierCode?: SellingTierCode) => {
    if (activeTab === 'products') {
      const product = item as Product;
      const resolution = resolveSellingTiers(product, systemSettings);

      if (resolution.mode === 'multi-tier') {
        if (!profile?.tenantId || !activeBranchId) {
          toast.error('Select an active branch before adding multi-tier stock.');
          return;
        }
        const tier = requestedTierCode
          ? resolution.tiers.find(candidate => candidate.code === requestedTierCode)
          : resolution.defaultTier;
        if (!tier) {
          toast.error('The selected selling tier is not available for this product.');
          return;
        }

        const usableBaseStock = getProductUsableBaseStock(batches, product.id);
        const reservedBaseStock = getReservedBaseQuantityForProduct(cart, product.id);
        if (reservedBaseStock + tier.multiplier > usableBaseStock) {
          toast.error(`Insufficient stock for one ${tier.label}. ${product.name} has ${usableBaseStock} usable base units available.`);
          return;
        }

        try {
          const incoming = buildTierCartItem({ product, tier, batches, tenantId: profile.tenantId, branchId: activeBranchId, commercialQuantity: 1 });
          setCart(current => mergeTierCartItem(current, incoming));
          toast.success(`${product.name} added as ${tier.label}`);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Unable to add this selling tier.');
        }
        return;
      }

      const multiplier = product.unitOfSell === 'pack' ? (product.unitsPerPack || 1) :
                        product.unitOfSell === 'strip' ? (product.unitsPerStrip || 1) : 1;
      const productBatches = batches
        .filter(b => b.productId === product.id && b.quantity >= multiplier && b.batch_status === 'active')
        .filter(b => isInventoryBatchUnexpired(b.expiryDate))
        .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
      if (productBatches.length === 0) {
        toast.error('No active/unexpired stock available for this product');
        return;
      }
      const bestBatch = productBatches[0];
      const existingItem = cart.find(i => !i.tierCode && i.productId === product.id && i.batchNumber === bestBatch.batchNumber);
      if (existingItem) {
        updateQuantity(product.id, getCartLineIdentity(existingItem), 1);
      } else {
        const unitPrice = bestBatch.sellingPrice * multiplier;
        setCart([{
          productId: product.id,
          productName: product.name,
          genericName: product.genericName,
          batchNumber: bestBatch.batchNumber,
          expiryDate: bestBatch.expiryDate,
          quantity: 1,
          unitPrice,
          costPrice: bestBatch.purchasePrice * multiplier,
          subtotal: unitPrice,
          isService: false
        }, ...cart]);
      }
      toast.success(`${item.name} added to cart`);
    } else {
      const service = item as BillableService;
      const existingItem = cart.find(i => i.productId === service.id && i.isService);
      if (existingItem) {
        setCart(cart.map(i => i.productId === service.id && i.isService
          ? { ...i, quantity: i.quantity + 1, subtotal: (i.quantity + 1) * i.unitPrice }
          : i
        ));
      } else {
        setCart([...cart, {
          productId: service.id,
          productName: service.name,
          batchNumber: 'N/A',
          expiryDate: 'N/A',
          quantity: 1,
          unitPrice: service.defaultFee,
          costPrice: 0,
          subtotal: service.defaultFee,
          isService: true
        }]);
      }
      toast.success(`${item.name} added to cart`);
    }
  };

  const changeBatch = (productId: string, oldBatchNumber: string, newBatchNumber: string) => {
    const newBatch = batches.find(b => b.productId === productId && b.batchNumber === newBatchNumber);
    if (!newBatch) return;

    const product = products.find(p => p.id === productId);
    const multiplier = product?.unitOfSell === 'pack' ? (product.unitsPerPack || 1) : 
                      product?.unitOfSell === 'strip' ? (product.unitsPerStrip || 1) : 1;

    setCart(cart.map(item => {
      if (item.productId === productId && item.batchNumber === oldBatchNumber) {
        if (item.quantity * multiplier > newBatch.quantity) {
          toast.error(`Insufficient stock in batch ${newBatchNumber}`);
          return item;
        }
        const unitPrice = newBatch.sellingPrice * multiplier;
        return {
          ...item,
          batchNumber: newBatch.batchNumber,
          expiryDate: newBatch.expiryDate,
          unitPrice: unitPrice,
          costPrice: newBatch.purchasePrice * multiplier,
          subtotal: item.quantity * unitPrice
        };
      }
      return item;
    }));
  };

  const updateQuantity = (productId: string, lineIdentity: string, delta: number) => {
    const currentCartItem = cart.find(item => getCartLineIdentity(item) === lineIdentity);
    if (!currentCartItem) return;

    if (currentCartItem.tierCode) {
      const product = products.find(p => p.id === productId);
      if (!product) return;
      const currentQuantity = Number(currentCartItem.commercialQuantity ?? currentCartItem.quantity ?? 0);
      const newQuantity = Math.max(0, currentQuantity + delta);
      try {
        setCart(current => replaceTierCartQuantity({ cart: current, targetIdentity: lineIdentity, product, batches, commercialQuantity: newQuantity }));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Unable to change tier quantity.');
      }
      return;
    }

    const batchNumber = currentCartItem.batchNumber;
    const product = products.find(p => p.id === productId);
    const multiplier = product?.unitOfSell === 'pack' ? (product.unitsPerPack || 1) :
                      product?.unitOfSell === 'strip' ? (product.unitsPerStrip || 1) : 1;

    if (currentCartItem.isService) {
      setCart(cart.map(item => {
        if (getCartLineIdentity(item) === lineIdentity) {
          const newQty = Math.max(0, item.quantity + delta);
          return { ...item, quantity: newQty, subtotal: newQty * item.unitPrice };
        }
        return item;
      }));
      return;
    }

    const newQty = Math.max(0, currentCartItem.quantity + delta);
    const currentBatch = batches.find(b => b.productId === productId && b.batchNumber === batchNumber);
    if (!currentBatch) return;
    const currentBatchMaxQty = Math.floor(currentBatch.quantity / multiplier);

    if (newQty <= currentBatchMaxQty) {
      setCart(cart.map(item => getCartLineIdentity(item) === lineIdentity
        ? { ...item, quantity: newQty, subtotal: newQty * item.unitPrice }
        : item
      ));
    } else {
      const currentBatchQtyToSet = currentBatchMaxQty;
      const balanceQty = newQty - currentBatchQtyToSet;
      const otherBatches = batches
        .filter(b => b.productId === productId && b.batchNumber !== batchNumber && b.quantity >= multiplier && b.batch_status === 'active')
        .filter(b => isInventoryBatchUnexpired(b.expiryDate))
        .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());

      if (otherBatches.length === 0) {
        toast.error(`Insufficient stock! Only ${currentBatchMaxQty} available in this batch.`);
        setCart(cart.map(item => getCartLineIdentity(item) === lineIdentity
          ? { ...item, quantity: currentBatchMaxQty, subtotal: currentBatchMaxQty * item.unitPrice }
          : item
        ));
        return;
      }

      let remainingBalance = balanceQty;
      const additionalCartItems: SaleItem[] = [];
      for (const batch of otherBatches) {
        if (remainingBalance <= 0) break;
        const maxAvail = Math.floor(batch.quantity / multiplier);
        if (maxAvail <= 0) continue;
        const qtyToTake = Math.min(remainingBalance, maxAvail);
        remainingBalance -= qtyToTake;
        const unitPrice = batch.sellingPrice * multiplier;
        additionalCartItems.push({
          productId,
          batchId: batch.id,
          name: currentCartItem.productName || currentCartItem.name || productId,
          productName: currentCartItem.productName,
          genericName: currentCartItem.genericName,
          batchNumber: batch.batchNumber,
          expiryDate: batch.expiryDate,
          quantity: qtyToTake,
          unitPrice,
          total: qtyToTake * unitPrice,
          costPrice: batch.purchasePrice * multiplier,
          subtotal: qtyToTake * unitPrice,
          isService: false
        });
      }
      if (remainingBalance > 0) toast.warning(`Insufficient total stock. Missing ${remainingBalance} commercial units.`);
      setCart(prevCart => {
        let nextCart = prevCart.map(item => getCartLineIdentity(item) === lineIdentity
          ? { ...item, quantity: currentBatchQtyToSet, subtotal: currentBatchQtyToSet * item.unitPrice }
          : item
        );
        for (const add of additionalCartItems) {
          const existingIdx = nextCart.findIndex(item => !item.tierCode && item.productId === productId && item.batchNumber === add.batchNumber);
          if (existingIdx != -1) {
            const existingItem = nextCart[existingIdx];
            const updatedQty = Math.min(existingItem.quantity + add.quantity, Math.floor((batches.find(b => b.productId === productId && b.batchNumber === add.batchNumber)?.quantity || 0) / multiplier));
            nextCart[existingIdx] = { ...existingItem, quantity: updatedQty, subtotal: updatedQty * existingItem.unitPrice };
          } else {
            nextCart = [add, ...nextCart];
          }
        }
        return nextCart;
      });
      toast.success('Quantity split across available batches');
    }
  };

  const updatePrice = (productId: string, lineIdentity: string, newPrice: number) => {
    const target = cart.find(item => getCartLineIdentity(item) === lineIdentity);
    if (!target) return;
    if (target.tierCode) {
      setCart(current => replaceTierCartPrice({ cart: current, targetIdentity: lineIdentity, actualUnitPrice: Math.max(0, newPrice) }));
      return;
    }
    setCart(cart.map(item => getCartLineIdentity(item) === lineIdentity
      ? { ...item, unitPrice: Math.max(0, newPrice), subtotal: item.quantity * Math.max(0, newPrice) }
      : item
    ));
  };

  const removeFromCart = (lineIdentity: string) => {
    setCart(cart.filter(item => getCartLineIdentity(item) !== lineIdentity));
  };

  const subtotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
  const discountAmount = Math.round(subtotal * (discountPercentage / 100));
  const totalAmount = subtotal - discountAmount;
  const isWelfareSplit = paymentMethod === 'staff_welfare' && totalAmount > welfareBalance;

  useEffect(() => {
    if (selectedInstitution) {
      setDiscountPercentage(selectedInstitution.discountRate || 0);
    } else if (selectedPatient) {
      setDiscountPercentage(selectedPatient.discountRate || 0);
    } else {
      setDiscountPercentage(0);
    }
  }, [selectedInstitution, selectedPatient]);

  const handleCheckout = async () => {
    if (!canProcessSales) {
      toast.error('Your account can view Sales / POS but is not authorised to process sales.');
      return;
    }

    if (cart.length === 0) {
      toast.error('Cart is empty');
      return;
    }

    if (systemSettings?.features?.multiTierSellingEnabled === true && cart.some(item => !item.isService && item.tierCode)) {
      toast.error('Multi-tier basket selection is ready, but checkout is blocked until transactional tier-level FEFO integration is completed. No stock has been deducted.');
      return;
    }

    if (!activeBranchId) {
      toast.error('Select an active branch before processing a sale.');
      return;
    }

    // Check if any cart item's price is below cost price of that specific batch
    const belowCostItem = cart.find(item => !item.isService && item.unitPrice < item.costPrice);
    if (belowCostItem) {
      toast.error(`Checkout blocked: ${belowCostItem.productName} is priced at UGX ${(belowCostItem.unitPrice || 0).toLocaleString()}, which is below its batch cost price of UGX ${(belowCostItem.costPrice || 0).toLocaleString()}.`);
      return;
    }

    // Validation based on context
    if (context === 'telepharmacy' && !selectedPatient) {
      toast.error('Patient is mandatory for Telepharmacy');
      return;
    }
    if (context === 'institutional' && !selectedInstitution) {
      toast.error('Institution is mandatory for Institutional billing');
      return;
    }

    // POM/Controlled drug check
    const hasControlled = cart.some(item => {
      const product = products.find(p => p.id === item.productId);
      if (!product) return false;
      const category = String(product.prescriptionCategory || '').trim().toLowerCase();
      return category === 'controlled' || category === 'prescription only' || category === 'pom' || category === 'prescription-only'
    });

    if (hasControlled && !selectedPrescriber) {
      toast.error('Prescriber is mandatory for POM or Controlled Drugs');
      return;
    }

    setIsExceptionalConsumption(false);
    setExceptionalConsumptionReason('');
    setIsCheckoutOpen(true);
  };

  const completeSale = async (receiptWindow?: Window | null) => {
    if (!profile) {
      receiptWindow?.close();
      return;
    }

    if (!canProcessSales) {
      receiptWindow?.close();
      toast.error('Your account is not authorised to process sales.');
      return;
    }

    if (!editingSaleId && !activeBranchId) {
      receiptWindow?.close();
      toast.error('Select an active branch before processing a sale.');
      return;
    }

    // Check if any cart item's price is below cost price of that specific batch
    const belowCostItem = cart.find(item => !item.isService && item.unitPrice < item.costPrice);
    if (belowCostItem) {
      receiptWindow?.close();
      toast.error(`Checkout blocked: ${belowCostItem.productName} is priced at UGX ${(belowCostItem.unitPrice || 0).toLocaleString()}, which is below its batch cost price of UGX ${(belowCostItem.costPrice || 0).toLocaleString()}.`);
      return;
    }

    setIsProcessing(true);

    try {
      const branchCode = activeBranch?.branch_code || 'KLA';
      const generatedReceiptNumber = editingSaleId
        ? sales.find(s => s.id === editingSaleId)?.receiptNumber || `${branchCode}-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`
        : `${branchCode}-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
      if (!editingSaleId && !checkoutAttemptRef.current) {
        checkoutAttemptRef.current = { saleId: generateUUID(), receiptNumber: generatedReceiptNumber };
      }
      const receiptNumber = editingSaleId
        ? generatedReceiptNumber
        : checkoutAttemptRef.current!.receiptNumber;
      
      // Calculate VAT per item
      let totalVatAmount = 0;
      const itemsWithVat = cart.map(item => {
        const product = products.find(p => p.id === item.productId);
        let vatAmount = 0;
        let vatRate = 0;
        
        if (product && product.vatClassification === 'Standard Rated') {
          vatRate = product.vatPercentage || 18;
          const unitPrice = item.unitPrice;
          const basePrice = unitPrice / (1 + (vatRate / 100));
          vatAmount = Math.round((unitPrice - basePrice) * item.quantity);
        }
        
        totalVatAmount += vatAmount;
        return {
          ...item,
          vatAmount,
          vatRate
        };
      });

      const finalTotal = totalAmount;
      let finalReceiptId = editingSaleId;
      let completedSale: Sale | null = null;
      let stockPostedAtomically = false;

      if (editingSaleId) {
        const originalSale = sales.find(s => s.id === editingSaleId);
        if (!originalSale) throw new Error('The receipt being edited is no longer available. Reload the Receipt Ledger.');
        const editBranchId = originalSale.branchId || activeBranchId;
        if (!editBranchId) throw new Error('The receipt has no branch assignment and cannot be edited safely.');

        const saleUpdates = {
          subtotal,
          taxAmount: totalVatAmount,
          discountAmount,
          discountPercentage,
          total: finalTotal,
          totalAmount: finalTotal,
          paymentMethod,
          secondaryPaymentMethod: isWelfareSplit ? secondaryPaymentMethod : undefined,
          welfareAmount: paymentMethod === 'staff_welfare' ? (isWelfareSplit ? welfareBalance : totalAmount) : undefined,
          welfareBeneficiaryIsStaff: paymentMethod === 'staff_welfare' ? Boolean(selectedPatient?.isStaff) : undefined,
          welfarePostingStatus: paymentMethod === 'staff_welfare' ? 'pending' : 'not_applicable',
          secondaryAmount: isWelfareSplit ? (totalAmount - welfareBalance) : undefined,
          context,
          patientId: selectedPatient?.id || null,
          patientName: selectedPatient?.full_name || null,
          institutionId: selectedInstitution?.id || null,
          institutionName: selectedInstitution?.supplier_name || null,
          prescriberId: selectedPrescriber?.id || null,
          prescriberName: selectedPrescriber?.full_name || null,
          lastEditedAt: new Date().toISOString(),
          lastEditedBy: profile.uid,
          isExceptionalConsumption,
          exceptionalConsumptionReason: isExceptionalConsumption ? exceptionalConsumptionReason : null
        };

        await reviseSaleInventoryAtomically({
          tenantId: profile.tenantId,
          branchId: editBranchId,
          saleId: editingSaleId,
          originalSale,
          updatedItems: itemsWithVat,
          saleUpdates,
          products,
          actor: { uid: profile.uid, name: profile.full_name || 'Unknown', role: profile.role },
          reason: 'Manual Edit',
          actionType: 'EDIT',
          revisionId: generateUUID(),
          auditId: generateUUID()
        });

        const updatedSaleData: Sale = {
          ...originalSale,
          ...saleUpdates,
          items: itemsWithVat
        } as Sale;
        completedSale = updatedSaleData;
        stockPostedAtomically = true;
        try {
          await logSaleMovements(editingSaleId, originalSale, true, `sales_${editingSaleId}`, profile.uid);
          await logSaleMovements(editingSaleId, updatedSaleData, false, null, profile.uid);
        } catch (movementError) {
          console.warn('Receipt edit completed, but consumption analytics logging will need reconciliation:', movementError);
        }
      } else {
        const saleDocumentId = checkoutAttemptRef.current!.saleId;
        const saleData: Sale = {
          id: saleDocumentId,
          tenantId: profile.tenantId,
          branchId: activeBranchId!,
          cashierId: profile.uid,
          context,
          patientId: selectedPatient?.id,
          institutionId: selectedInstitution?.id,
          prescriberId: selectedPrescriber?.id,
          subtotal,
          tax: 0,
          taxAmount: totalVatAmount,
          discountAmount,
          discountPercentage,
          total: finalTotal,
          totalAmount: finalTotal,
          paymentMethod,
          secondaryPaymentMethod: isWelfareSplit ? secondaryPaymentMethod : undefined,
          welfareAmount: paymentMethod === 'staff_welfare' ? (isWelfareSplit ? welfareBalance : totalAmount) : undefined,
          welfareBeneficiaryIsStaff: paymentMethod === 'staff_welfare' ? Boolean(selectedPatient?.isStaff) : undefined,
          welfarePostingStatus: paymentMethod === 'staff_welfare' ? 'pending' : 'not_applicable',
          secondaryAmount: isWelfareSplit ? (totalAmount - welfareBalance) : undefined,
          sourceQuotationId: resumedQuotationId || undefined,
          quotationConversionStatus: resumedQuotationId ? 'pending' : 'not_applicable',
          timestamp: new Date().toISOString(),
          status: 'completed',
          receiptNumber,
          items: itemsWithVat,
          servedBy: profile?.uid,
          patientName: selectedPatient?.full_name,
          institutionName: selectedInstitution?.supplier_name,
          prescriberName: selectedPrescriber?.full_name,
          isExceptionalConsumption,
          exceptionalConsumptionReason: isExceptionalConsumption ? exceptionalConsumptionReason : null
        };

        const saleRef = doc(db, 'sales', saleDocumentId);
        const stockItems = cart.filter(item => !item.isService);
        const uniqueProductIds: string[] = Array.from(new Set<string>(stockItems.map(item => String(item.productId))));
        const productMap = new Map(uniqueProductIds.map(productId => {
          const product = products.find(p => p.id === productId);
          if (!product) throw new Error(`Product ${productId} is missing. Refresh the page and try again.`);
          return [productId, product] as const;
        }));
        const batchRefsByProduct = new Map<string, { ref: any; id: string }[]>();
        for (const productId of uniqueProductIds) {
          batchRefsByProduct.set(productId, await getBranchProductBatchRefs(profile.tenantId, activeBranchId!, productId));
        }

        let finalizedSaleItems = saleData.items;
        await firestoreService.runTransaction(async transaction => {
          const existingSale = await transaction.get(saleRef);
          if (existingSale.exists()) {
            finalizedSaleItems = ((existingSale.data() as Sale).items || saleData.items);
            return;
          }

          const productSnapshots = new Map<string, any>();
          const batchSnapshotsByProduct = new Map<string, Array<{ id: string; ref: any; data: any }>>();

          // Complete every read before the first write. All candidate batches are read so
          // a transaction retry can re-run FEFO against the latest quantities.
          for (const productId of uniqueProductIds) {
            const productRef = doc(db, 'products', productId);
            productSnapshots.set(productId, await transaction.get(productRef));
            const rows: Array<{ id: string; ref: any; data: any }> = [];
            for (const batchRef of batchRefsByProduct.get(productId) || []) {
              const snapshot = await transaction.get(batchRef.ref);
              if (snapshot.exists()) rows.push({ id: batchRef.id, ref: batchRef.ref, data: snapshot.data() });
            }
            batchSnapshotsByProduct.set(productId, rows);
          }

          const allocationsByProduct = new Map<string, Array<{ batchId: string; batchNumber: string; expiryDate?: string; baseQuantity: number; costPerBaseUnit: number }>>();
          const productDeductions = new Map<string, number>();

          for (const productId of uniqueProductIds) {
            const product = productMap.get(productId)!;
            const multiplier = getBaseUnitMultiplier(product);
            const requestedBaseUnits = stockItems
              .filter(item => item.productId === productId)
              .reduce((sum, item) => sum + Number(item.quantity || 0) * multiplier, 0);
            productDeductions.set(productId, requestedBaseUnits);

            const candidates = (batchSnapshotsByProduct.get(productId) || [])
              .filter(row => row.data.tenantId === profile.tenantId && row.data.branchId === activeBranchId)
              .filter(row => String(row.data.batch_status || '').toLowerCase() === 'active')
              .filter(row => isInventoryBatchUnexpired(row.data.expiryDate))
              .filter(row => Number(row.data.quantity || 0) > 0)
              .sort((a, b) => new Date(a.data.expiryDate || '9999-12-31').getTime() - new Date(b.data.expiryDate || '9999-12-31').getTime());

            let remaining = requestedBaseUnits;
            const allocations: Array<{ batchId: string; batchNumber: string; expiryDate?: string; baseQuantity: number; costPerBaseUnit: number }> = [];
            for (const candidate of candidates) {
              if (remaining <= 0) break;
              const available = Math.max(0, Number(candidate.data.quantity || 0));
              const take = Math.min(remaining, available);
              if (take <= 0) continue;
              allocations.push({
                batchId: candidate.id,
                batchNumber: String(candidate.data.batchNumber || 'UNSPECIFIED'),
                expiryDate: candidate.data.expiryDate,
                baseQuantity: take,
                costPerBaseUnit: Number(candidate.data.purchasePrice || 0)
              });
              remaining -= take;
            }

            if (remaining > 0) {
              throw new Error(`Insufficient unexpired FEFO stock for ${product.name}. Missing ${remaining} base units.`);
            }

            const actualCost = allocations.reduce((sum, allocation) => sum + allocation.baseQuantity * allocation.costPerBaseUnit, 0);
            const productGrossRevenue = stockItems.filter(item => item.productId === productId).reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
            const productNetRevenue = productGrossRevenue * (1 - (discountPercentage / 100));
            if (productNetRevenue + 0.0001 < actualCost) {
              throw new Error(`Checkout blocked after FEFO reallocation: ${product.name} would sell below the actual allocated batch cost. Minimum UGX ${Math.ceil(actualCost).toLocaleString()}, net line revenue UGX ${Math.floor(productNetRevenue).toLocaleString()}.`);
            }
            allocationsByProduct.set(productId, allocations);
          }

          // Apply FEFO batch deductions.
          for (const [productId, allocations] of allocationsByProduct) {
            const rows = batchSnapshotsByProduct.get(productId) || [];
            for (const allocation of allocations) {
              const row = rows.find(candidate => candidate.id === allocation.batchId);
              if (!row) throw new Error(`Allocated batch ${allocation.batchNumber} disappeared during checkout.`);
              const available = Number(row.data.quantity || 0);
              transaction.update(row.ref, { quantity: available - allocation.baseQuantity, updatedAt: serverTimestamp() });
            }
          }

          // Keep product aggregate stock synchronized with base-unit batch deductions.
          for (const [productId, deduction] of productDeductions) {
            const snapshot = productSnapshots.get(productId);
            const product = productMap.get(productId)!;
            if (!snapshot?.exists()) throw new Error(`Product ${product.name} no longer exists.`);
            if (snapshot.data().tenantId !== profile.tenantId) throw new Error(`Product tenant mismatch for ${product.name}.`);
            const currentStock = Number(snapshot.data().stock || 0);
            if (deduction > currentStock) {
              throw new Error(`Inventory aggregate mismatch for ${product.name}. Product stock has ${currentStock} base units but FEFO requires ${deduction}. Reconcile inventory before retrying.`);
            }
            transaction.update(doc(db, 'products', productId), { stock: currentStock - deduction, updatedAt: serverTimestamp() });
          }

          finalizedSaleItems = saleData.items.map(item => {
            if (item.isService) return item;
            const allocations = allocationsByProduct.get(item.productId) || [];
            return {
              ...item,
              batchId: allocations.length === 1 ? allocations[0].batchId : item.batchId,
              batchNumber: allocations.length === 1 ? allocations[0].batchNumber : (allocations.length > 1 ? 'FEFO-MULTI' : item.batchNumber),
              expiryDate: allocations.length === 1 ? allocations[0].expiryDate : (allocations.length > 1 ? 'Multiple' : item.expiryDate),
              batchAllocations: allocations
            };
          });

          const cleanSaleData = JSON.parse(JSON.stringify({ ...saleData, items: finalizedSaleItems }));
          transaction.set(saleRef, {
            ...cleanSaleData,
            inventoryPosted: true,
            inventoryPostedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        }, 'sales/product_batches/products');

        finalReceiptId = saleDocumentId;
        completedSale = { ...saleData, items: finalizedSaleItems };
        stockPostedAtomically = true;
        try {
          await logSaleMovements(saleDocumentId, completedSale, false, null, profile.uid, true);
        } catch (movementError) {
          // Core sale and stock are already atomic. Reporting aggregation can safely retry later.
          console.warn('Sale completed, but consumption analytics logging will need retry:', movementError);
        }
      }
      
      if (finalReceiptId) {
        try {
          await reconcilePosWelfarePosting({
            tenantId: profile.tenantId, saleId: finalReceiptId, actorId: profile.uid,
            actorName: profile.full_name || profile.displayName || 'POS Staff'
          });
        } catch (welfareError) {
          console.warn('Sale completed, but welfare finance posting remains pending:', welfareError);
          if (paymentMethod === 'staff_welfare') toast.warning('Sale completed. Staff welfare finance posting is pending automatic reconciliation.');
        }
      }

      // Update stock levels (FEFO confirmed)
      for (const item of stockPostedAtomically ? [] : cart) {
        if (!item.isService) {
          const batch = batches.find(b => b.productId === item.productId && b.batchNumber === item.batchNumber);
          const product = products.find(p => p.id === item.productId);
          const multiplier = product?.unitOfSell === 'pack' ? (product.unitsPerPack || 1) : 
                            product?.unitOfSell === 'strip' ? (product.unitsPerStrip || 1) : 1;

          if (batch) {
            await firestoreService.updateDocument('product_batches', batch.id, {
              quantity: batch.quantity - (item.quantity * multiplier)
            });
          }
          if (product) {
            await firestoreService.updateDocument('products', product.id, {
              stock: (product.stock || 0) - item.quantity
            });
          }
        }
      }

      if (resumedQuotationId && finalReceiptId) {
        try {
          await convertQuotationToSale({ tenantId: profile.tenantId, quotationId: resumedQuotationId, saleId: finalReceiptId, convertedValue: finalTotal });
        } catch (quotationError) {
          console.warn('Sale completed, but quotation conversion remains pending:', quotationError);
          toast.warning('Sale completed. The quotation link needs reconciliation, but no second sale was created.');
        }
        setResumedQuotationId(null);
      }

      if (completedSale) {
        const printOpened = printThermalReceipt(completedSale, {
          companyName: brandCompanyName,
          logoUrl: brandLogoUrl,
          address: activeBranch?.address,
          phone: activeBranch?.phone,
          ndaRegistration: brandNdaReg,
          footer: brandReceiptFooter
        }, profile.displayName || profile.full_name || 'Operator', false, receiptWindow);
        if (!printOpened) {
          toast.warning('Sale completed, but the receipt window was blocked. Reprint it from the Receipt Ledger.');
        }
      } else {
        receiptWindow?.close();
      }

      toast.success(`${editingSaleId ? 'Sale updated' : 'Sale completed'}! Receipt: ${receiptNumber}`);
      setCart([]);
      setDiscountPercentage(0);
      setSelectedPatient(null);
      setSelectedInstitution(null);
      setSelectedPrescriber(null);
      setContext('walk-in');
      setPaymentMethod('cash');
      setIsCheckoutOpen(false);
      setEditingSaleId(null);
      checkoutAttemptRef.current = null;
    } catch (error) {
      receiptWindow?.close();
      console.error(error);
      toast.error(`Failed to process sale: ${formatPosCheckoutError(error)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const updateLedgerItemQuantity = (productId: string, batchNumber: string | undefined, delta: number) => {
    setEditedItems(prev => prev.map(item => {
      const matchBatch = item.isService ? true : item.batchNumber === batchNumber;
      if (item.productId === productId && matchBatch) {
        const newQty = Math.max(1, item.quantity + delta);
        return {
          ...item,
          quantity: newQty,
          total: item.unitPrice * newQty,
          subtotal: item.unitPrice * newQty
        };
      }
      return item;
    }));
  };

  const updateLedgerItemPrice = (productId: string, batchNumber: string | undefined, newPrice: number) => {
    setEditedItems(prev => prev.map(item => {
      const matchBatch = item.isService ? true : item.batchNumber === batchNumber;
      if (item.productId === productId && matchBatch) {
        return {
          ...item,
          unitPrice: newPrice,
          total: newPrice * item.quantity,
          subtotal: newPrice * item.quantity
        };
      }
      return item;
    }));
  };

  const removeLedgerItem = (productId: string, batchNumber: string | undefined) => {
    setEditedItems(prev => prev.filter(item => {
      const matchBatch = item.isService ? true : item.batchNumber === batchNumber;
      return !(item.productId === productId && matchBatch);
    }));
  };

  const addProductToLedgerEdit = (product: Product) => {
    const existing = editedItems.find(item => item.productId === product.id);
    if (existing) {
      toast.info(`${product.name} is already in the receipt!`);
      return;
    }

    let batchNum = 'N/A';
    let expDate = 'N/A';
    let oldestBatch = null;
    
    const productBatches = batches.filter(b => b.productId === product.id && b.quantity > 0 && b.batch_status === 'active' && isInventoryBatchUnexpired(b.expiryDate));
    if (productBatches.length > 0) {
      oldestBatch = productBatches.sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())[0];
      batchNum = oldestBatch.batchNumber;
      expDate = oldestBatch.expiryDate;
    } else {
      toast.error(`No active batches with stock found for ${product.name}`);
      return;
    }

    const multiplier = product.unitOfSell === 'pack' ? (product.unitsPerPack || 1) : 
                      product.unitOfSell === 'strip' ? (product.unitsPerStrip || 1) : 1;
    const unitPrice = oldestBatch ? (oldestBatch.sellingPrice * multiplier) : (product.sellingPricePerUnit || 0);
    const costPrice = oldestBatch ? (oldestBatch.purchasePrice * multiplier) : (product.costPricePerPack || 0);

    const newItem: SaleItem = {
      productId: product.id,
      batchId: oldestBatch?.id || '',
      name: product.name,
      productName: product.name,
      quantity: 1,
      unitPrice: unitPrice,
      total: unitPrice,
      subtotal: unitPrice,
      costPrice: costPrice,
      isService: false,
      batchNumber: batchNum,
      expiryDate: expDate
    };

    setEditedItems(prev => [...prev, newItem]);
    setLedgerEditSearchTerm('');
    toast.success(`Added ${product.name} to the list`);
  };

  const saveLedgerReceiptChanges = async () => {
    if (!profile || !ledgerEditingSale) return;
    if (editedItems.length === 0) {
      toast.error('Receipt must have at least 1 item');
      return;
    }
    setIsSavingLedgerEdit(true);

    try {
      let totalVatAmount = 0;
      const updatedItemsWithSpecs = editedItems.map(item => {
        const product = products.find(p => p.id === item.productId);
        let vatAmount = 0;
        let vatRate = 0;
        
        if (product && product.vatClassification === 'Standard Rated') {
          vatRate = product.vatPercentage || 18;
          const unitPrice = item.unitPrice;
          const basePrice = unitPrice / (1 + (vatRate / 100));
          vatAmount = Math.round((unitPrice - basePrice) * item.quantity);
        }
        
        totalVatAmount += vatAmount;
        return {
          ...item,
          vatAmount,
          vatRate
        };
      });

      const newSubtotal = editedItems.reduce((acc, item) => acc + (item.unitPrice * item.quantity), 0);
      const newDiscountAmount = Math.round(newSubtotal * (editedDiscountPercentage / 100));
      const newTotalAmount = newSubtotal - newDiscountAmount;

      const editBranchId = ledgerEditingSale.branchId || activeBranchId;
      if (!editBranchId) throw new Error('This receipt has no branch assignment and cannot be edited safely.');

      await reviseSaleInventoryAtomically({
        tenantId: profile.tenantId,
        branchId: editBranchId,
        saleId: ledgerEditingSale.id,
        originalSale: ledgerEditingSale,
        updatedItems: updatedItemsWithSpecs,
        saleUpdates: {
          subtotal: newSubtotal,
          taxAmount: totalVatAmount,
          discountAmount: newDiscountAmount,
          discountPercentage: editedDiscountPercentage,
          total: newTotalAmount,
          totalAmount: newTotalAmount,
          paymentMethod: editedPaymentMethod,
          context: editedContext,
          patientId: editedPatientId || null,
          patientName: editedPatientName || null,
          lastEditedAt: new Date().toISOString(),
          lastEditedBy: profile.uid
        },
        products,
        actor: { uid: profile.uid, name: profile.full_name || 'Unknown', role: profile.role },
        reason: 'Ledger Direct Edit',
        actionType: 'EDIT_IN_LEDGER',
        revisionId: generateUUID(),
        auditId: generateUUID()
      });

      toast.success(`Receipt #${ledgerEditingSale.receiptNumber} successfully updated within Ledger!`);
      setLedgerEditingSale(null);
    } catch (error) {
      console.error('Error saving ledger edit:', error);
      toast.error('Failed to update receipt');
    } finally {
      setIsSavingLedgerEdit(false);
    }
  };

  const loadSaleIntoPOS = (sale: Sale) => {
    // Fill POS Cart
    setCart(sale.items.map(item => ({ ...item })));
    setEditingSaleId(sale.id);
    setDiscountPercentage(sale.discountPercentage || 0);
    setContext(sale.context || 'walk-in');
    setPaymentMethod(sale.paymentMethod || 'cash');
    if (sale.secondaryPaymentMethod) {
      setSecondaryPaymentMethod(sale.secondaryPaymentMethod);
    }
    
    // Select patient
    if (sale.patientId) {
      const patient = clients.find(c => c.id === sale.patientId);
      if (patient) setSelectedPatient(patient);
    } else {
      setSelectedPatient(null);
    }

    // Select institution
    if (sale.institutionId) {
      const inst = institutions.find(i => i.id === sale.institutionId);
      if (inst) setSelectedInstitution(inst);
    } else {
      setSelectedInstitution(null);
    }

    // Select prescriber
    if (sale.prescriberId) {
      const presc = prescribers.find(p => p.id === sale.prescriberId);
      if (presc) setSelectedPrescriber(presc);
    } else {
      setSelectedPrescriber(null);
    }

    setView('pos');
    toast.success(`Loaded Receipt #${sale.receiptNumber} into POS for editing!`);
  };

  return (
    <div className="h-auto min-h-screen lg:h-[calc(100vh-7rem)] flex flex-col gap-4 overflow-visible lg:overflow-hidden pb-12 lg:pb-0">
      {/* Persistent Header */}
      <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider">Branch</span>
            <span className="font-medium text-zinc-900">{profile?.branch || 'Main Branch'}</span>
          </div>
          <div className="h-8 w-px bg-zinc-200" />
          <div className="flex flex-col">
            <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider">Date</span>
            <span className="font-medium text-zinc-900">{format(new Date(), 'PPP')}</span>
          </div>
        </div>

        <div className="flex bg-zinc-100 p-1 rounded-xl border border-zinc-200">
          <button
            onClick={() => setView('pos')}
            disabled={!canProcessSales}
            title={!canProcessSales ? 'This account has view-only Sales / POS access' : undefined}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              view === 'pos' 
                ? "bg-white text-zinc-900 shadow-sm border border-zinc-200" 
                : "text-zinc-500 hover:text-zinc-700",
              !canProcessSales && "cursor-not-allowed opacity-50"
            )}
          >
            <ShoppingCart className="w-4 h-4" />
            POS
          </button>
          <button
            onClick={() => setView('ledger')}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              view === 'ledger' 
                ? "bg-white text-zinc-900 shadow-sm border border-zinc-200" 
                : "text-zinc-500 hover:text-zinc-700"
            )}
          >
            <Receipt className="w-4 h-4" />
            Receipt Ledger
          </button>
          <button
            onClick={() => setView('quotations')}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              view === 'quotations' 
                ? "bg-white text-zinc-900 shadow-sm border border-zinc-200" 
                : "text-zinc-500 hover:text-zinc-700"
            )}
          >
            <FileText className="w-4 h-4" />
            Quotations
          </button>
        </div>
      </div>

      {view === 'pos' && !canProcessSales && (
        <div className="flex-1 rounded-3xl border border-amber-200 bg-amber-50 p-8 flex items-center justify-center text-center">
          <div className="max-w-xl space-y-2">
            <h2 className="text-lg font-black text-amber-950">Sales processing is not enabled for this account</h2>
            <p className="text-sm text-amber-800">
              You can review receipts and quotations, but completing a sale requires Sales / POS operate access and an authorised POS role.
            </p>
            <button
              type="button"
              onClick={() => setView('ledger')}
              className="mt-3 rounded-xl bg-amber-900 px-5 py-3 text-xs font-black uppercase tracking-wider text-white"
            >
              Open Receipt Ledger
            </button>
          </div>
        </div>
      )}

      {view === 'pos' && canProcessSales && (
        <div className="flex-1 flex flex-col gap-6 overflow-visible lg:overflow-hidden animate-fade-in">
          {/* Top Bar: Context Selection & Receipt Ledger Toggle */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 w-full bg-zinc-50/50 p-4 rounded-3xl border border-zinc-200/60 shadow-sm">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-zinc-400 font-extrabold uppercase tracking-wider">Transaction Mode</span>
              <span className="text-xs font-semibold text-zinc-600">Select active billing and patient context</span>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 bg-white p-1 rounded-2xl border border-zinc-200 shadow-inner w-full md:w-auto overflow-x-auto">
              {[
                { id: 'walk-in', label: 'Walk-In', icon: User },
                { id: 'telepharmacy', label: 'Telepharmacy', icon: Video },
                { id: 'institutional', label: 'Institutional', icon: Building2 }
              ].map(ctx => (
                <button
                  key={ctx.id}
                  onClick={() => {
                    setContext(ctx.id as SaleContext);
                    toast.info(`Switched transaction context to ${ctx.label}`);
                  }}
                  type="button"
                  className={cn(
                    "flex-1 md:flex-none min-w-fit flex items-center justify-center gap-1.5 sm:gap-2.5 px-3 sm:px-6 py-3 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-wide sm:tracking-wider transition-all duration-200 outline-none select-none",
                    context === ctx.id 
                      ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/15 scale-[1.02]" 
                      : "text-zinc-700 bg-white hover:bg-zinc-100 hover:text-zinc-950"
                  )}
                >
                  <ctx.icon size={14} strokeWidth={3} />
                  <span>{ctx.label}</span>
                </button>
              ))}
            </div>

            <button
              onClick={() => setView('ledger')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 transition-all self-end sm:self-auto"
            >
              <History className="w-4 h-4" />
              <span>Receipt Ledger</span>
            </button>
          </div>

          {/* Interactive POS Grid */}
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-visible lg:overflow-hidden min-h-0">
            {/* Left Column: Massive Active Basket Area */}
            <div className="lg:col-span-8 flex flex-col bg-white rounded-3xl border border-zinc-200/80 shadow-xl shadow-zinc-100/30 overflow-visible lg:overflow-hidden min-h-0">
              {/* Basket Card Header */}
              <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/40">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600">
                    <ShoppingCart size={20} strokeWidth={2.5} />
                  </div>
                  <div>
                    <h2 className="text-lg font-extrabold text-zinc-900 leading-none">Active Basket</h2>
                    <span className="text-[9px] font-mono text-zinc-400 block mt-1">
                      Transaction ID: #POS-{format(new Date(), 'yyyy-MMdd')}-{editingSaleId ? editingSaleId.slice(0, 6).toUpperCase() : 'NEW'}
                    </span>
                    {editingSaleId && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                        <span className="text-[9px] font-black text-amber-600 uppercase tracking-wider bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                          EDITING RECEIPT #{sales.find(s => s.id === editingSaleId)?.receiptNumber}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="bg-emerald-100/70 border border-emerald-200 text-emerald-800 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider">
                    {cart.reduce((sum, item) => sum + item.quantity, 0)} ITEMS
                  </span>
                  <button 
                    onClick={() => {
                      if (cart.length > 0 || editingSaleId) {
                        setCart([]);
                        if (editingSaleId) {
                          setEditingSaleId(null);
                          setSelectedPatient(null);
                          setSelectedInstitution(null);
                          setSelectedPrescriber(null);
                          setDiscountPercentage(0);
                          setContext('walk-in');
                          toast.info("Receipt edit mode closed, basket reset.");
                        } else {
                          toast.info("Basket cleared");
                        }
                      }
                    }}
                    className="text-xs font-black text-rose-500 hover:text-rose-600 transition-colors"
                  >
                    {editingSaleId ? "Cancel Edit" : "Clear Basket"}
                  </button>
                </div>
              </div>

              {/* Basket Item Table Headers */}
              {cart.length > 0 && (
                <div className="px-6 py-2.5 border-b border-zinc-150/40 bg-zinc-50/20 grid grid-cols-12 gap-4 text-[9px] font-black uppercase tracking-widest text-zinc-400">
                  <div className="col-span-5">Item Details</div>
                  <div className="col-span-2 text-center">Unit Price</div>
                  <div className="col-span-2 text-center">Quantity</div>
                  <div className="col-span-2 text-right">Subtotal</div>
                  <div className="col-span-1"></div>
                </div>
              )}

              {/* Scrollable Basket Row Items */}
              <div className="flex-1 overflow-y-auto px-6 py-3 space-y-2 custom-scrollbar min-h-0">
                {cart.length > 0 ? (
                  <div className="space-y-1.5">
                    {cart.map((item, index) => {
                      const product = products.find(p => p.id === item.productId);
                      return (
                        <div 
                          key={`${getCartLineIdentity(item)}-${index}`}
                          className="grid grid-cols-12 gap-4 items-center py-2 px-3 hover:bg-zinc-50/40 rounded-xl border border-transparent hover:border-zinc-150/40 transition-all select-none group"
                        >
                          {/* Item Details */}
                          <div className="col-span-5 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-zinc-950 text-xs uppercase truncate leading-none">
                                {item.productName}
                              </span>
                              {item.isService && (
                                <span className="text-[7px] bg-blue-50 text-blue-600 border border-blue-150 px-1 rounded font-black uppercase">
                                  Service
                                </span>
                              )}
                              {item.tierCode && (
                                <span className="text-[7px] bg-emerald-50 text-emerald-700 border border-emerald-150 px-1 rounded font-black uppercase">
                                  {item.tierLabel || item.tierCode}
                                </span>
                              )}
                            </div>
                            <p className="text-[9px] text-zinc-400 line-clamp-1 mt-0.5 uppercase tracking-wide">
                              {item.isService ? 'Standard Service' : (item.genericName || product?.genericName || 'Unspecified formula')}
                            </p>
                            
                            {/* Batch semantics: tier lines stay commercial until transactional FEFO checkout. */}
                            {!item.isService && (
                              item.tierCode ? (
                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[8px] font-bold">
                                  <span className="text-emerald-700">{item.commercialQuantity || item.quantity} {item.tierLabel || item.tierCode}</span>
                                  <span className="text-zinc-300">•</span>
                                  <span className="text-zinc-500">{item.baseQuantity || 0} {product?.baseUnit || product?.unit || 'base units'}</span>
                                  <span className="text-zinc-300">•</span>
                                  <span className="text-amber-600">FEFO allocation will be finalised at checkout</span>
                                </div>
                              ) : (
                                <div className="mt-0.5 flex items-center gap-1 text-[8px] text-zinc-400 font-bold">
                                  <span>Batch:</span>
                                  <select
                                    className="p-0 bg-transparent border-none text-[8px] font-extrabold hover:text-emerald-600 focus:ring-0 cursor-pointer text-zinc-500 uppercase"
                                    value={item.batchNumber}
                                    onChange={(e) => changeBatch(item.productId, item.batchNumber, e.target.value)}
                                  >
                                    {batches
                                      .filter(b => b.productId === item.productId && b.quantity > 0 && b.batch_status === 'active' && isInventoryBatchUnexpired(b.expiryDate))
                                      .map(b => {
                                        const mult = product?.unitOfSell === 'pack' ? (product.unitsPerPack || 1) : product?.unitOfSell === 'strip' ? (product.unitsPerStrip || 1) : 1;
                                        const stockLeft = Math.floor(b.quantity / mult);
                                        return (
                                          <option key={b.batchNumber} value={b.batchNumber} className="text-zinc-800">
                                            {b.batchNumber} (EXP: {b.expiryDate}) • {stockLeft} LEFT
                                          </option>
                                        );
                                      })}
                                  </select>
                                </div>
                              )
                            )}
                          </div>

                          {/* Unit Price Input */}
                          <div className="col-span-2 text-center">
                            <span className="block text-[8px] font-extrabold text-zinc-400 uppercase leading-none mb-0.5">UGX</span>
                            <input 
                              type="number"
                              className="w-full text-center bg-transparent border-none p-0 text-xs font-black text-zinc-900 focus:ring-0 leading-none focus:outline-none"
                              value={item.unitPrice}
                              onChange={(e) => updatePrice(item.productId, getCartLineIdentity(item), parseInt(e.target.value) || 0)}
                              onBlur={(e) => {
                                const finalPrice = parseInt(e.target.value) || 0;
                                if (!item.isService && finalPrice < item.costPrice) {
                                  toast.error(`Selling price cannot be below batch cost price (UGX ${item.costPrice.toLocaleString()})`);
                                  updatePrice(item.productId, getCartLineIdentity(item), item.costPrice);
                                }
                              }}
                            />
                          </div>

                          {/* Quantity selector buttons */}
                          <div className="col-span-2 flex justify-center">
                            <div className="flex items-center gap-0.5 bg-zinc-50/80 p-0.5 rounded-lg border border-zinc-200/60 max-w-[85px] shadow-inner">
                              <button 
                                onClick={() => updateQuantity(item.productId, getCartLineIdentity(item), -1)}
                                className="p-1 hover:bg-white rounded transition-colors text-zinc-500 hover:text-zinc-900 active:scale-90"
                              >
                                <Minus size={10} strokeWidth={3} />
                              </button>
                              <input 
                                type="number"
                                className="w-8 text-center bg-transparent border-none p-0 text-xs font-black text-zinc-900 focus:ring-0 leading-none focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                value={item.quantity === 0 ? '' : item.quantity}
                                onChange={(e) => {
                                  const text = e.target.value;
                                  if (text === '') {
                                    updateQuantity(item.productId, getCartLineIdentity(item), -item.quantity);
                                  } else {
                                    const val = parseInt(text) || 0;
                                    const delta = val - item.quantity;
                                    updateQuantity(item.productId, getCartLineIdentity(item), delta);
                                  }
                                }}
                                onBlur={() => {
                                  if (item.quantity === 0) {
                                    updateQuantity(item.productId, getCartLineIdentity(item), 1);
                                  }
                                }}
                              />
                              <button 
                                onClick={() => updateQuantity(item.productId, getCartLineIdentity(item), 1)}
                                className="p-1 hover:bg-white rounded transition-colors text-zinc-500 hover:text-zinc-900 active:scale-90"
                              >
                                <Plus size={10} strokeWidth={3} />
                              </button>
                            </div>
                          </div>

                          {/* Subtotal Display */}
                          <div className="col-span-2 text-right">
                            <span className="block text-[8px] font-extrabold text-zinc-400 uppercase leading-none mb-0.5">UGX</span>
                            <span className="text-xs font-black text-zinc-900 leading-none">
                              {(item.subtotal || 0).toLocaleString()}
                            </span>
                          </div>

                          {/* Trash Delete Icon */}
                          <div className="col-span-1 text-center">
                            <button 
                              onClick={() => removeFromCart(getCartLineIdentity(item))}
                              className="p-1.5 text-zinc-300 hover:text-rose-500 rounded-lg hover:bg-rose-50 transition-all duration-150 inline-flex items-center justify-center opacity-40 group-hover:opacity-100"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-400 gap-4 py-20">
                    <div className="h-16 w-16 bg-zinc-50/50 border border-zinc-150/70 rounded-2xl flex items-center justify-center text-zinc-300 shadow-inner">
                      <ShoppingCart size={28} strokeWidth={1.5} />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-zinc-800">Your basket is currently empty</p>
                      <p className="text-[11px] text-zinc-500 max-w-xs mt-1">Search, preview and click items in the Available Items panel on the right to start a transaction context.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Price Totals & Discounter footer */}
              <div className="p-6 bg-zinc-50 border-t border-zinc-150/80 space-y-4 shadow-sm">
                <div className="flex flex-col md:flex-row gap-6 items-end justify-between">
                  {/* Applied Discount percentage cards */}
                  <div className="w-full md:flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <Percent size={14} className="text-zinc-400" />
                      <span className="text-[10px] font-black uppercase text-zinc-500 block tracking-widest">Apply Discount</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1 bg-white p-1 rounded-xl border border-zinc-200 w-fit shadow-sm">
                      {[0, 5, 10, 15, 20, 25].map(pct => (
                        <button
                          key={pct}
                          onClick={() => setDiscountPercentage(pct)}
                          className={cn(
                            "px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all duration-150",
                            discountPercentage === pct 
                              ? "bg-emerald-500 text-white shadow-md active:scale-95" 
                              : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
                          )}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Pricing grid summary */}
                  <div className="w-full md:w-72 space-y-1.5 bg-white p-4 rounded-2xl border border-zinc-200/80 shadow-md shadow-zinc-100/30">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500 font-bold uppercase tracking-wider">Subtotal</span>
                      <span className="font-extrabold text-zinc-900">UGX {(subtotal || 0).toLocaleString()}</span>
                    </div>

                    {systemSettings?.taxEngineEnabled && (
                      <div className="flex items-center justify-between text-[11px] text-zinc-400 italic font-semibold">
                        <span>VAT (18% Estimate)</span>
                        <span>UGX {cart.reduce((acc, item) => {
                          const product = products.find(p => p.id === item.productId);
                          if (product?.vatClassification === 'Standard Rated') {
                            const rate = product.vatPercentage || 18;
                            const base = item.unitPrice / (1 + (rate / 100));
                            return acc + Math.round((item.unitPrice - base) * item.quantity);
                          }
                          return acc;
                        }, 0).toLocaleString()}</span>
                      </div>
                    )}

                    {discountAmount > 0 && (
                      <div className="flex items-center justify-between text-xs font-bold text-emerald-600">
                        <span>Discount ({discountPercentage}%)</span>
                        <span>- UGX {(discountAmount || 0).toLocaleString()}</span>
                      </div>
                    )}

                    <div className="h-[1px] bg-zinc-150 my-11/12" />

                    <div className="flex items-end justify-between pt-1">
                      <div>
                        <span className="text-emerald-500 font-black text-2xl tracking-tighter block leading-none">UGX</span>
                        <span className="text-[10px] font-black uppercase text-zinc-400 block tracking-widest mt-1">Uganda Shillings</span>
                      </div>
                      <div className="text-right">
                        <span className="text-2xl font-black text-zinc-900 leading-none">
                          {(totalAmount || 0).toLocaleString()}
                        </span>
                        <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest block mt-0.5">Grand Total</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row justify-end gap-3 pt-2 border-t border-zinc-150/40 w-full">
                  <button 
                    type="button"
                    onClick={() => setShowQuotationModal(true)}
                    disabled={cart.length === 0 || cart.some(item => !item.isService && Boolean(item.tierCode))}
                    title={cart.some(item => !item.isService && Boolean(item.tierCode)) ? 'Multi-tier quotations will be enabled in the quotation integration phase.' : undefined}
                    className="w-full sm:w-auto px-6 py-4 bg-zinc-100 hover:bg-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400 text-zinc-700 rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <FileText size={16} strokeWidth={3} />
                    <span>Generate Quotation</span>
                  </button>
                  
                  <button 
                    onClick={handleCheckout}
                    disabled={cart.length === 0}
                    className="w-full sm:w-72 py-4 bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-300 text-white rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-lg hover:shadow-emerald-500/20 active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <Receipt size={16} strokeWidth={3} />
                    <span>Checkout Now (F12)</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Right Column: Demographics Cards & Suggestion-driven Product search sidebar */}
            <div className="lg:col-span-4 flex flex-col gap-6 overflow-hidden min-h-0">
              {/* Patient Details & Context Card */}
              <div className="bg-white p-5 rounded-3xl border border-zinc-200/90 shadow-lg shadow-zinc-100/10 space-y-4 relative">
                <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                  <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Patient Details</span>
                  <button 
                    onClick={() => setIsNewPatientModalOpen(true)}
                    className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 uppercase tracking-wider flex items-center gap-1 transition-colors"
                  >
                    <Plus size={12} strokeWidth={3} />
                    <span>New Patient</span>
                  </button>
                </div>

                {/* Patient Selector card with Custom suggestions list trigger */}
                <div className="relative">
                  {isPatientDropdownOpen ? (
                    <div className="space-y-2">
                      <div className="relative z-10 w-full">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={14} />
                        <input
                          type="text"
                          className="w-full pl-9 pr-8 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-emerald-500/20"
                          placeholder="Search patient name or phone..."
                          value={patientSearchTerm}
                          onChange={(e) => setPatientSearchTerm(e.target.value)}
                          autoFocus
                        />
                        <button 
                          onClick={() => {
                            setIsPatientDropdownOpen(false);
                            setPatientSearchTerm('');
                          }}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                        >
                          <X size={14} />
                        </button>
                      </div>

                      {/* Matching dropdown options list */}
                      <div className="absolute top-11 left-0 right-0 max-h-48 overflow-y-auto bg-white border border-zinc-200 rounded-xl shadow-xl z-20 p-1 divide-y divide-zinc-50 custom-scrollbar">
                        <button
                          onClick={() => {
                            setSelectedPatient(null);
                            setIsPatientDropdownOpen(false);
                            setPatientSearchTerm('');
                          }}
                          className="w-full text-left p-2 hover:bg-zinc-50 rounded-lg text-xs font-bold text-emerald-600 flex items-center justify-between"
                        >
                          <span>Anonymous Walk-In</span>
                          <span className="text-[9px] bg-zinc-50 border px-1.5 py-0.5 rounded text-zinc-400">Default</span>
                        </button>

                        {filteredPatients.map(c => (
                          <button
                            key={c.id}
                            onClick={() => {
                              setSelectedPatient(c as any);
                              setIsPatientDropdownOpen(false);
                              setPatientSearchTerm('');
                            }}
                            className="w-full text-left p-2 hover:bg-zinc-50 rounded-lg text-xs flex flex-col"
                          >
                            <span className="font-bold text-zinc-800">{c.full_name}</span>
                            <span className="text-[9px] text-zinc-400">{c.phone_number || 'No Phone'} {c.isStaff ? '• Employee' : ''}</span>
                          </button>
                        ))}
                        {filteredPatients.length === 0 && (
                          <p className="text-[10px] text-zinc-400 text-center py-3">No matching patients. Click "+ New Patient" to register</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div 
                      onClick={() => setIsPatientDropdownOpen(true)}
                      className="flex items-center justify-between p-3 bg-zinc-50 hover:bg-zinc-100/50 rounded-2xl border border-zinc-150/60 cursor-pointer transition-all hover:border-zinc-250 select-none group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 bg-emerald-100 text-emerald-700 rounded-xl flex items-center justify-center">
                          <User size={16} strokeWidth={2.5} />
                        </div>
                        <div>
                          <p className="text-xs font-extrabold text-zinc-900 group-hover:text-emerald-750 transition-colors">
                            {selectedPatient ? selectedPatient.full_name : 'Anonymous Walk-In'}
                          </p>
                          <p className="text-[10px] text-zinc-400 font-bold mt-0.5 uppercase tracking-wide">
                            {selectedPatient ? (selectedPatient.phone_number || 'Default profile') : 'Default session profile'}
                          </p>
                        </div>
                      </div>
                      <ChevronDown size={14} className="text-zinc-400" />
                    </div>
                  )}
                </div>

                {/* Optional parameters for Institutional mode (Patient, Institution, Prescriber) */}
                {context === 'institutional' && (
                  <div className="space-y-4 pt-3 border-t border-zinc-105/80 animate-fade-in divide-y divide-zinc-50">
                    {/* Institution Selector dropdown */}
                    <div className="space-y-1.5 pt-2">
                      <span className="text-[8px] font-black text-zinc-400 uppercase tracking-widest block">Institution Reference</span>
                      {isInstitutionDropdownOpen ? (
                        <div className="relative">
                          <div className="relative z-10 w-full">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={14} />
                            <input
                              type="text"
                              className="w-full pl-9 pr-8 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-blue-500/20"
                              placeholder="Search institution..."
                              value={institutionSearchTerm}
                              onChange={(e) => setInstitutionSearchTerm(e.target.value)}
                              autoFocus
                            />
                            <button 
                              onClick={() => {
                                setIsInstitutionDropdownOpen(false);
                                setInstitutionSearchTerm('');
                              }}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                            >
                              <X size={14} />
                            </button>
                          </div>
                          <div className="absolute top-10 left-0 right-0 max-h-40 overflow-y-auto bg-white border border-zinc-200 rounded-xl shadow-xl z-20 p-1 divide-y divide-zinc-50">
                            {filteredInstitutions.map(inst => (
                              <button
                                key={inst.id}
                                onClick={() => {
                                  setSelectedInstitution(inst);
                                  setIsInstitutionDropdownOpen(false);
                                  setInstitutionSearchTerm('');
                                }}
                                className="w-full text-left p-2 hover:bg-zinc-50 rounded-lg text-xs font-bold text-zinc-900"
                              >
                                {inst.supplier_name}
                              </button>
                            ))}
                            {filteredInstitutions.length === 0 && (
                              <p className="text-[9px] text-zinc-400 text-center py-2">No institutions registered</p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div 
                          onClick={() => setIsInstitutionDropdownOpen(true)}
                          className="flex items-center justify-between p-2.5 bg-blue-50/20 hover:bg-blue-50/50 rounded-xl border border-blue-100 hover:border-blue-200 cursor-pointer transition-all select-none"
                        >
                          <div className="flex items-center gap-2">
                            <Building2 size={14} className="text-blue-500" />
                            <span className="text-xs font-extrabold text-zinc-800">
                              {selectedInstitution ? selectedInstitution.supplier_name : 'Select Institution...'}
                            </span>
                          </div>
                          <ChevronDown size={12} className="text-blue-400" />
                        </div>
                      )}
                    </div>

                    {/* Prescriber Selector dropdown */}
                    <div className="space-y-1.5 pt-3">
                      <span className="text-[8px] font-black text-zinc-400 uppercase tracking-widest block">Medical Prescriber</span>
                      {isPrescriberDropdownOpen ? (
                        <div className="relative">
                          <div className="relative z-10 w-full font-sans">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={14} />
                            <input
                              type="text"
                              className="w-full pl-9 pr-8 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-purple-500/20"
                              placeholder="Search registered doctor..."
                              value={prescriberSearchTerm}
                              onChange={(e) => setPrescriberSearchTerm(e.target.value)}
                              autoFocus
                            />
                            <button 
                              onClick={() => {
                                setIsPrescriberDropdownOpen(false);
                                setPrescriberSearchTerm('');
                              }}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                            >
                              <X size={14} />
                            </button>
                          </div>
                          <div className="absolute top-10 left-0 right-0 max-h-40 overflow-y-auto bg-white border border-zinc-200 rounded-xl shadow-xl z-20 p-1 divide-y divide-zinc-50">
                            {filteredPrescribers.map(pr => (
                              <button
                                key={pr.id}
                                onClick={() => {
                                  setSelectedPrescriber(pr);
                                  setIsPrescriberDropdownOpen(false);
                                  setPrescriberSearchTerm('');
                                }}
                                className="w-full text-left p-2 hover:bg-zinc-50 rounded-lg text-xs"
                              >
                                <p className="font-bold text-zinc-900">{pr.full_name}</p>
                                <p className="text-[8px] text-zinc-400 uppercase">Council ID: {pr.medical_council_registration_number}</p>
                              </button>
                            ))}
                            {filteredPrescribers.length === 0 && (
                              <p className="text-[9px] text-zinc-400 text-center py-2">No prescribers registered</p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div 
                          onClick={() => setIsPrescriberDropdownOpen(true)}
                          className="flex items-center justify-between p-2.5 bg-purple-50/20 hover:bg-purple-50/50 rounded-xl border border-purple-100 hover:border-purple-200 cursor-pointer transition-all select-none"
                        >
                          <div className="flex items-center gap-2">
                            <Stethoscope size={14} className="text-purple-500" />
                            <span className="text-xs font-extrabold text-zinc-800">
                              {selectedPrescriber ? selectedPrescriber.full_name : 'Select Prescriber doctor...'}
                            </span>
                          </div>
                          <ChevronDown size={12} className="text-purple-400" />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Suggestions Finder, Catalog List sidebar */}
              <div className="flex-1 bg-white rounded-3xl border border-zinc-200/95 shadow-xl shadow-zinc-100/10 flex flex-col overflow-hidden">
                {/* Catalog type toggles */}
                <div className="p-4 bg-zinc-50/40 border-b border-zinc-150 flex flex-col gap-3">
                  <div className="flex items-center gap-1 bg-zinc-100 p-1 rounded-xl">
                    <button
                      onClick={() => setActiveTab('products')}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all duration-150",
                        activeTab === 'products' ? "bg-white text-zinc-900 shadow-sm font-black" : "text-zinc-500 hover:text-zinc-700"
                      )}
                    >
                      Products
                    </button>
                    <button
                      onClick={() => setActiveTab('services')}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all duration-150",
                        activeTab === 'services' ? "bg-white text-zinc-900 shadow-sm font-black" : "text-zinc-500 hover:text-zinc-700"
                      )}
                    >
                      Services
                    </button>
                  </div>

                  {/* Search box "Quick find product..." */}
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" size={16} strokeWidth={2.5} />
                      <input 
                        type="text"
                        placeholder="Quick find product..."
                        className="w-full pl-10 pr-4 py-3 bg-zinc-50 hover:bg-zinc-100/30 border border-zinc-250/20 focus:border-emerald-500/80 rounded-2xl focus:outline-none focus:ring-4 focus:ring-emerald-500/5 transition-all text-xs font-extrabold"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                    </div>
                    {activeTab === 'services' && (
                      <button 
                        onClick={() => {
                          setEditingService(null);
                          setIsServiceModalOpen(true);
                        }}
                        className="p-3 bg-emerald-500 text-white rounded-2xl hover:bg-emerald-600 transition-all shadow-lg active:scale-90 shadow-emerald-500/20 shrink-0"
                      >
                        <Plus size={18} strokeWidth={3} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Vertical Available Items with dynamic badges */}
                <div className="p-4 border-b border-zinc-100 bg-zinc-50/20">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Available Items</h3>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar min-h-[250px]">
                  {filteredItems.map(item => {
                    const isProduct = activeTab === 'products';
                    const product = isProduct ? item as Product : null;
                    const service = !isProduct ? item as BillableService : null;
                    const productBatches = isProduct ? batches.filter(b => b.productId === product?.id && b.quantity > 0 && b.batch_status === 'active' && isInventoryBatchUnexpired(b.expiryDate)) : [];
                    const totalBaseStock = isProduct && product ? getProductUsableBaseStock(batches, product.id) : 0;
                    const resolution = isProduct && product ? resolveSellingTiers(product, systemSettings) : null;
                    const isMultiTier = resolution?.mode === 'multi-tier';
                    const defaultTier = isMultiTier ? resolution.defaultTier : null;
                    const legacyMultiplier = product?.unitOfSell === 'pack' ? (product.unitsPerPack || 1) : product?.unitOfSell === 'strip' ? (product.unitsPerStrip || 1) : 1;
                    const displayMultiplier = defaultTier?.multiplier || legacyMultiplier;
                    const price = isProduct ? (defaultTier?.configuredPrice ?? productBatches[0]?.sellingPrice ?? product?.sellingPricePerUnit ?? 0) : (service?.defaultFee || 0);
                    const defaultHasStock = !isProduct || totalBaseStock >= Math.max(1, displayMultiplier);

                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (!isProduct) addToCart(item);
                          else if (defaultHasStock) addToCart(item, defaultTier?.code);
                        }}
                        onKeyDown={e => {
                          if ((e.key === 'Enter' || e.key === ' ') && (!isProduct || defaultHasStock)) addToCart(item, defaultTier?.code);
                        }}
                        className={cn(
                          "w-full flex items-center justify-between gap-3 p-3 rounded-2xl hover:bg-emerald-50/50 hover:border-emerald-100 border border-transparent group transition-all text-left duration-150 select-none cursor-pointer",
                          isProduct && !defaultHasStock && "opacity-40"
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={cn(
                            "h-10 w-10 rounded-xl flex items-center justify-center shrink-0 transition-all",
                            isProduct ? "bg-slate-100 text-slate-600 group-hover:bg-emerald-500 group-hover:text-white" : "bg-blue-150/40 text-blue-600 group-hover:bg-blue-500 group-hover:text-white"
                          )}>
                            {isProduct ? <Package size={16} strokeWidth={2.5} /> : <ShieldCheck size={16} strokeWidth={2.5} />}
                          </div>

                          <div className="min-w-0">
                            <p className="font-extrabold text-zinc-900 text-xs truncate uppercase tracking-tight group-hover:text-emerald-950 transition-colors">{item.name}</p>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {isProduct ? (
                                <>
                                  <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider block border", totalBaseStock > 50 ? "bg-emerald-50 text-emerald-600 border-emerald-100" : totalBaseStock > 0 ? "bg-amber-50 text-amber-600 border-amber-100" : "bg-rose-50 text-rose-600 border-rose-100")}>{totalBaseStock} {product?.baseUnit || product?.unit || 'base units'}</span>
                                  {isMultiTier && <span className="text-[8px] font-black uppercase text-emerald-700">Default: {defaultTier?.label}</span>}
                                </>
                              ) : (
                                <span className="bg-blue-50 text-blue-650 border border-blue-100 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider">Fee Service</span>
                              )}
                              <p className="text-[9px] text-zinc-400 truncate uppercase tracking-tight max-w-[120px]">{isProduct ? (product?.genericName || '') : 'Clinical'}</p>
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0 min-w-[118px]">
                          <p className="font-black text-zinc-850 text-xs tracking-tight leading-none">UGX {(price || 0).toLocaleString()}</p>
                          {isProduct && !defaultHasStock ? (
                            <span className="text-[9px] font-black text-rose-500 uppercase tracking-widest mt-1 block">OUT</span>
                          ) : (
                            <span className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mt-1 block">ADD {isMultiTier ? defaultTier?.label : ''} +</span>
                          )}
                          {isProduct && isMultiTier && resolution.tiers.length > 1 && (
                            <div className="mt-2 flex flex-wrap justify-end gap-1">
                              {resolution.tiers.filter(tier => tier.code !== defaultTier?.code).map(tier => {
                                const hasTierStock = totalBaseStock >= tier.multiplier;
                                return (
                                  <button
                                    type="button"
                                    key={tier.code}
                                    disabled={!hasTierStock}
                                    onClick={event => {
                                      event.stopPropagation();
                                      if (hasTierStock) addToCart(item, tier.code);
                                    }}
                                    className="px-2 py-1 rounded-lg border border-emerald-100 bg-white text-[8px] font-black uppercase text-emerald-700 disabled:opacity-30"
                                  >
                                    {tier.label} {Number(tier.configuredPrice || 0).toLocaleString()}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {filteredItems.length === 0 && (
                    <div className="p-12 text-center">
                      <p className="text-xs font-bold text-zinc-400">No catalogue item found matching "{searchTerm}"</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

      {/* Checkout Modal */}
      <AnimatePresence>
        {isCheckoutOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCheckoutOpen(false)}
              className="absolute inset-0 bg-zinc-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              role="dialog"
              aria-modal="true"
              aria-label="Complete transaction"
              className="relative w-full max-w-5xl bg-white rounded-2xl sm:rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col md:flex-row max-h-[calc(100dvh-1rem)] sm:max-h-[92vh]"
            >
              {/* Receipt Preview (Left) */}
              <div className="hidden md:block flex-1 bg-zinc-100 p-5 lg:p-8 overflow-y-auto custom-scrollbar border-r border-zinc-200">
                <div className="bg-white p-8 shadow-sm rounded-sm max-w-md mx-auto font-mono text-[10px] text-zinc-800">
                  <div className="text-center mb-6">
                    {brandLogoUrl && (
                      <div className="flex justify-center mb-3">
                        <img src={brandLogoUrl} alt="Logo" className="max-h-12 object-contain" referrerPolicy="no-referrer" />
                      </div>
                    )}
                    <h2 className="text-sm font-bold uppercase mb-1">{brandCompanyName}</h2>
                    <p>{activeBranch?.address || 'Kampala HQ, Plot 45 Kampala Rd'}</p>
                    <p>Tel: {activeBranch?.phone || '+256 700 000 000'}</p>
                    <p>NDA Reg: {brandNdaReg}</p>
                  </div>

                  <div className="border-t border-b border-dashed border-zinc-300 py-3 mb-4 space-y-1">
                    <div className="flex justify-between">
                      <span>Receipt #:</span>
                      <span className="font-bold">PREVIEW-001</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Date:</span>
                      <span>{format(new Date(), 'dd/MM/yyyy HH:mm')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Context:</span>
                      <span className="uppercase">{context}</span>
                    </div>
                    {selectedPatient && (
                      <div className="flex justify-between">
                        <span>Patient:</span>
                        <span>{selectedPatient.full_name}</span>
                      </div>
                    )}
                    {selectedInstitution && (
                      <div className="flex justify-between">
                        <span>Institution:</span>
                        <span>{selectedInstitution.supplier_name}</span>
                      </div>
                    )}
                  </div>

                  <table className="w-full mb-4">
                    <thead>
                      <tr className="border-b border-zinc-200 text-left">
                        <th className="pb-2">Item</th>
                        <th className="pb-2 text-right">Qty</th>
                        <th className="pb-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {cart.map((item, idx) => (
                        <tr key={idx}>
                          <td className="py-2">
                            <p className="font-bold">{item.productName}</p>
                            <p className="text-[8px] text-zinc-500">{item.batchNumber}</p>
                          </td>
                          <td className="py-2 text-right">{item.quantity}</td>
                          <td className="py-2 text-right">{(item.subtotal || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="border-t border-zinc-300 pt-3 space-y-1">
                    <div className="flex justify-between">
                      <span>Subtotal:</span>
                      <span>UGX {(subtotal || 0).toLocaleString()}</span>
                    </div>
                    {discountAmount > 0 && (
                      <div className="flex justify-between text-emerald-600">
                        <span>Discount ({discountPercentage}%):</span>
                        <span>- UGX {(discountAmount || 0).toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-black pt-2 border-t border-dashed border-zinc-200">
                      <span>TOTAL:</span>
                      <span>UGX {(totalAmount || 0).toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="text-center mt-8 pt-4 border-t border-dashed border-zinc-300">
                    <p className="font-bold mb-1">{brandReceiptFooter}</p>
                    <p>Served by: {profile?.displayName}</p>
                  </div>
                </div>
              </div>

              {/* Payment Selection (Right) */}
              <div className="w-full md:w-[25rem] p-4 sm:p-6 lg:p-8 flex flex-col gap-4 sm:gap-6 overflow-y-auto custom-scrollbar min-h-0">
                <div>
                  <h3 className="text-xl font-bold text-zinc-900 mb-2">Complete Transaction</h3>
                  <p className="text-sm text-zinc-500">Select payment method to finish.</p>
                </div>

                {/* Exceptional Consumption Toggle & Input */}
                <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-200/60 space-y-3">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isExceptionalConsumption}
                      onChange={(e) => {
                        setIsExceptionalConsumption(e.target.checked);
                        if (!e.target.checked) setExceptionalConsumptionReason('');
                      }}
                      className="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4 border-zinc-300"
                    />
                    <span className="text-xs font-bold text-zinc-700 uppercase tracking-wide">
                      Exceptional Bulk/Special Order
                    </span>
                  </label>
                  {isExceptionalConsumption && (
                    <div className="space-y-1">
                      <span className="text-[9px] font-black uppercase text-zinc-400 tracking-wider">
                        Reason for Exception
                      </span>
                      <select
                        value={exceptionalConsumptionReason}
                        onChange={(e) => setExceptionalConsumptionReason(e.target.value)}
                        required
                        className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs outline-none focus:ring-1 focus:ring-emerald-500"
                      >
                        <option value="">-- Select Reason --</option>
                        <option value="Institutional bulk order">Institutional bulk order</option>
                        <option value="Tender supply">Tender supply</option>
                        <option value="Emergency bulk issue">Emergency bulk issue</option>
                        <option value="Promotional campaign">Promotional campaign</option>
                        <option value="One-off special customer order">One-off special customer order</option>
                        <option value="Management-authorised abnormal issue">Management-authorised abnormal issue</option>
                      </select>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: 'cash', label: 'Cash', icon: Banknote },
                    { id: 'mtn_momo', label: 'MTN MoMo', icon: Smartphone },
                    { id: 'airtel_money', label: 'Airtel Money', icon: Smartphone },
                    { id: 'card', label: 'Card / POS', icon: CreditCard },
                    { id: 'insurance', label: 'Insurance', icon: ShieldCheck },
                    { id: 'institutional_credit', label: 'Inst. Credit', icon: Building2 },
                    { id: 'staff_welfare', label: 'Staff Welfare', icon: User, disabled: !isEmployee }
                  ].map(method => (
                    <button
                      key={method.id}
                      onClick={() => setPaymentMethod(method.id as PaymentMethodType)}
                      disabled={method.disabled}
                      className={cn(
                        "flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all text-center",
                        paymentMethod === method.id 
                          ? "border-emerald-500 bg-emerald-50 text-emerald-700 shadow-lg shadow-emerald-500/10" 
                          : "border-zinc-100 bg-white text-zinc-500 hover:border-zinc-200",
                        method.disabled && "opacity-30 cursor-not-allowed"
                      )}
                    >
                      <method.icon size={24} />
                      <span className="text-[10px] font-black uppercase leading-tight">{method.label}</span>
                      {method.id === 'staff_welfare' && isEmployee && (
                        <span className={cn(
                          "text-[8px] font-bold block",
                          totalAmount > welfareBalance ? "text-red-500" : "text-emerald-600"
                        )}>
                          Bal: {(welfareBalance || 0).toLocaleString()} {totalAmount > welfareBalance && ' (Insufficient)'}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {isWelfareSplit && (
                  <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100 space-y-3">
                    <p className="text-[10px] text-amber-700 font-bold uppercase flex items-center gap-2">
                      <Percent size={14} />
                      Split Payment Required
                    </p>
                    <p className="text-xs text-amber-600">
                      Welfare covers UGX {(welfareBalance || 0).toLocaleString()}. Remaining UGX {(totalAmount - welfareBalance || 0).toLocaleString()} will be collected via:
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {['cash', 'mtn_momo', 'airtel_money'].map(m => (
                        <button
                          key={m}
                          onClick={() => setSecondaryPaymentMethod(m as PaymentMethodType)}
                          className={cn(
                            "py-2 rounded-lg text-[10px] font-bold border transition-all",
                            secondaryPaymentMethod === m ? "bg-amber-500 border-amber-500 text-white" : "bg-white border-amber-200 text-amber-600"
                          )}
                        >
                          {m.replace('_', ' ').toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-auto space-y-3">
                  <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-zinc-500 font-bold uppercase">Amount Due</span>
                      <span className="text-lg font-black text-zinc-900">UGX {(totalAmount || 0).toLocaleString()}</span>
                    </div>
                    <p className="text-[10px] text-zinc-400 font-medium">Payment Method: <span className="text-zinc-900 font-bold uppercase">{paymentMethod.replace('_', ' ')}</span></p>
                  </div>

                  <div>
                    <button 
                      onClick={() => completeSale(openReceiptPrintWindow())}
                      disabled={isProcessing || !canProcessSales}
                      className="w-full py-4 bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-400 text-white rounded-2xl font-bold text-xs transition-all flex items-center justify-center gap-1.5"
                    >
                      {isProcessing ? (
                        <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <Printer size={16} />
                      )}
                      Complete & Print Thermal Receipt
                    </button>
                  </div>
                  <button 
                    onClick={() => setIsCheckoutOpen(false)}
                    className="w-full py-3 text-zinc-400 hover:text-zinc-600 text-sm font-bold transition-all"
                  >
                    Go Back & Edit
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
        </div>
      )}

      {view === 'ledger' && (
        <ReceiptLedger 

          sales={sales} 
          staff={staff}
          systemSettings={systemSettings}
          onVoid={async (saleId, reason) => {
            const sale = sales.find(s => s.id === saleId);
            if (!sale) return;
            
            try {
              if (!profile?.tenantId) throw new Error('A tenant profile is required to void this sale.');
              const voidBranchId = sale.branchId || activeBranchId;
              if (!voidBranchId) throw new Error('This receipt has no branch assignment and cannot be voided safely.');

              const changed = await voidSaleInventoryAtomically({
                tenantId: profile.tenantId,
                branchId: voidBranchId,
                sale,
                products,
                actor: {
                  uid: profile.uid || 'unknown',
                  name: profile.full_name || 'unknown',
                  role: profile.role
                },
                reason,
                auditId: generateUUID()
              });

              if (changed) {
                try {
                  await logSaleMovements(saleId, sale, true, `sales_${saleId}`, profile.uid || 'system');
                } catch (movementError) {
                  console.warn('Sale voided, but consumption analytics reversal needs reconciliation:', movementError);
                }
              }

              toast.success(changed ? 'Sale voided successfully' : 'Sale was already voided');
            } catch (error) {
              console.error('Error voiding sale:', error);
              toast.error('Failed to void sale');
            }
          }}
          onEdit={(sale) => {
            setLedgerEditingSale(sale);
            toast.info(`Editing Sale ${sale.receiptNumber} directly in Ledger`);
          }}
          onEditInPOS={loadSaleIntoPOS}
          onPrintA4={(receiptId) => {
            setSelectedA4ReceiptId(receiptId);
            setShowA4InvoiceModal(true);
          }}
        />
      )}

      {/* Service Modal */}
      <AnimatePresence>
        {isServiceModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsServiceModalOpen(false)}
              className="absolute inset-0 bg-zinc-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <h3 className="text-2xl font-bold text-zinc-900 mb-6">
                  {editingService ? 'Edit Service' : 'Create New Service'}
                </h3>
                
                <form onSubmit={async (e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                  const serviceData = {
                    name: formData.get('name') as string,
                    defaultFee: parseInt(formData.get('defaultFee') as string),
                    category: formData.get('category') as string,
                    description: formData.get('description') as string,
                    tenantId: profile?.tenantId || ''
                  };

                  try {
                    if (editingService) {
                      await firestoreService.updateDocument('billable_services', editingService.id, serviceData);
                      toast.success('Service updated');
                    } else {
                      await firestoreService.addDocument('billable_services', {
                        ...serviceData,
                        id: generateUUID(),
                        createdAt: new Date().toISOString()
                      });
                      toast.success('Service created');
                    }
                    setIsServiceModalOpen(false);
                  } catch (error) {
                    toast.error('Failed to save service');
                  }
                }} className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase mb-2 block">Service Name</label>
                    <input
                      name="name"
                      defaultValue={editingService?.name}
                      required
                      className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      placeholder="e.g., Consultation, Transport"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase mb-2 block">Billable Price (UGX)</label>
                    <input
                      name="defaultFee"
                      type="number"
                      defaultValue={editingService?.defaultFee}
                      required
                      className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase mb-2 block">Category</label>
                    <select
                      name="category"
                      defaultValue={editingService?.category || 'General'}
                      className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    >
                      <option value="General">General</option>
                      <option value="Consultation">Consultation</option>
                      <option value="Diagnostics">Diagnostics</option>
                      <option value="Logistics">Logistics</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase mb-2 block">Description</label>
                    <textarea
                      name="description"
                      defaultValue={editingService?.description}
                      className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 min-h-[80px]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4 mt-8">
                    <button
                      type="button"
                      onClick={() => setIsServiceModalOpen(false)}
                      className="py-4 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 rounded-2xl font-bold transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold shadow-lg shadow-emerald-600/20 transition-all"
                    >
                      Save Service
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Receipt Direct Modal */}
      <AnimatePresence>
        {ledgerEditingSale && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setLedgerEditingSale(null)}
              className="absolute inset-0 bg-zinc-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-5xl bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]"
            >
              {/* Modal Header */}
              <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50">
                <div className="flex flex-col">
                  <h3 className="text-xl font-extrabold text-zinc-900">Edit Receipt Details</h3>
                  <span className="text-xs font-mono text-zinc-400 mt-0.5">
                    Receipt Ref: #RE-{ledgerEditingSale.receiptNumber} ({format(new Date(ledgerEditingSale.timestamp), 'PPpp')})
                  </span>
                </div>
                <button 
                  onClick={() => setLedgerEditingSale(null)}
                  className="p-2 hover:bg-zinc-200 rounded-xl transition-colors text-zinc-500 hover:text-zinc-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Content - Two columns */}
              <div className="flex-1 overflow-y-auto p-6 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 custom-scrollbar">
                {/* Left Column: List of items + Add Item */}
                <div className="lg:col-span-7 space-y-6">
                  <div>
                    <h4 className="text-xs font-black uppercase text-zinc-400 tracking-wider mb-3">Items Sold in Receipt</h4>
                    
                    {editedItems.length > 0 ? (
                      <div className="space-y-3">
                        {editedItems.map((item, index) => {
                          return (
                            <div 
                              key={`${getCartLineIdentity(item)}-${index}`}
                              className="flex items-center justify-between p-4 bg-zinc-50/50 rounded-2xl border border-zinc-150/80 hover:border-zinc-200 transition-all gap-4"
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-zinc-900 truncate">{item.productName || item.name}</p>
                                <p className="text-[10px] text-zinc-400 mt-0.5">
                                  {item.isService ? 'Standard Service' : `Batch: ${item.batchNumber || 'N/A'}`}
                                </p>
                              </div>

                              {/* Unit Price input */}
                              <div className="w-24">
                                <label className="text-[8px] font-bold text-zinc-400 uppercase block mb-0.5">Unit Price</label>
                                <input 
                                  type="number"
                                  className="w-full px-2 py-1 text-xs border border-zinc-200 rounded-lg bg-white font-semibold text-zinc-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                  value={item.unitPrice}
                                  onChange={(e) => updateLedgerItemPrice(item.productId, item.batchNumber, parseInt(e.target.value) || 0)}
                                />
                              </div>

                              {/* Qty incrementer */}
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => updateLedgerItemQuantity(item.productId, item.batchNumber, -1)}
                                  className="p-1 hover:bg-zinc-200 rounded-lg text-zinc-500 active:scale-95 transition-all"
                                >
                                  <Minus size={12} strokeWidth={2.5} />
                                </button>
                                <input
                                  type="number"
                                  min="1"
                                  className="w-12 text-center bg-transparent border border-zinc-200 rounded px-1.5 py-0.5 text-xs font-black text-zinc-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  value={item.quantity}
                                  onChange={(e) => {
                                    const val = parseInt(e.target.value) || 1;
                                    const delta = val - item.quantity;
                                    updateLedgerItemQuantity(item.productId, item.batchNumber, delta);
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() => updateLedgerItemQuantity(item.productId, item.batchNumber, 1)}
                                  className="p-1 hover:bg-zinc-200 rounded-lg text-zinc-500 active:scale-95 transition-all"
                                >
                                  <Plus size={12} strokeWidth={2.5} />
                                </button>
                              </div>

                              {/* subtotal displaying */}
                              <div className="text-right min-w-[70px]">
                                <span className="text-[8px] block font-semibold text-zinc-400">SUBTOTAL</span>
                                <span className="text-xs font-black text-zinc-900">
                                  UGX {((item.unitPrice || 0) * (item.quantity || 0)).toLocaleString()}
                                </span>
                              </div>

                              {/* Remove item */}
                              <button
                                type="button"
                                onClick={() => removeLedgerItem(item.productId, item.batchNumber)}
                                className="p-1.5 text-zinc-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="py-12 border border-dashed border-zinc-200 rounded-2xl flex flex-col items-center justify-center text-zinc-400">
                        <Package size={24} />
                        <span className="text-xs font-semibold mt-2">No items inside receipt. Please add some below.</span>
                      </div>
                    )}
                  </div>

                  {/* Add New Item to Receipt Box */}
                  <div className="p-4 border border-zinc-150 rounded-2xl bg-zinc-50/20 relative">
                    <h4 className="text-xs font-bold text-zinc-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                      <Plus size={14} strokeWidth={2.5} className="text-emerald-500" />
                      <span>Add Item to Receipt</span>
                    </h4>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={14} />
                      <input 
                        type="text"
                        placeholder="Search product title/generic formulary to add..."
                        value={ledgerEditSearchTerm}
                        onChange={(e) => setLedgerEditSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-white border border-zinc-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500/20 focus:outline-none"
                      />
                      {ledgerEditSearchTerm && (
                        <div className="absolute top-11 left-0 right-0 max-h-48 overflow-y-auto bg-white border border-zinc-200 rounded-xl shadow-xl z-50 p-1 divide-y divide-zinc-50 custom-scrollbar">
                          {products
                            .filter(p => p.name.toLowerCase().includes(ledgerEditSearchTerm.toLowerCase()) || (p.genericName || '').toLowerCase().includes(ledgerEditSearchTerm.toLowerCase()))
                            .map(product => {
                              const productBatches = batches.filter(b => b.productId === product.id && b.quantity > 0);
                              const totalStock = productBatches.reduce((sum, b) => sum + b.quantity, 0);
                              return (
                                <button
                                  key={product.id}
                                  type="button"
                                  onClick={() => addProductToLedgerEdit(product)}
                                  className="w-full text-left p-2 hover:bg-zinc-50 rounded-lg text-xs flex justify-between items-center"
                                >
                                  <div>
                                    <span className="font-bold text-zinc-900 block">{product.name}</span>
                                    <span className="text-[10px] text-zinc-400 uppercase">{product.genericName || 'Unspecified'}</span>
                                  </div>
                                  <div className="text-right">
                                    <span className="text-[10px] font-bold text-emerald-600 block">UGX {(product.retailPrice || 0).toLocaleString()}</span>
                                    <span className="text-[9px] text-zinc-400">{totalStock} Units Avail.</span>
                                  </div>
                                </button>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Column: Transaction Configuration / Billing */}
                <div className="lg:col-span-5 space-y-6 lg:border-l lg:border-zinc-100 lg:pl-8">
                  {/* Client Context Details */}
                  <div className="grid grid-cols-1 gap-5">
                    {/* Patient search & Select */}
                    <div className="space-y-1.5 relative">
                      <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Customer / Patient</span>
                      <div className="flex items-center justify-between px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-bold text-zinc-800 shadow-sm">
                        <span>{editedPatientName || 'Anonymous Walk-In'}</span>
                        {editedPatientId && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditedPatientId(null);
                              setEditedPatientName(null);
                            }}
                            className="text-xs text-rose-500 hover:text-rose-600 font-bold"
                          >
                            Clear
                          </button>
                        )}
                      </div>

                      <div className="relative mt-1">
                        <input
                          type="text"
                          placeholder="Type customer name to change..."
                          value={patientSearchTerm}
                          onChange={(e) => setPatientSearchTerm(e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500/20"
                        />
                        {patientSearchTerm && (
                          <div className="absolute top-10 left-0 right-0 max-h-40 overflow-y-auto bg-white border border-zinc-200 rounded-xl shadow-xl z-50 p-1 divide-y divide-zinc-50 custom-scrollbar">
                            <button
                              type="button"
                              onClick={() => {
                                setEditedPatientId(null);
                                setEditedPatientName(null);
                                setPatientSearchTerm('');
                              }}
                              className="w-full text-left p-2 hover:bg-zinc-50 rounded-lg text-xs font-bold text-emerald-600 flex items-center justify-between"
                            >
                              <span>Anonymous Walk-In</span>
                              <span className="text-[9px] bg-zinc-50 border px-1.5 py-0.5 rounded text-zinc-400">Default</span>
                            </button>
                            {combinedPatients
                              .filter(p => (p.full_name || '').toLowerCase().includes(patientSearchTerm.toLowerCase()) || (p.phone_number || '').includes(patientSearchTerm))
                              .map(p => (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => {
                                    setEditedPatientId(p.id);
                                    setEditedPatientName(p.full_name);
                                    setPatientSearchTerm('');
                                  }}
                                  className="w-full text-left p-2 hover:bg-zinc-50 rounded-lg text-xs font-medium text-zinc-800 flex flex-col"
                                >
                                  <span className="font-bold">{p.full_name}</span>
                                  <span className="text-[10px] text-zinc-400">{p.phone_number}</span>
                                </button>
                              ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Sales context radio buttons */}
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Transaction Context</span>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { id: 'walk-in', label: 'Walk-In' },
                          { id: 'telepharmacy', label: 'Telepharmacy' },
                          { id: 'institutional', label: 'Institutional' }
                        ].map(ctx => (
                          <button
                            key={ctx.id}
                            type="button"
                            onClick={() => setEditedContext(ctx.id)}
                            className={cn(
                              "py-2 px-1.5 rounded-xl border text-center text-xs font-bold transition-all truncate",
                              editedContext === ctx.id
                                ? "bg-zinc-900 border-zinc-900 text-white shadow-md"
                                : "bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                            )}
                          >
                            {ctx.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Payment methods */}
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Payment Channel</span>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { id: 'cash', label: 'Cash Payment' },
                          { id: 'momo', label: 'Mobile Money' },
                          { id: 'card', label: 'Bank Card' },
                          { id: 'institutional_credit', label: 'Inst. Credit' }
                        ].map(pm => (
                          <button
                            key={pm.id}
                            type="button"
                            onClick={() => setEditedPaymentMethod(pm.id)}
                            className={cn(
                              "py-2.5 px-2 rounded-xl border text-center text-xs font-bold transition-all truncate",
                              editedPaymentMethod === pm.id
                                ? "bg-emerald-500 border-emerald-500 text-white shadow-md"
                                : "bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                            )}
                          >
                            {pm.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Discounter */}
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Apply Discount</span>
                      <div className="flex flex-wrap items-center gap-1 bg-zinc-50 p-1 rounded-xl border border-zinc-200 w-fit">
                        {[0, 5, 10, 15, 20, 25].map(pct => (
                          <button
                            key={pct}
                            type="button"
                            onClick={() => setEditedDiscountPercentage(pct)}
                            className={cn(
                              "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all duration-150",
                              editedDiscountPercentage === pct 
                                ? "bg-emerald-500 text-white shadow-md" 
                                : "text-zinc-500 hover:bg-white hover:text-zinc-900"
                            )}
                          >
                            {pct}%
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Summary Totals breakdown */}
                  <div className="p-5 bg-zinc-50 rounded-2xl border border-zinc-200/80 space-y-2">
                    <span className="text-[9px] font-black uppercase text-zinc-400 tracking-wider">Live Breakdown</span>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500">Subtotal</span>
                      <span className="font-extrabold text-zinc-900">
                        UGX {editedItems.reduce((acc, item) => acc + (item.unitPrice * item.quantity), 0).toLocaleString()}
                      </span>
                    </div>

                    {editedDiscountPercentage > 0 && (
                      <div className="flex justify-between text-xs text-emerald-600 font-extrabold">
                        <span>Discount ({editedDiscountPercentage}%)</span>
                        <span>
                          - UGX {Math.round(editedItems.reduce((acc, item) => acc + (item.unitPrice * item.quantity), 0) * (editedDiscountPercentage / 100)).toLocaleString()}
                        </span>
                      </div>
                    )}

                    <div className="h-px bg-zinc-200 my-2" />

                    <div className="flex justify-between items-end pt-2">
                      <span className="text-sm font-black text-zinc-900">GRAND TOTAL</span>
                      <div className="text-right">
                        <span className="text-xl font-black text-emerald-600">
                          UGX {(
                            editedItems.reduce((acc, item) => acc + (item.unitPrice * item.quantity), 0) -
                            Math.round(editedItems.reduce((acc, item) => acc + (item.unitPrice * item.quantity), 0) * (editedDiscountPercentage / 100))
                          ).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-6 bg-zinc-50 border-t border-zinc-150/60 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setLedgerEditingSale(null)}
                  className="px-6 py-3 bg-white hover:bg-zinc-100 border border-zinc-200 text-zinc-600 rounded-xl text-xs font-black uppercase tracking-wider transition-all"
                >
                  Discard Changes
                </button>
                <button
                  type="button"
                  disabled={isSavingLedgerEdit}
                  onClick={saveLedgerReceiptChanges}
                  className="px-8 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-300 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/10"
                >
                  {isSavingLedgerEdit ? (
                    <>
                      <div className="h-3 w-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Saving Receipt...</span>
                    </>
                  ) : (
                    <>
                      <Check size={14} strokeWidth={3} />
                      <span>Save Receipt Modifications</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {view === 'quotations' && (
        <QuotationsLog 
          activeBranchId={activeBranchId || 'main'}
          activeBranch={activeBranch}
          systemSettings={systemSettings}
          profile={profile}
          staff={staff}
          clients={clients}
          institutions={institutions}
          setCart={setCart}
          setContext={setContext}
          setSelectedPatient={setSelectedPatient}
          setSelectedInstitution={setSelectedInstitution}
          setDiscountPercentage={setDiscountPercentage}
          setView={setView}
          setResumedQuotationId={setResumedQuotationId}
        />
      )}

      {/* Quotation Preview modal overlay */}
      {showQuotationModal && (
        <QuotationPreview 
          isOpen={showQuotationModal}
          onClose={() => setShowQuotationModal(false)}
          tenantId={profile?.tenantId || 'demo'}
          branchId={activeBranchId || 'main'}
          activeBranch={activeBranch}
          systemSettings={systemSettings}
          profile={profile}
          selectedPatient={selectedPatient}
          selectedInstitution={selectedInstitution}
          cart={cart}
          subtotal={subtotal}
          taxTotal={cart.reduce((acc, item) => {
            const product = products.find(p => p.id === item.productId);
            if (product?.vatClassification === 'Standard Rated') {
              const rate = product.vatPercentage || 18;
              const base = item.unitPrice / (1 + (rate / 100));
              return acc + Math.round((item.unitPrice - base) * item.quantity);
            }
            return acc;
          }, 0)}
          grandTotal={totalAmount}
          onSuccess={() => {
            setCart([]);
            setSelectedPatient(null);
            setSelectedInstitution(null);
            setSelectedPrescriber(null);
            setContext('walk-in');
            setPaymentMethod('cash');
          }}
        />
      )}

      {/* A4 Tax Invoice modal overlay */}
      {showA4InvoiceModal && selectedA4ReceiptId && (
        <A4InvoiceTemplate 
          receiptId={selectedA4ReceiptId}
          isOpen={showA4InvoiceModal}
          onClose={() => {
            setShowA4InvoiceModal(false);
            setSelectedA4ReceiptId(null);
          }}
          activeBranch={activeBranch}
          systemSettings={systemSettings}
        />
      )}
    </div>
  );
};

interface ReceiptLedgerProps {
  sales: Sale[];
  staff: Staff[];
  onVoid: (saleId: string, reason: string) => Promise<void>;
  onEdit: (sale: Sale) => void;
  onEditInPOS?: (sale: Sale) => void;
  systemSettings: SystemSettings | null;
  onPrintA4: (receiptId: string) => void;
}

const ReceiptLedger = ({ sales, staff, onVoid, onEdit, onEditInPOS, systemSettings, onPrintA4 }: ReceiptLedgerProps) => {
  const { activeBranch } = useAuth();
  const brandCompanyName = activeBranch?.brandName || systemSettings?.branding?.companyName || 'PharmHelm Pharmacy';
  const brandLogoUrl = activeBranch?.brandLogoUrl || systemSettings?.branding?.logoUrl;
  const brandNdaReg = activeBranch?.brandNdaRegNumber || systemSettings?.branding?.ndaRegNumber || 'NDA/WHL/2026/0847';
  const brandReceiptFooter = activeBranch?.brandReceiptFooter || systemSettings?.branding?.receiptFooter || 'Thank you for your business!';

  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({ 
    start: new Date().toISOString().split('T')[0], 
    end: new Date().toISOString().split('T')[0] 
  });
  const [selectedStaff, setSelectedStaff] = useState<string>('all');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [isVoidModalOpen, setIsVoidModalOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [isReprintModalOpen, setIsReprintModalOpen] = useState(false);

  const filteredSales = sales.filter(sale => {
    const matchesSearch = sale.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (sale.receiptNumber || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStaff = selectedStaff === 'all' || sale.servedBy === selectedStaff;
    
    // Simple date filter
    const saleDate = new Date(sale.timestamp).toISOString().split('T')[0];
    const matchesStart = !dateRange.start || saleDate >= dateRange.start;
    const matchesEnd = !dateRange.end || saleDate <= dateRange.end;

    return matchesSearch && matchesStaff && matchesStart && matchesEnd;
  });

  return (
    <div className="flex-1 flex gap-6 overflow-hidden">
      {/* Sales List */}
      <div className="flex-1 bg-white rounded-2xl border border-zinc-200 shadow-sm flex flex-col overflow-hidden">
        <div className="p-4 border-b border-zinc-100 flex flex-wrap items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search by receipt ID or patient..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/5"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm"
            />
            <span className="text-zinc-400">to</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm"
            />
          </div>

          <select
            value={selectedStaff}
            onChange={(e) => setSelectedStaff(e.target.value)}
            className="px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm"
          >
            <option value="all">All Staff</option>
            {staff.map(s => (
              <option key={s.id} value={s.uid || s.id}>{s.displayName || s.full_name}</option>
            ))}
          </select>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-zinc-50 border-b border-zinc-200 z-10">
              <tr>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-zinc-400 tracking-wider">Receipt ID</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-zinc-400 tracking-wider">Date/Time</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-zinc-400 tracking-wider">Patient/Client</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-zinc-400 tracking-wider">Issued By</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-zinc-400 tracking-wider">Total</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-zinc-400 tracking-wider">Status</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-zinc-400 tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredSales.map((sale) => (
                <tr 
                  key={sale.id}
                  onClick={() => setSelectedSale(sale)}
                  className={cn(
                    "hover:bg-zinc-50 transition-colors cursor-pointer",
                    selectedSale?.id === sale.id && "bg-zinc-50"
                  )}
                >
                  <td className="px-6 py-4">
                    <span className="font-mono text-xs font-bold text-zinc-900">{sale.id.slice(0, 8).toUpperCase()}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-zinc-900">{format(new Date(sale.timestamp), 'MMM d, yyyy')}</span>
                      <span className="text-xs text-zinc-400">{format(new Date(sale.timestamp), 'HH:mm')}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center">
                        <User className="w-4 h-4 text-zinc-400" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-zinc-900">{sale.receiptNumber}</span>
                        <span className="text-xs text-zinc-400 uppercase tracking-tighter">{sale.context}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm font-medium text-zinc-700">
                      {staff.find(s => s.uid === sale.servedBy || s.id === sale.servedBy)?.displayName || 
                       staff.find(s => s.uid === sale.servedBy || s.id === sale.servedBy)?.full_name || 
                       sale.servedBy || 'System / Admin'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm font-bold text-zinc-900">UGX {sale.totalAmount.toLocaleString()}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-wider",
                      sale.status === 'active' ? "bg-emerald-100 text-emerald-700" : (sale.status === 'completed' ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")
                    )}>
                      {sale.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                      <button 
                        onClick={() => onEdit(sale)}
                        className="p-2 hover:bg-zinc-200 rounded-lg transition-colors text-zinc-600"
                        title="Edit Receipt Details Directly"
                      >
                        <History className="w-4 h-4" />
                      </button>
                      {onEditInPOS && (
                        <button 
                          onClick={() => onEditInPOS(sale)}
                          className="p-2 hover:bg-emerald-100 rounded-lg transition-colors text-emerald-600"
                          title="Edit Receipt in POS Active Basket"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      )}
                      {sale.status !== 'voided' && (
                        <button 
                          onClick={() => {
                            setSelectedSale(sale);
                            setIsVoidModalOpen(true);
                          }}
                          className="p-2 hover:bg-rose-100 rounded-lg transition-colors text-rose-600"
                          title="Void Sale"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                      {sale.status !== 'voided' && (
                        <button 
                          onClick={() => onPrintA4(sale.id)}
                          disabled={!sale.patientId && !sale.institutionId}
                          className={cn(
                            "p-2 rounded-lg transition-colors",
                            (sale.patientId || sale.institutionId)
                              ? "hover:bg-blue-100 text-blue-600 cursor-pointer"
                              : "text-zinc-300 opacity-50 cursor-not-allowed"
                          )}
                          title={
                            (sale.patientId || sale.institutionId)
                              ? "Print A4 Invoice"
                              : "A4 invoice requires a linked client or institution"
                          }
                        >
                          <FileText className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sale Details Panel */}
      <AnimatePresence>
        {selectedSale && (
          <motion.div
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            className="w-96 bg-white rounded-2xl border border-zinc-200 shadow-xl flex flex-col overflow-hidden"
          >
            <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50">
              <div className="flex flex-col">
                <h3 className="text-lg font-bold text-zinc-900">Sale Details</h3>
                <span className="text-xs font-mono text-zinc-400">ID: {selectedSale.id}</span>
              </div>
              <button 
                onClick={() => setSelectedSale(null)}
                className="p-2 hover:bg-zinc-200 rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-6 space-y-6">
              {/* Customer Info */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Customer Information</h4>
                <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full bg-white border border-zinc-200 flex items-center justify-center">
                      <User className="w-5 h-5 text-zinc-400" />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-bold text-zinc-900">{selectedSale.receiptNumber}</span>
                      <span className="text-xs text-zinc-500">{selectedSale.context.toUpperCase()}</span>
                      <span className="text-xs text-zinc-500 mt-1">
                        Issued by: <span className="font-semibold text-zinc-700">
                          {staff.find(s => s.uid === selectedSale.servedBy || s.id === selectedSale.servedBy)?.displayName || 
                           staff.find(s => s.uid === selectedSale.servedBy || s.id === selectedSale.servedBy)?.full_name || 
                           selectedSale.servedBy || 'System / Admin'}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Items */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Items Sold</h4>
                <div className="space-y-2">
                  {selectedSale.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-start p-3 bg-zinc-50 rounded-xl border border-zinc-100">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-zinc-900">{item.productName}</span>
                        <span className="text-xs text-zinc-400">{item.quantity} x UGX {item.unitPrice.toLocaleString()}</span>
                      </div>
                      <span className="text-sm font-bold text-zinc-900">UGX {item.subtotal.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="space-y-3 pt-4 border-t border-zinc-100">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Subtotal</span>
                  <span className="font-medium text-zinc-900">UGX {selectedSale.subtotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Discount</span>
                  <span className="font-medium text-rose-600">- UGX {selectedSale.discountAmount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center pt-2">
                  <span className="text-lg font-black text-zinc-900">TOTAL</span>
                  <span className="text-lg font-black text-zinc-900">UGX {selectedSale.totalAmount.toLocaleString()}</span>
                </div>
              </div>

              {/* Payment Info */}
              <div className="space-y-3 pt-4 border-t border-zinc-100">
                <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Payment Details</h4>
                <div className="flex items-center gap-2">
                  <div className="px-3 py-1 bg-zinc-100 rounded-lg text-xs font-bold text-zinc-600 uppercase">
                    {selectedSale.paymentMethod.replace('_', ' ')}
                  </div>
                  {selectedSale.secondaryPaymentMethod && (
                    <div className="px-3 py-1 bg-zinc-100 rounded-lg text-xs font-bold text-zinc-600 uppercase">
                      + {selectedSale.secondaryPaymentMethod.replace('_', ' ')}
                    </div>
                  )}
                </div>
              </div>

              {/* Void Info */}
              {selectedSale.status === 'voided' && (
                <div className="p-4 bg-rose-50 rounded-2xl border border-rose-100 space-y-2">
                  <div className="flex items-center gap-2 text-rose-700">
                    <Trash2 className="w-4 h-4" />
                    <span className="text-sm font-bold">Voided Transaction</span>
                  </div>
                  <p className="text-xs text-rose-600 italic">Reason: "{selectedSale.voidReason}"</p>
                  <div className="text-xs text-rose-700 font-medium">
                    Voided by: <span className="font-bold">
                      {staff.find(s => s.uid === selectedSale.voidedBy || s.id === selectedSale.voidedBy)?.displayName || 
                       staff.find(s => s.uid === selectedSale.voidedBy || s.id === selectedSale.voidedBy)?.full_name || 
                       selectedSale.voidedBy || 'System / Admin'}
                    </span>
                  </div>
                  <div className="text-[10px] text-rose-450 font-mono">
                    Voided on {format(new Date(selectedSale.voidedAt!), 'PPP p')}
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 bg-zinc-50 border-t border-zinc-100 space-y-2">
              {onEditInPOS && (
                <button 
                  onClick={() => {
                    onEditInPOS(selectedSale);
                    setSelectedSale(null);
                  }}
                  className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors shadow-lg shadow-emerald-500/10"
                >
                  <Edit2 className="w-4 h-4" />
                  Edit Receipt in POS Basket
                </button>
              )}
              <button 
                onClick={() => setIsReprintModalOpen(true)}
                className="w-full py-3 bg-zinc-900 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-zinc-800 transition-colors"
              >
                <Printer className="w-4 h-4" />
                Reprint Receipt
              </button>

              {selectedSale.status !== 'voided' && (
                <button 
                  onClick={() => {
                    onPrintA4(selectedSale.id);
                  }}
                  type="button"
                  className="w-full py-3 font-bold flex items-center justify-center gap-2 transition-all rounded-xl border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  title="Open the A4 invoice format"
                >
                  <FileText className="w-4 h-4" />
                  Print A4 Invoice
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Void Modal */}
      <AnimatePresence>
        {isVoidModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsVoidModalOpen(false)}
              className="absolute inset-0 bg-zinc-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <div className="w-16 h-16 bg-rose-100 rounded-2xl flex items-center justify-center mb-6">
                  <Trash2 className="w-8 h-8 text-rose-600" />
                </div>
                <h3 className="text-2xl font-bold text-zinc-900 mb-2">Void Transaction?</h3>
                <p className="text-zinc-500 mb-6">This will mark the sale as voided and return items to stock. This action is recorded in the audit log.</p>
                
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase mb-2 block">Reason for Voiding</label>
                    <textarea
                      value={voidReason}
                      onChange={(e) => setVoidReason(e.target.value)}
                      placeholder="e.g., Customer changed mind, incorrect item scanned..."
                      className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 min-h-[100px]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-8">
                  <button
                    onClick={() => setIsVoidModalOpen(false)}
                    className="py-4 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 rounded-2xl font-bold transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      if (!voidReason) {
                        toast.error('Please provide a reason');
                        return;
                      }
                      await onVoid(selectedSale!.id, voidReason);
                      setIsVoidModalOpen(false);
                      setVoidReason('');
                    }}
                    className="py-4 bg-rose-600 hover:bg-rose-700 text-white rounded-2xl font-bold shadow-lg shadow-rose-600/20 transition-all"
                  >
                    Confirm Void
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Reprint Receipt Modal */}
      <AnimatePresence>
        {isReprintModalOpen && selectedSale && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsReprintModalOpen(false)}
              className="absolute inset-0 bg-zinc-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden my-8"
            >
              <div className="p-6 bg-zinc-50 border-b border-zinc-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Printer className="w-5 h-5 text-zinc-600" />
                  <span className="font-bold text-zinc-900">Receipt Reprint</span>
                </div>
                <button
                  onClick={() => setIsReprintModalOpen(false)}
                  className="p-1.5 hover:bg-zinc-200 rounded-lg transition-colors text-zinc-400 hover:text-zinc-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Thermal Receipt Paper representation */}
              <div className="p-6 bg-zinc-100 flex justify-center max-h-[60vh] overflow-y-auto">
                <div className="bg-white p-6 shadow-md rounded border border-zinc-200 w-full max-w-xs font-mono text-[10px] text-zinc-800 leading-relaxed">
                  <div className="text-center mb-5 space-y-0.5">
                    {brandLogoUrl ? (
                      <div className="flex justify-center mb-2">
                        <img src={brandLogoUrl} alt="Logo" className="max-h-10 object-contain" referrerPolicy="no-referrer" />
                      </div>
                    ) : null}
                    <h2 className="text-xs font-bold uppercase tracking-tight">{brandCompanyName}</h2>
                    <p className="text-[8px] text-zinc-500">{activeBranch?.address || 'Plot 45 Kampala Road, Kampala HQ'}</p>
                    <p className="text-[8px] text-zinc-500">Tel: {activeBranch?.phone || '+256 700 000 000'}</p>
                    <p className="text-[8px] text-zinc-500">NDA Reg: {brandNdaReg}</p>
                  </div>

                  <div className="border-t border-b border-dashed border-zinc-300 py-2 mb-3 space-y-0.5 text-[8px]">
                    <div className="flex justify-between">
                      <span>Receipt #:</span>
                      <span className="font-bold">{selectedSale.receiptNumber || selectedSale.id.substring(0, 8).toUpperCase()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Date:</span>
                      <span>{format(new Date(selectedSale.timestamp), 'dd/MM/yyyy HH:mm')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Mode:</span>
                      <span className="uppercase font-semibold">{selectedSale.context}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Cashier:</span>
                      <span>{staff.find(s => s.uid === selectedSale.servedBy)?.displayName || staff.find(s => s.id === selectedSale.servedBy)?.displayName || selectedSale.servedBy || 'Operator'}</span>
                    </div>
                  </div>

                  <table className="w-full mb-3 text-[8px]">
                    <thead>
                      <tr className="border-b border-dashed border-zinc-300 text-left">
                        <th className="pb-1 font-bold">Item</th>
                        <th className="pb-1 text-right font-bold">Qty</th>
                        <th className="pb-1 text-right font-bold">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-dashed divide-zinc-100">
                      {selectedSale.items.map((item, idx) => (
                        <tr key={idx} className="py-1">
                          <td className="py-1 max-w-[120px] truncate">
                            <div className="font-semibold">{item.productName}</div>
                            <div className="text-[7px] text-zinc-500">@ {item.unitPrice.toLocaleString()}</div>
                          </td>
                          <td className="py-1 text-right">{item.quantity}</td>
                          <td className="py-1 text-right">{(item.subtotal || (item.quantity * item.unitPrice)).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="border-t border-dashed border-zinc-300 pt-2 space-y-0.5 text-[8px]">
                    <div className="flex justify-between">
                      <span>Subtotal:</span>
                      <span>UGX {(selectedSale.subtotal ?? selectedSale.total).toLocaleString()}</span>
                    </div>
                    {(selectedSale.discountAmount || 0) > 0 && (
                      <div className="flex justify-between"><span>Discount:</span><span>- UGX {(selectedSale.discountAmount || 0).toLocaleString()}</span></div>
                    )}
                    {(selectedSale.taxAmount || 0) > 0 && (
                      <div className="flex justify-between"><span>VAT:</span><span>UGX {(selectedSale.taxAmount || 0).toLocaleString()}</span></div>
                    )}
                    <div className="flex justify-between font-bold text-[10px] pt-1 border-t border-zinc-200">
                      <span>TOTAL:</span>
                      <span>UGX {selectedSale.total.toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="border-t border-dashed border-zinc-300 pt-2 mt-2 space-y-0.5 text-[8px]">
                    <div className="flex justify-between">
                      <span>Method:</span>
                      <span className="uppercase font-semibold">{selectedSale.paymentMethod.replace('_', ' ')}</span>
                    </div>
                    {selectedSale.cashReceived !== undefined && (
                      <>
                        <div className="flex justify-between">
                          <span>Amount Tendered:</span>
                          <span>UGX {(selectedSale.cashReceived || 0).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Change:</span>
                          <span>UGX {(selectedSale.changePrice || 0).toLocaleString()}</span>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="text-center mt-5 pt-3 border-t border-dashed border-zinc-200">
                    <p className="font-bold">*** DUPLICATE REPRINT ***</p>
                    <p className="text-[7px] text-zinc-500 mt-1">Thank you for your business!</p>
                    <p className="text-[6px] text-zinc-400">Powered by PharmHelm Cloud POS</p>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-zinc-50 border-t border-zinc-100 flex flex-col gap-2">
                <button
                  onClick={() => {
                    const cashier = staff.find(s => s.uid === selectedSale.servedBy)?.displayName || staff.find(s => s.id === selectedSale.servedBy)?.displayName || selectedSale.servedBy || 'Operator';
                    const opened = printThermalReceipt(selectedSale, {
                      companyName: brandCompanyName,
                      logoUrl: brandLogoUrl,
                      address: activeBranch?.address,
                      phone: activeBranch?.phone,
                      ndaRegistration: brandNdaReg,
                      footer: brandReceiptFooter
                    }, cashier, true);
                    if (opened) {
                      toast.success('Thermal receipt opened for printing.');
                      setIsReprintModalOpen(false);
                    } else {
                      toast.error('The print window was blocked. Allow pop-ups and try again.');
                    }
                  }}
                  className="w-full py-3 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors text-xs shadow-md"
                >
                  <Printer className="w-4 h-4" />
                  Print to Thermal Printer
                </button>
                <button
                  onClick={() => {
                    const textContent = `
=== ${brandCompanyName} ===
${activeBranch?.address || 'Plot 45 Kampala Road, Kampala HQ'}
NDA Reg: ${brandNdaReg}
---------------------------------
Receipt: ${selectedSale.receiptNumber || selectedSale.id.substring(0, 8).toUpperCase()}
Date: ${format(new Date(selectedSale.timestamp), 'dd/MM/yyyy HH:mm')}
Cashier: ${staff.find(s => s.uid === selectedSale.servedBy)?.displayName || staff.find(s => s.id === selectedSale.servedBy)?.displayName || selectedSale.servedBy || 'Operator'}
---------------------------------
${selectedSale.items.map(item => `${item.productName}\n  ${item.quantity} x UGX ${item.unitPrice.toLocaleString()} = UGX ${item.subtotal.toLocaleString()}`).join('\n')}
---------------------------------
TOTAL: UGX ${selectedSale.total.toLocaleString()}
Payment: ${selectedSale.paymentMethod.toUpperCase()}
*** DUPLICATE REPRINT ***
                    `.trim();
                    navigator.clipboard.writeText(textContent);
                    toast.success("Receipt copied to clipboard! (Ready to share on WhatsApp or SMS)");
                  }}
                  className="w-full py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors text-[10px]"
                >
                  Copy Plain Text for Sharing
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Sales;
