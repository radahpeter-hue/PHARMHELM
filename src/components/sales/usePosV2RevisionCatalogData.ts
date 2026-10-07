import { useEffect, useMemo, useState } from 'react';
import type { BillableService, Product, ProductBatch, Staff, SystemSettings } from '../../types';
import { firestoreService } from '../../services/firestore';
import {
  clientRevisionOption,
  institutionRevisionOption,
  prescriberRevisionOption,
  type PosV2RevisionReferenceOption
} from '../../services/pos-v2/posSaleRevisionV2ReferenceData';

export interface PosV2RevisionCatalogData {
  products: Product[];
  services: BillableService[];
  servicesReady: boolean;
  batches: ProductBatch[];
  systemSettings: SystemSettings | null;
  clients: PosV2RevisionReferenceOption[];
  institutions: PosV2RevisionReferenceOption[];
  prescribers: PosV2RevisionReferenceOption[];
  isReady: boolean;
  referencesReady: boolean;
}

/**
 * Read-only live data bridge for the POS V2 revision catalog.
 * It deliberately exposes subscriptions only; all revision writes remain outside this hook.
 */
export function usePosV2RevisionCatalogData(
  tenantId: string | null | undefined,
  enabled: boolean
): PosV2RevisionCatalogData {
  const [services, setServices] = useState<BillableService[]>([]);
  const [servicesLoaded, setServicesLoaded] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  const [clients, setClients] = useState<Record<string, unknown>[]>([]);
  const [institutions, setInstitutions] = useState<Record<string, unknown>[]>([]);
  const [prescribers, setPrescribers] = useState<Record<string, unknown>[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [batchesLoaded, setBatchesLoaded] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [institutionsLoaded, setInstitutionsLoaded] = useState(false);
  const [prescribersLoaded, setPrescribersLoaded] = useState(false);
  const [staffLoaded, setStaffLoaded] = useState(false);

  useEffect(() => {
    if (!enabled || !tenantId) {
      setProducts([]);
      setServices([]);
      setServicesLoaded(false);
      setBatches([]);
      setSystemSettings(null);
      setClients([]);
      setInstitutions([]);
      setPrescribers([]);
      setStaff([]);
      setProductsLoaded(false);
      setBatchesLoaded(false);
      setSettingsLoaded(false);
      setClientsLoaded(false);
      setInstitutionsLoaded(false);
      setPrescribersLoaded(false);
      setStaffLoaded(false);
      return;
    }

    setProductsLoaded(false);
    setBatchesLoaded(false);
    setSettingsLoaded(false);
    setClientsLoaded(false);
    setInstitutionsLoaded(false);
    setPrescribersLoaded(false);
    setStaffLoaded(false);

    setServicesLoaded(false);
    const unsubscribeServices = firestoreService.subscribeToCollection<BillableService>('billable_services', tenantId, data => { setServices(data); setServicesLoaded(true); });
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
    const unsubscribeClients = firestoreService.subscribeToCollection<Record<string, unknown>>(
      'clients', tenantId, data => { setClients(data); setClientsLoaded(true); }
    );
    const unsubscribeInstitutions = firestoreService.subscribeToCollection<Record<string, unknown>>(
      'institutions', tenantId, data => { setInstitutions(data); setInstitutionsLoaded(true); }
    );
    const unsubscribePrescribers = firestoreService.subscribeToCollection<Record<string, unknown>>(
      'prescribers', tenantId, data => { setPrescribers(data); setPrescribersLoaded(true); }
    );
    const unsubscribeStaff = firestoreService.subscribeToCollection<Staff>(
      'staff', tenantId, data => { setStaff(data); setStaffLoaded(true); }
    );

    return () => {
      unsubscribeServices();
      unsubscribeProducts();
      unsubscribeBatches();
      unsubscribeSettings();
      unsubscribeClients();
      unsubscribeInstitutions();
      unsubscribePrescribers();
      unsubscribeStaff();
    };
  }, [tenantId, enabled]);

  return useMemo(() => {
    const staffClients = staff.map(member => ({
      ...member,
      id: member.id,
      full_name: member.full_name || member.username || 'Unknown staff member',
      phone_number: member.phone_number || '',
      status: member.status,
      isStaff: true,
      labels: ['EMPLOYEE'],
      billing_type: 'Staff / Welfare'
    }));
    return {
      products,
      services,
      servicesReady: Boolean(enabled && tenantId && servicesLoaded),
      batches,
      systemSettings,
      clients: [...clients, ...staffClients].map(clientRevisionOption).filter(option => option.id),
      institutions: institutions.map(institutionRevisionOption).filter(option => option.id),
      prescribers: prescribers.map(prescriberRevisionOption).filter(option => option.id),
      isReady: Boolean(enabled && tenantId && productsLoaded && batchesLoaded && settingsLoaded),
      referencesReady: Boolean(enabled && tenantId && clientsLoaded && institutionsLoaded && prescribersLoaded && staffLoaded)
    };
  }, [
    services, servicesLoaded, products, batches, systemSettings, clients, institutions, prescribers, staff,
    enabled, tenantId, productsLoaded, batchesLoaded, settingsLoaded,
    clientsLoaded, institutionsLoaded, prescribersLoaded, staffLoaded
  ]);
}
