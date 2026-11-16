export interface SaleCheckoutContextValidationInput {
  context: string;
  paymentMethod: string;
  secondaryPaymentMethod?: string;
  hasPatient: boolean;
  hasInstitution: boolean;
  hasEligibleInstitution?: boolean;
}

export type SaleCheckoutContextValidationResult =
  | { valid: true }
  | {
      valid: false;
      code:
        | 'telepharmacy_patient_required'
        | 'institution_required'
        | 'credit_identity_required'
        | 'credit_institution_ineligible';
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

  const onCredit = [paymentMethod, input.secondaryPaymentMethod].some(method => method === 'credit' || method === 'institutional_credit');
  if (onCredit && !input.hasInstitution && !input.hasPatient) {
    return {
      valid: false,
      code: 'credit_identity_required',
      message: 'Select a registered customer or eligible billing institution for credit.'
    };
  }

  if (onCredit && input.hasInstitution && input.hasEligibleInstitution === false) {
    return {
      valid: false,
      code: 'credit_institution_ineligible',
      message: 'The selected institution is not eligible for institutional credit.'
    };
  }

  return { valid: true };
}
