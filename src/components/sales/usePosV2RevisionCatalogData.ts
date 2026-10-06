import { useEffect, useMemo, useState } from 'react';
import type { Product, ProductBatch, SystemSettings } from '../../types';
import { firestoreService } from '../../services/firestore';

export interface PosV2RevisionCatalogData {
  products: Product[];
  batches: ProductBatch[];
  systemSettings: SystemSettings | null;
  isReady: boolean;
}

/**
 * Read-only live data bridge for the POS V2 revision catalog.
 * It deliberately exposes subscriptions only; all revision writes remain outside this hook.
 */
export function usePosV2RevisionCatalogData(
  tenantId: string | null | undefined,
  enabled: boolean
): PosV2RevisionCatalogData {
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [batchesLoaded, setBatchesLoaded] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    if (!enabled || !tenantId) {
      setProducts([]);
      setBatches([]);
      setSystemSettings(null);
      setProductsLoaded(false);
      setBatchesLoaded(false);
      setSettingsLoaded(false);
      return;
    }

    setProductsLoaded(false);
    setBatchesLoaded(false);
    setSettingsLoaded(false);

    const unsubscribeProducts = firestoreService.subscribeToCollection<Product>(
      'products',
      tenantId,
      data => {
        setProducts(data);
        setProductsLoaded(true);
      }
    );
    const unsubscribeBatches = firestoreService.subscribeToCollection<ProductBatch>(
      'product_batches',
      tenantId,
      data => {
        setBatches(data);
        setBatchesLoaded(true);
      }
    );
    const unsubscribeSettings = firestoreService.subscribeToCollection<SystemSettings>(
      'system_settings',
      tenantId,
      data => {
        setSystemSettings(data[0] || null);
        setSettingsLoaded(true);
      }
    );

    return () => {
      unsubscribeProducts();
      unsubscribeBatches();
      unsubscribeSettings();
    };
  }, [tenantId, enabled]);

  return useMemo(() => ({
    products,
    batches,
    systemSettings,
    isReady: Boolean(enabled && tenantId && productsLoaded && batchesLoaded && settingsLoaded)
  }), [products, batches, systemSettings, enabled, tenantId, productsLoaded, batchesLoaded, settingsLoaded]);
}
