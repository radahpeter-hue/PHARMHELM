import { 
  collection, 
  getDocs, 
  query, 
  where,
  doc,
  updateDoc
} from 'firebase/firestore';
import { db } from '../firebase';

export async function getNextQuotationId(
  tenantId: string, 
  branchCode: string, 
  systemSettings: any
): Promise<string> {
  let format = systemSettings?.numberingFormats?.Quotation;
  if (!format) {
    format = 'QUO-[BRANCH]-[YEAR]-[SEQ4]';
    // Update setting document in Firestore if exists
    if (systemSettings?.id) {
      try {
        const setRef = doc(db, 'system_settings', systemSettings.id);
        await updateDoc(setRef, {
          [`numberingFormats.Quotation`]: 'QUO-[BRANCH]-[YEAR]-[SEQ4]'
        });
      } catch (e) {
        console.warn('Failed to update systemSettings with default Quotation format:', e);
      }
    }
  }

  // Count existing pos_quotations to determine next sequence number
  const q = query(
    collection(db, 'pos_quotations'),
    where('tenantId', '==', tenantId)
  );
  const snap = await getDocs(q);
  const nextSeq = snap.size + 1;
  
  const seqStr4 = String(nextSeq).padStart(4, '0');
  const seqStr6 = String(nextSeq).padStart(6, '0');
  const currentYear = new Date().getFullYear().toString();

  // Handle both bracket and brace formats
  let quoId = format
    .replace('[BRANCH]', branchCode)
    .replace('{BRANCH}', branchCode)
    .replace('[YEAR]', currentYear)
    .replace('{YEAR}', currentYear)
    .replace('[SEQ4]', seqStr4)
    .replace('{SEQ4}', seqStr4)
    .replace('[SEQ6]', seqStr6)
    .replace('{SEQ6}', seqStr6);

  return quoId;
}
