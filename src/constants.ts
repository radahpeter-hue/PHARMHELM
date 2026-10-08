export const PRODUCT_CATEGORIES = [
  'drug/medicine',
  'cosmetic',
  'consumable',
  'device',
  'cosmetic therapeutics'
];

export const THERAPEUTIC_CLASSES = [
  'Cardiovascular System',
  'Central Nervous System (CNS)',
  'Anti-Infectives',
  'Endocrine & Metabolic System',
  'Gastrointestinal (GI) System',
  'Respiratory System',
  'Oncologicals',
  'Dermatologicals (Skin Treatments)',
  'Genito-Urinary System & Sex Hormones',
  'Sensory Organs (Ophthalmic & Otic)',
  'Musculo-Skeletal System',
  'Immunologicals (Vaccines & Serums)',
  'Miscellaneous & Therapeutic Nutrients'
];

export const DOSAGE_FORMS = [
  // Existing values are retained for compatibility with saved product records.
  'Ampule', 'Vial', 'Nasal Spray', 'Nasal Drop', 'Tablet', 'Capsule', 'Pessary', 'Suppository',
  'Powder/Granule', 'Syrup', 'Suspension', 'Oral Drop', 'Eye/Ear Drops', 'Prefilled Syringe',
  'Elixir', 'Cream', 'Ointment', 'Gel', 'IV fluids', 'Lotion', 'Nebulizer Solution',
  'Inhaler', 'Transdermal patches', 'Shampoo',
  'Lozenge/Troche', 'Solution', 'Emulsion', 'Paste', 'Aerosol/Metered-Dose Inhaler',
  'Dry Powder Inhaler', 'Medical Gas', 'Implant/Pellet', 'Liposomal Injection/Solution',
  'Lyophilized Powder (Requires Reconstitution)', 'Pellets/Impregnated Materials',
  'Bulk Powder/Crystals', 'Tincture/Fluid Extract', 'Spirit/Aromatic Water',
  'Combination Kit', 'Foam', 'Rinse', 'Medicated Dressing/Gauze', 'Enema',
  'Ophthalmic Preparation', 'Otic Preparation', 'Injection'
];

export const ROUTES_OF_ADMINISTRATION = [
  'oral', 'sublingual', 'buccal', 'rectal', 'enteric_feeding_tube',
  'iv', 'im', 'subcutaneous', 'intradermal', 'intrathecal', 'epidural',
  'intraosseous', 'intra_arterial', 'intra_articular', 'intracardiac',
  'oral_inhalation', 'nasal_inhalation', 'topical', 'transdermal',
  'ophthalmic', 'otic', 'nasal_instillation', 'vaginal',
  // Retain the legacy value so existing product records still display correctly.
  'nasal'
];

export const ROUTE_LABELS: Record<string, string> = {
  oral: 'Oral (PO)',
  sublingual: 'Sublingual',
  buccal: 'Buccal',
  rectal: 'Rectal (PR)',
  enteric_feeding_tube: 'Enteric/Feeding Tube',
  iv: 'Intravenous (IV)',
  im: 'Intramuscular (IM)',
  subcutaneous: 'Subcutaneous (SC/SQ)',
  intradermal: 'Intradermal (ID)',
  intrathecal: 'Intrathecal',
  epidural: 'Epidural',
  intraosseous: 'Intraosseous (IO)',
  intra_arterial: 'Intra-arterial',
  intra_articular: 'Intra-articular',
  intracardiac: 'Intracardiac',
  oral_inhalation: 'Oral Inhalation',
  nasal_inhalation: 'Nasal Inhalation',
  topical: 'Cutaneous/Topical',
  transdermal: 'Transdermal',
  ophthalmic: 'Ophthalmic/Ocular',
  otic: 'Otic',
  nasal_instillation: 'Nasal Instillation',
  vaginal: 'Vaginal',
  nasal: 'Nasal (legacy)'
};

export const PRESCRIPTION_CATEGORIES = [
  'OTC', 'prescription only', 'controlled'
];

export const VOLUME_WEIGHT_UNITS = [
  'ml', 'oz', 'gms'
];

export const UNITS = [
  'Tablets',
  'Capsules',
  'Syrup (ml)',
  'Injection',
  'Cream/Ointment',
  'Box',
  'Sachet',
  'Piece'
];

export const ROLES = {
  owner: 'Business Owner',
  admin: 'Branch Manager',
  pharmacist: 'Pharmacist',
  cashier: 'Cashier',
  CEO: 'CEO',
  financeOfficer: 'Finance Officer',
  marketing: 'Marketing'
};
