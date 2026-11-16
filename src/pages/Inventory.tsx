import React, { useState, useEffect, useRef } from 'react';
import { Plus, Search, Edit2, Trash2, Package, Activity, ClipboardList, BarChart3, Building2 } from 'lucide-react';
import { Product, ProductBatch, SystemSettings } from '../types';
import { firestoreService } from '../services/firestore';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';
import ProductModal from '../components/inventory/ProductModal';
import ProductStockcard from '../components/inventory/ProductStockcard';
import StockManagementTab from '../components/inventory/StockManagementTab';
import OperationalInventoryTab from '../components/inventory/OperationalInventoryTab';
import ReportHubTab from '../components/inventory/ReportHubTab';
import { useOperationalInventoryFeature } from '../hooks/useOperationalInventoryFeature';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type TabType = 'master' | 'stock' | 'operational' | 'reports';

const Inventory: React.FC = () => {
  const { profile, activeBranchId, activeBranch, hasPermission } = useAuth();
  const canOperateInventory = hasPermission('inventory', 'operate');
  const operationalInventoryEnabled = useOperationalInventoryFeature();
  const [activeTab, setActiveTab] = useState<TabType>('master');
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [pageSize, setPageSize] = useState(100);
  const [page, setPage] = useState(1);
  const registerRef = useRef<HTMLDivElement>(null);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [selectedProductForStockcard, setSelectedProductForStockcard] = useState<Product | null>(null);
  const [settings, setSettings] = useState<(SystemSettings & { id?: string }) | null>(null);
  const [branchBatches, setBranchBatches] = useState<ProductBatch[]>([]);

  useEffect(() => {
    if (profile?.tenantId) {
      const unsubscribeProducts = firestoreService.subscribeToCollection<Product>(
        'products',
        profile.tenantId,
        setProducts
      );

      // Subscribe to batches for active branch
      let unsubscribeBatches: () => void = () => {};
      if (activeBranchId) {
        unsubscribeBatches = firestoreService.subscribeToCollectionGroup<ProductBatch>(
          'product_batches',
          profile.tenantId,
          activeBranchId,
          setBranchBatches
        );
      }

      const unsubscribeSettings = firestoreService.subscribeToCollection<SystemSettings>(
        'system_settings',
        profile.tenantId,
        docs => setSettings(docs.find(setting => setting.id === profile.tenantId) || docs[0] || null)
      );

      return () => {
        unsubscribeProducts();
        unsubscribeBatches();
        unsubscribeSettings();
      };
    }
  }, [profile?.tenantId, activeBranchId]);

  useEffect(() => {
    if (!operationalInventoryEnabled && activeTab === 'operational') setActiveTab('master');
  }, [operationalInventoryEnabled, activeTab]);

  const search = searchTerm.trim().toLowerCase();
  const filteredProducts = products.filter(product => {
    const matchesSearch =
      product.name.toLowerCase().includes(search) ||
      product.productId?.toLowerCase().includes(search) ||
      product.sku?.toLowerCase().includes(search);
    
    const matchesCategory = selectedCategory === 'all' || product.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pageProducts = filteredProducts.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [page, currentPage]);

  const goToPage = (nextPage: number) => {
    setPage(nextPage);
    registerRef.current?.scrollIntoView({ block: 'start' });
  };

  const renderPagination = (position: 'top' | 'bottom') => (
    <nav aria-label={position === 'top' ? 'Product pages' : 'Product pages footer'} className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-zinc-200 p-3 sm:p-4",
        position === 'top' ? "border-b" : "border-t"
      )}>
      <p aria-live="polite" className="text-sm text-zinc-600">
        {pageStart + 1}–{pageStart + pageProducts.length} of {filteredProducts.length.toLocaleString()} products
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {position === 'top' && (
          <select
            aria-label="Products per page"
            className="min-h-11 rounded-xl border border-zinc-200 bg-white px-2 text-sm text-zinc-800"
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              goToPage(1);
            }}
          >
            <option value={100}>100 per page</option>
            <option value={150}>150 per page</option>
          </select>
        )}
        <button
          type="button"
          disabled={currentPage === 1}
          onClick={() => goToPage(currentPage - 1)}
          className="min-h-11 rounded-xl border border-zinc-200 bg-white px-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-40"
        >
          Previous
        </button>
        <span className="text-sm text-zinc-600">Page {currentPage} of {pageCount}</span>
        <button
          type="button"
          disabled={currentPage === pageCount}
          onClick={() => goToPage(currentPage + 1)}
          className="min-h-11 rounded-xl border border-zinc-200 bg-white px-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </nav>
  );

  const handleDeleteProduct = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this product? This will not delete its batches or history.')) {
      try {
        await firestoreService.deleteDocument('products', id);
        toast.success('Product deleted successfully');
      } catch (error) {
        toast.error('Failed to delete product');
      }
    }
  };

  return (
    <div className="min-w-0 max-w-7xl mx-auto space-y-5 sm:space-y-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-zinc-900 text-white rounded-2xl shadow-lg shadow-zinc-900/20">
              <Package size={24} />
            </div>
            <h1 className="text-2xl sm:text-4xl font-black text-zinc-900 uppercase tracking-tight">Inventory</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1 sm:ml-14">
            <p className="text-sm sm:text-base text-zinc-500 font-medium">Manage products, stock levels, and operational inventory.</p>
            {activeBranch && (
              <div className="flex min-w-0 items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                <Building2 size={12} className="shrink-0" aria-hidden="true" />
                <span className="text-[10px] font-black uppercase tracking-wider [overflow-wrap:anywhere]">Viewing: {activeBranch.name}</span>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Main Tabs */}
      <nav aria-label="Inventory sections" className="grid grid-cols-2 gap-1 rounded-2xl bg-zinc-100 p-1 sm:flex sm:w-fit sm:max-w-full sm:flex-wrap">
        <TabButton 
          active={activeTab === 'master'} 
          onClick={() => setActiveTab('master')} 
          label="Inventory Master" 
          icon={<Package size={16} />} 
        />
        {canOperateInventory && (
          <TabButton
            active={activeTab === 'stock'}
            onClick={() => setActiveTab('stock')}
            label="Stock Adjustments"
            icon={<Activity size={16} />}
          />
        )}
        {operationalInventoryEnabled && canOperateInventory && (
          <TabButton 
            active={activeTab === 'operational'} 
            onClick={() => setActiveTab('operational')} 
            label="Operational" 
            icon={<ClipboardList size={16} />} 
          />
        )}
        <TabButton 
          active={activeTab === 'reports'} 
          onClick={() => setActiveTab('reports')} 
          label="Report Hub" 
          icon={<BarChart3 size={16} />} 
        />
      </nav>

      {/* Tab Content */}
      <div className="min-h-[600px]">
        {activeTab === 'master' && (
          <div className="space-y-6">
            <div className="flex flex-col gap-2 sm:gap-3 md:flex-row">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={20} />
                <input 
                  type="text"
                  aria-label="Search products"
                  placeholder="Search by Name, ID, or SKU..."
                  className="w-full pl-12 pr-4 py-3 bg-white border border-zinc-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-zinc-900/5 transition-all text-sm font-medium"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div className="flex flex-wrap gap-2 sm:gap-3">
                <select
                  aria-label="Product category"
                  className="min-h-11 min-w-0 flex-1 px-3 py-2 sm:px-4 bg-white border border-zinc-200 rounded-2xl text-xs font-black uppercase tracking-widest outline-none focus:ring-4 focus:ring-zinc-900/5 transition-all"
                  value={selectedCategory}
                  onChange={(e) => {
                    setSelectedCategory(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">All Categories</option>
                  <option value="drug/medicine">Drugs</option>
                  <option value="cosmetic">Cosmetics</option>
                  <option value="consumable">Consumables</option>
                  <option value="device">Devices</option>
                  <option value="cosmetic therapeutics">Therapeutics</option>
                </select>
                {canOperateInventory && (
                  <button
                    onClick={() => {
                      setEditingProduct(null);
                      setIsProductModalOpen(true);
                    }}
                    className="min-h-11 px-3 py-2 sm:px-5 bg-zinc-900 text-white rounded-2xl font-black text-xs uppercase flex shrink-0 items-center gap-1.5 hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-900/20 active:scale-95"
                  >
                    <Plus size={18} />
                    Add Product
                  </button>
                )}
              </div>
            </div>

            <div ref={registerRef} className="min-w-0 scroll-mt-3 bg-white rounded-2xl sm:rounded-[32px] border border-zinc-200 shadow-sm overflow-hidden">
                {filteredProducts.length > 0 && renderPagination('top')}
                <table role="table" aria-label="Product register" className="block w-full min-w-0! border-collapse text-left xl:table xl:table-fixed">
                  <thead className="hidden xl:table-header-group">
                    <tr className="bg-zinc-50/50 border-b border-zinc-100">
                      <th className="w-[29%] px-3 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Product Info</th>
                      <th className="px-3 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Category</th>
                      <th className="px-3 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-center">Stock Level</th>
                      <th className="px-3 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Pricing</th>
                      <th className="px-3 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Tax</th>
                      <th className="w-32 px-3 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody role="rowgroup" className="block divide-y divide-zinc-200 xl:table-row-group">
                    {pageProducts.map((product) => {
                      const productStock = branchBatches
                        .filter(b => b.productId === product.id)
                        .reduce((acc, curr) => acc + (curr.quantity || 0), 0);
                      const enabledTierEntries = (['unit', 'strip', 'pack'] as const)
                        .filter(code => product.sellingTiers?.[code]?.enabled)
                        .map(code => ({ code, price: Number(product.sellingTiers?.[code]?.price || 0) }));
                      
                      return (
                        <tr
                          key={product.id}
                          role="row"
                          className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 p-3 [overflow-wrap:anywhere] sm:p-4 hover:bg-zinc-50/50 transition-colors cursor-pointer xl:table-row xl:p-0"
                          onClick={() => setSelectedProductForStockcard(product)}
                        >
                          <td role="cell" className="col-span-2 min-w-0 xl:px-3 xl:py-4">
                            <div className="flex flex-col">
                              <div className="flex flex-wrap items-center gap-x-2">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setSelectedProductForStockcard(product);
                                  }}
                                  aria-label={`View details for ${product.name}`}
                                  className="min-h-11 min-w-0 text-left font-bold text-zinc-900 [overflow-wrap:anywhere] hover:underline"
                                >
                                  {product.name}
                                </button>
                                <span className="px-1.5 py-0.5 bg-zinc-100 text-zinc-500 rounded text-[8px] font-black uppercase tracking-tighter border border-zinc-200">
                                  {enabledTierEntries.length > 0 ? 'Multi-tier' : product.unitOfSell}
                                </span>
                              </div>
                              <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-2 [overflow-wrap:anywhere]">
                                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">ID: {product.productId}</span>
                                <span className="text-zinc-300">•</span>
                                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">SKU: {product.sku}</span>
                              </div>
                            </div>
                          </td>
                          <td role="cell" className="min-w-0 self-center [overflow-wrap:anywhere] xl:px-3 xl:py-4">
                            <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded-md text-[10px] font-black uppercase tracking-widest">
                              {product.category}
                            </span>
                          </td>
                          <td role="cell" className="min-w-0 self-center xl:px-3 xl:py-4 xl:text-center">
                            <div className="flex flex-wrap items-baseline justify-end gap-x-1 xl:flex-col xl:items-center">
                              <span className="text-[10px] font-semibold text-zinc-600 xl:hidden">Stock</span>
                              <span className={cn(
                                "text-sm font-black",
                                productStock <= 10 ? "text-red-600" : "text-zinc-900"
                              )}>
                                {(productStock || 0).toLocaleString()}
                              </span>
                              <span className="text-[8px] font-black text-zinc-400 uppercase tracking-tighter">
                                {product.baseUnit || product.unit || 'base units'}
                              </span>
                            </div>
                          </td>
                          <td role="cell" className="min-w-0 xl:px-3 xl:py-4">
                          <div className="flex flex-col gap-0.5">
                            {enabledTierEntries.length > 0 ? enabledTierEntries.map(tier => (
                              <span key={tier.code} className="text-[10px] font-bold text-zinc-800 uppercase">{tier.code}: {tier.price.toLocaleString()} UGX</span>
                            )) : (
                              <span className="text-xs font-bold text-zinc-900">Sell: {(product.sellingPricePerUnit || 0).toLocaleString()} UGX</span>
                            )}
                            <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Cost: {(product.costPricePerPack || 0).toLocaleString()} /pack</span>
                          </div>
                        </td>
                        <td role="cell" className="min-w-0 text-right xl:px-3 xl:py-4 xl:text-left">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-black text-zinc-900 uppercase tracking-widest">{product.vatClassification}</span>
                            {product.vatClassification === 'Standard Rated' && (
                              <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{product.vatPercentage}% VAT</span>
                            )}
                          </div>
                        </td>
                        <td role="cell" className="col-span-2 xl:px-3 xl:py-4" onClick={(e) => e.stopPropagation()}>
                          {canOperateInventory && (
                            <div className="flex flex-wrap items-center justify-end gap-2">
                            <button
                              type="button"
                              aria-label={`Edit ${product.name}`}
                              title="Edit product"
                              onClick={() => {
                                setEditingProduct(product);
                                setIsProductModalOpen(true);
                              }}
                              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-100"
                            >
                              <Edit2 size={17} aria-hidden="true" />
                              <span className="xl:sr-only">Edit</span>
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete ${product.name}`}
                              title="Delete product"
                              onClick={() => handleDeleteProduct(product.id)}
                              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-2 text-sm font-semibold text-red-700 hover:bg-red-100"
                            >
                              <Trash2 size={17} aria-hidden="true" />
                              <span className="xl:sr-only">Delete</span>
                            </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                    })}
                    {filteredProducts.length === 0 && (
                      <tr role="row" className="block xl:table-row">
                        <td role="cell" colSpan={6} className="block px-6 py-12 text-center xl:table-cell">
                          <div className="flex flex-col items-center gap-3 text-zinc-400">
                            <Package size={48} strokeWidth={1} />
                            <p className="text-sm font-bold uppercase tracking-widest">No products found</p>
                            {canOperateInventory && (
                              <button
                                type="button"
                                onClick={() => setIsProductModalOpen(true)}
                                className="min-h-11 text-xs font-black text-zinc-900 underline underline-offset-4"
                              >
                                Add product
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {pageCount > 1 && renderPagination('bottom')}
            </div>
          </div>
        )}

        {canOperateInventory && activeTab === 'stock' && <StockManagementTab />}
        {operationalInventoryEnabled && canOperateInventory && activeTab === 'operational' && <OperationalInventoryTab />}
        {activeTab === 'reports' && <ReportHubTab />}
      </div>

      {/* Modals */}
      {canOperateInventory && isProductModalOpen && (
        <ProductModal 
          isOpen={isProductModalOpen} 
          onClose={() => {
            setIsProductModalOpen(false);
            setEditingProduct(null);
          }} 
          product={editingProduct}
          systemSettings={settings}
        />
      )}

      {selectedProductForStockcard && (
        <ProductStockcard 
          isOpen={!!selectedProductForStockcard}
          onClose={() => setSelectedProductForStockcard(null)}
          product={selectedProductForStockcard}
        />
      )}
    </div>
  );
};

const TabButton: React.FC<{ active: boolean; onClick: () => void; label: string; icon: React.ReactNode }> = ({ active, onClick, label, icon }) => (
  <button
    type="button"
    aria-pressed={active}
    onClick={onClick}
    className={cn(
      "flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-center text-xs font-bold transition-colors [&>svg]:shrink-0 sm:px-4",
      active 
        ? "bg-white text-zinc-900 shadow-sm" 
        : "text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50/50"
    )}
  >
    {icon}
    {label}
  </button>
);

export default Inventory;
