export interface PosV2RevisionReferenceOption {
  id: string;
  name: string;
  secondary: string;
  tertiary?: string;
  status: string;
  selectable: boolean;
  isStaff?: boolean;
  billingEligible?: boolean;
}

type RegistryRecord = Record<string, unknown> & { id?: string };

function firstText(record: RegistryRecord, fields: string[]): string {
  for (const field of fields) {
    const value = String(record[field] ?? '').trim();
    if (value) return value;
  }
  return '';
}

function normalizedStatus(record: RegistryRecord): string {
  const explicit = firstText(record, ['status', 'care_status', 'account_status']).toLowerCase();
  if (explicit) return explicit;
  if (record.isActive === false || record.active === false) return 'inactive';
  return 'active';
}

function isSelectableStatus(status: string): boolean {
  return !['inactive', 'blacklisted', 'blocked', 'suspended', 'deleted'].includes(status);
}

function explicitEligibility(record: RegistryRecord, fields: string[]): boolean {
  for (const field of fields) {
    if (record[field] === false) return false;
  }
  return true;
}

export function clientRevisionOption(record: RegistryRecord): PosV2RevisionReferenceOption {
  const status = normalizedStatus(record);
  const phone = firstText(record, ['phone_number', 'phone', 'mobile', 'contact_phone']);
  const label = firstText(record, ['billing_type', 'type', 'care_status', 'status']);
  return {
    id: String(record.id ?? '').trim(),
    name: firstText(record, ['full_name', 'fullName', 'name', 'displayName']) || 'Unnamed client',
    secondary: [phone, label].filter(Boolean).join(' · '),
    status,
    selectable: isSelectableStatus(status),
    isStaff: record.isStaff === true || (Array.isArray(record.labels) && record.labels.map(String).some(labelValue => labelValue.toUpperCase() === 'EMPLOYEE')),
    billingEligible: explicitEligibility(record, ['billingEligible', 'billing_eligible', 'creditEligible', 'credit_eligible'])
  };
}

export function institutionRevisionOption(record: RegistryRecord): PosV2RevisionReferenceOption {
  const status = normalizedStatus(record);
  const type = firstText(record, ['type', 'institution_type', 'commercial_category', 'category']);
  const billingEligible = explicitEligibility(record, ['billingEligible', 'billing_eligible', 'creditEligible', 'credit_eligible']);
  return {
    id: String(record.id ?? '').trim(),
    name: firstText(record, ['supplier_name', 'institution_name', 'name', 'full_name']) || 'Unnamed institution',
    secondary: [type, status].filter(Boolean).join(' · '),
    tertiary: billingEligible ? 'Billing eligible' : 'Billing restricted',
    status,
    selectable: isSelectableStatus(status),
    billingEligible
  };
}

export function prescriberRevisionOption(record: RegistryRecord): PosV2RevisionReferenceOption {
  const status = normalizedStatus(record);
  const registration = firstText(record, [
    'medical_council_registration_number', 'professional_licence_number', 'professional_license_number',
    'licenseNumber', 'licenceNumber', 'registrationNumber', 'registration_number'
  ]);
  const specialty = firstText(record, ['specialty', 'speciality', 'facility', 'associatedInstitution', 'institution_name']);
  return {
    id: String(record.id ?? '').trim(),
    name: firstText(record, ['full_name', 'fullName', 'name', 'displayName']) || 'Unnamed prescriber',
    secondary: [registration && `Reg: ${registration}`, specialty].filter(Boolean).join(' · '),
    status,
    selectable: isSelectableStatus(status)
  };
}

export function revisionPatientSelection(option: PosV2RevisionReferenceOption | null) {
  return {
    patientId: option?.id || null,
    patientName: option?.name || null,
    patientIsStaff: option?.isStaff === true
  };
}

export function revisionInstitutionSelection(option: PosV2RevisionReferenceOption | null) {
  return {
    institutionId: option?.id || null,
    institutionName: option?.name || null,
    institutionBillingEligible: option?.billingEligible !== false
  };
}

export function revisionPrescriberSelection(option: PosV2RevisionReferenceOption | null) {
  return {
    prescriberId: option?.id || null,
    prescriberName: option?.name || null
  };
}
