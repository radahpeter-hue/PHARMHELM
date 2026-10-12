import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { operationalInventoryEnabledFromSettings } from '../services/inventoryClassification';

/**
 * The canonical tenant settings document is system_settings/{tenantId}.
 * Fail closed while it is missing or unavailable so the feature cannot be
 * enabled only by a client-side legacy settings document.
 */
export function useOperationalInventoryFeature(): boolean {
  const { profile } = useAuth();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const tenantId = profile?.tenantId;
    if (!tenantId) {
      setEnabled(false);
      return;
    }

    setEnabled(false);
    return onSnapshot(doc(db, 'system_settings', tenantId), snapshot => {
      const data = snapshot.exists() ? snapshot.data() : null;
      setEnabled(operationalInventoryEnabledFromSettings(tenantId, data));
    }, error => {
      console.error('Failed to read Operational Inventory setting:', error);
      setEnabled(false);
    });
  }, [profile?.tenantId]);

  return enabled;
}
