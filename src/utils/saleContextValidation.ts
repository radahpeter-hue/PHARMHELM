export interface SaleCheckoutContextValidationInput {
  context: string;
  paymentMethod: string;
  hasPatient: boolean;
  hasInstitution: boolean;
}

export type SaleCheckoutContextValidationResult =
  | { valid: true }
  | {
      valid: false;
      code:
        | 'telepharmacy_patient_required'
        | 'institution_required'
        | 'credit_identity_required';
      message: string;
    };

/**
 * Validates sale identity/context integrity before any checkout engine is allowed
 * to start. It deliberately does not perform stock, FEFO, payment posting or
 * credit-limit calculations; those remain the responsibility of existing flows.
 */
export function validateSaleCheckoutContext(
  input: SaleCheckoutContextValidationInput
): SaleCheckoutContextValidationResult {
  const context = String(input.context || '').trim().toLowerCase();
  const paymentMethod = String(input.paymentMethod || '').trim().toLowerCase();

  if (context === 'telepharmacy' && !input.hasPatient) {
    return {
      valid: false,
      code: 'telepharmacy_patient_required',
      message: 'Client/patient name is required for a telepharmacy sale.'
    };
  }

  if (context === 'institutional' && !input.hasInstitution) {
    return {
      valid: false,
      code: 'institution_required',
      message: 'Select an institution before completing an institutional sale.'
    };
  }

  if ((paymentMethod === 'credit' || paymentMethod === 'institutional_credit') && !input.hasPatient && !input.hasInstitution) {
    return {
      valid: false,
      code: 'credit_identity_required',
      message: 'An identifiable client or institution is required for a credit sale.'
    };
  }

  return { valid: true };
}
