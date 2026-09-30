import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/pages/Sales.tsx';
let source = readFileSync(path, 'utf8');

const importAnchor = "import { canOperatePos, formatPosCheckoutError } from '../utils/posAuthorization';";
const validationImport = "import { validateSaleCheckoutContext } from '../utils/saleContextValidation';";
if (!source.includes(validationImport)) {
  if (!source.includes(importAnchor)) throw new Error('Sales import anchor not found');
  source = source.replace(importAnchor, `${importAnchor}\n${validationImport}`);
}

const oldHandleValidation = `    // Validation based on context
    if (context === 'telepharmacy' && !selectedPatient) {
      toast.error('Patient is mandatory for Telepharmacy');
      return;
    }
    if (context === 'institutional' && !selectedInstitution) {
      toast.error('Institution is mandatory for Institutional billing');
      return;
    }
`;
const newHandleValidation = `    const contextValidation = validateSaleCheckoutContext({
      context,
      paymentMethod,
      hasPatient: Boolean(selectedPatient),
      hasInstitution: Boolean(selectedInstitution)
    });
    if ('message' in contextValidation) {
      toast.error(contextValidation.message);
      return;
    }
`;
if (source.includes(oldHandleValidation)) {
  source = source.replace(oldHandleValidation, newHandleValidation);
}

const completeAnchor = `    if (!editingSaleId && !activeBranchId) {
      receiptWindow?.close();
      toast.error('Select an active branch before processing a sale.');
      return;
    }

    // Check if any cart item's price is below cost price of that specific batch
`;
const completeReplacement = `    if (!editingSaleId && !activeBranchId) {
      receiptWindow?.close();
      toast.error('Select an active branch before processing a sale.');
      return;
    }

    const contextValidation = validateSaleCheckoutContext({
      context,
      paymentMethod,
      hasPatient: Boolean(selectedPatient),
      hasInstitution: Boolean(selectedInstitution)
    });
    if ('message' in contextValidation) {
      receiptWindow?.close();
      toast.error(contextValidation.message);
      return;
    }

    // Check if any cart item's price is below cost price of that specific batch
`;
if (source.includes(completeAnchor)) {
  source = source.replace(completeAnchor, completeReplacement);
}

const count = source.split('const contextValidation = validateSaleCheckoutContext({').length - 1;
if (count !== 2) throw new Error(`Expected exactly two Phase 2 validation boundaries, found ${count}`);

writeFileSync(path, source);
