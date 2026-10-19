import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';
import type { OperationalInventoryMaster } from '../../types';

/** Resolve historical transaction references without rewriting their internal IDs. */
export function OperationalItemCode({ masterItemId }: { masterItemId?: string }) {
  const { profile } = useAuth();
  const tenantId = profile?.tenantId;
  const [identity, setIdentity] = useState<{ tenantId: string; masterItemId: string; code: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setIdentity(null);
    setFailed(false);
    if (!tenantId || !masterItemId) return;
    void firestoreService.getDocument<OperationalInventoryMaster>('operational_inventory_masters', masterItemId)
      .then(master => {
        if (cancelled) return;
        if (master?.tenantId !== tenantId || master.inventoryClass !== 'OPERATIONAL' || !master.uniqueId?.trim()) {
          setFailed(true);
          return;
        }
        setIdentity({ tenantId, masterItemId, code: master.uniqueId.trim() });
      }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [tenantId, masterItemId]);
  if (!masterItemId) return null;
  const code = identity?.tenantId === tenantId && identity.masterItemId === masterItemId ? identity.code : null;
  return <span className="mt-1 block break-words text-xs font-medium text-zinc-700" aria-live="polite">Item code: {code || (failed ? 'Unavailable' : 'Loading…')}</span>;
}
