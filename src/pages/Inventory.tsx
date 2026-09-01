import React, { useState, useEffect } from 'react';
import { Plus, Search, Filter, MoreVertical, Edit2, Trash2, Package, X, TrendingUp, History, Activity, Settings, ClipboardList, ArrowLeftRight, BarChart3, Building2 } from 'lucide-react';
import { Product, ProductBatch, InventoryMovement } from '../types';
import { firestoreService } from '../services/firestore';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import ProductModal from '../components/inventory/ProductModal';
import ProductStockcard from '../components/inventory/ProductStockcard';
import StockManagementTab from '../components/inventory/StockManagementTab';
import OperationalInventoryTab from '../components/inventory/OperationalInventoryTab';
import ReportHubTab from '../components/inventory/ReportHubTab';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type TabType = 'master' | 'stock' | 'operational' | 'reports';

const Inventory: React.FC = () => {
  const { profile, activeBranchId, activeBranch } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('master');
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [selectedProductForStockcard, setSelectedProductForStockcard] = useState<Product | null>(null);
  const [showOperational, setShowOperational] = useState(false);
  const [settings, setSettings] = useState<any>(null);
  const [branchBatches, setBranchBatches] = useState<ProductBatch[]>([]);

  const userRoles = [profile?.role || 'staff', ...(profile?.secondaryRoles || [])];
  const isCEO = userRoles.some(r => ['CEO', 'CEO / MD', 'ceo', 'owner', 'admin'].includes(r));

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

      // Fetch settings or create default
      const fetchSettings = async () => {
        try {
          const docs = await firestoreService.getCollection<any>('system_settings', profile.tenantId!);
          if (docs.length > 0) {
            setSettings(docs[0]);
            setShowOperational(!!docs[0].featureToggles?.enableOperationalInventory);
          } else {
            // Create default settings if they don't exist
            const defaultSettings = {
              tenantId: profile.tenantId,
              featureToggles: {
                enableOperationalInventory: false,
              },
              createdAt: new Date().toISOString()
            };
            const newDocId = await firestoreService.addDocument('system_settings', defaultSettings);
            setSettings({ id: newDocId, ...defaultSettings });
            setShowOperational(false);
          }

        } catch (error) {
          console.error('Error fetching inventory settings:', error);
        }
      };
      fetchSettings();

      return () => {
        unsubscribeProducts();
        unsubscribeBatches();
      };
    }
  }, [profile?.tenantId, activeBranchId]);

  const toggleOperational = async () => {
    if (!profile?.tenantId) return;
    
    const newValue = !showOperational;
    try {
      if (settings?.id) {
        const newToggles = { ...settings.featureToggles, enableOperationalInventory: newValue };
        await firestoreService.updateDocument('system_settings', settings.id, {
          featureToggles: newToggles
        });
        setSettings({ ...settings, featureToggles: newToggles });
      } else {
        // Fallback if settings weren't loaded correctly
        const defaultSettings = {
          tenantId: profile.tenantId,
          featureToggles: {
            enableOperationalInventory: newValue,
          },
          createdAt: new Date().toISOString()
        };
        const newDocId = await firestoreService.addDocument('system_settings', defaultSettings);
        setSettings({ id: newDocId, ...defaultSettings });
      }
      
      setShowOperational(newValue);
      toast.success(`Operational Inventory ${newValue ? 'enabled' : 'disabled'}`);
    } catch (error) {
      console.error('Error updating settings:', error);
      toast.error('Failed to update settings');
    }
  };

  const filteredProducts = products.filter(product => {
    const matchesSearch = 
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.productId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.sku?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = selectedCategory === 'all' || product.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

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
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-zinc-900 text-white rounded-2xl shadow-lg shadow-zinc-900/20">
              <Package size={24} />
            </div>
            <h1 className="text-4xl font-black text-zinc-900 uppercase tracking-tight">Inventory</h1>
          </div>
          <div className="flex items-center gap-2 ml-14">
            <p className="text-zinc-500 font-medium">Manage products, stock levels, and operational inventory.</p>
            {activeBranch && (
              <>
                <span className="text-zinc-300 mx-1">•</span>
                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-100">
                  <Building2 size={12} />
                  <span className="text-[10px] font-black uppercase tracking-wider">Viewing: {activeBranch.name}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {isCEO && (
          <div className="flex items-center gap-3 px-4 py-2 bg-zinc-100 rounded-2xl border border-zinc-200">
            <Settings size={16} className="text-zinc-400" />
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Operational Inventory</span>
            <button 
              onClick={toggleOperational}
              className={cn(
                "w-10 h-5 rounded-full transition-all relative",
                showOperational ? "bg-emerald-500" : "bg-zinc-300"
              )}
            >
              <div className={cn(
                "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                showOperational ? "right-1" : "left-1"
              )} />
            </button>
          </div>
        )}
      </div>

      {/* Main Tabs */}
      <div className="flex gap-1 p-1 bg-zinc-100 rounded-[24px] w-fit">
        <TabButton 
          active={activeTab === 'master'} 
          onClick={() => setActiveTab('master')} 
          label="Inventory Master" 
          icon={<Package size={16} />} 
        />
        <TabButton 
          active={activeTab === 'stock'} 
          onClick={() => setActiveTab('stock')} 
          label="Stock Adjustments" 
          icon={<Activity size={16} />} 
        />
        {showOperational && (
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
      </div>

      {/* Tab Content */}
      <div className="min-h-[600px]">
        {activeTab === 'master' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={20} />
                <input 
                  type="text"
                  placeholder="Search by Name, ID, or SKU..."
                  className="w-full pl-12 pr-4 py-3 bg-white border border-zinc-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-zinc-900/5 transition-all text-sm font-medium"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <div className="flex gap-3">
                <select 
                  className="px-4 py-3 bg-white border border-zinc-200 rounded-2xl text-xs font-black uppercase tracking-widest outline-none focus:ring-4 focus:ring-zinc-900/5 transition-all"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                >
                  <option value="all">All Categories</option>
                  <option value="drug/medicine">Drugs</option>
                  <option value="cosmetic">Cosmetics</option>
                  <option value="consumable">Consumables</option>
                  <option value="device">Devices</option>
                  <option value="cosmetic therapeutics">Therapeutics</option>
                </select>
                <button 
                  onClick={() => {
                    setEditingProduct(null);
                    setIsProductModalOpen(true);
                  }}
                  className="px-6 py-3 bg-zinc-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest flex items-center gap-2 hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-900/20 active:scale-95"
                >
                  <Plus size={18} />
                  Add Product
                </button>
              </div>
            </div>

            <div className="bg-white rounded-[32px] border border-zinc-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-50/50 border-b border-zinc-100">
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Product Info</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Category</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-center">Stock Level</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Pricing</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Tax</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {filteredProducts.map((product) => {
                      const productStock = branchBatches
                        .filter(b => b.productId === product.id)
                        .reduce((acc, curr) => acc + (curr.quantity || 0), 0);
                      
                      return (
                        <tr 
                          key={product.id} 
                          className="hover:bg-zinc-50/50 transition-colors cursor-pointer group"
                          onClick={() => setSelectedProductForStockcard(product)}
                        >
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-zinc-900">{product.name}</span>
                                <span className="px-1.5 py-0.5 bg-zinc-100 text-zinc-500 rounded text-[8px] font-black uppercase tracking-tighter border border-zinc-200">
                                  {product.unitOfSell}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">ID: {product.productId}</span>
                                <span className="text-zinc-300">•</span>
                                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">SKU: {product.sku}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded-md text-[10px] font-black uppercase tracking-widest">
                              {product.category}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex flex-col items-center">
                              <span className={cn(
                                "text-sm font-black",
                                productStock <= 10 ? "text-red-600" : "text-zinc-900"
                              )}>
                                {(productStock || 0).toLocaleString()}
                              </span>
                              <span className="text-[8px] font-black text-zinc-400 uppercase tracking-tighter">
                                {product.unitOfSell}s
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-zinc-900">Sell: {(product.sellingPricePerUnit || 0).toLocaleString()} UGX</span>
                            <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Cost: {(product.costPricePerPack || 0).toLocaleString()} /pack</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-black text-zinc-900 uppercase tracking-widest">{product.vatClassification}</span>
                            {product.vatClassification === 'Standard Rated' && (
                              <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{product.vatPercentage}% VAT</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => {
                                setEditingProduct(product);
                                setIsProductModalOpen(true);
                              }}
                              className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-xl transition-all"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button 
                              onClick={() => handleDeleteProduct(product.id)}
                              className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                    })}
                    {filteredProducts.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-24 text-center">
                          <div className="flex flex-col items-center gap-3 text-zinc-400">
                            <Package size={48} strokeWidth={1} />
                            <p className="text-sm font-bold uppercase tracking-widest">No products found</p>
                            <button 
                              onClick={() => setIsProductModalOpen(true)}
                              className="text-xs font-black text-zinc-900 underline underline-offset-4"
                            >
                              Add your first product
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'stock' && <StockManagementTab />}
        {activeTab === 'operational' && <OperationalInventoryTab />}
        {activeTab === 'reports' && <ReportHubTab />}
      </div>

      {/* Modals */}
      {isProductModalOpen && (
        <ProductModal 
          isOpen={isProductModalOpen} 
          onClose={() => {
            setIsProductModalOpen(false);
            setEditingProduct(null);
          }} 
          product={editingProduct} 
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
    onClick={onClick}
    className={cn(
      "px-6 py-2.5 rounded-[20px] text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
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
