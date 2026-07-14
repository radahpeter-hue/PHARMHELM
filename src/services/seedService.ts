import { collection, getDocs, addDoc, setDoc, doc, query, where } from 'firebase/firestore';
import { db } from '../firebase';

export async function seedInitialData() {
  try {
    const q = query(collection(db, 'tenants'), where('slug', '==', 'radah'));
    const snap = await getDocs(q);
    if (!snap.empty) return; // Already seeded

    console.log('Seeding initial data...');

    // 1. Seed Tenant
    const tenantData = {
      name: 'Radah Pharmaceutical Ltd',
      slug: 'radah',
      country: 'Uganda',
      nda_reg_number: 'NDA/WHD/2019/00412',
      brand_colour: '#16a34a',
      contact_name: 'Peter Sentongo',
      contact_email: 'peterssentongo61@gmail.com',
      contact_phone: '+256 700 000 000',
      subscription_tier: 'enterprise' as const,
      subscription_status: 'active' as const,
      subscription_cycle: 'annual' as const,
      subscription_start: new Date().toISOString(),
      subscription_end: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      modules_enabled: ['hr', 'finance', 'inventory', 'sales', 'logistics', 'qa'],
      deployment_mode: 'multi_branch' as const,
      status: 'active' as const,
      created_at: new Date().toISOString(),
      created_by: 'system'
    };

    const tenantRef = await addDoc(collection(db, 'tenants'), tenantData);
    const tenantId = tenantRef.id;

    // 2. Seed Branches
    const branches = [
      { 
        tenantId, 
        name: 'Kampala HQ', 
        branch_code: 'KLA', 
        type: 'HQ' as const, 
        status: 'Active' as const, 
        address: 'Plot 12, Kampala Rd', 
        phone: '+256 700 000 001',
        created_at: new Date().toISOString(),
        created_by: 'system'
      },
      { 
        tenantId, 
        name: 'Mbarara Branch', 
        branch_code: 'MBR', 
        type: 'Branch' as const, 
        status: 'Active' as const, 
        address: 'High Street, Mbarara', 
        phone: '+256 700 000 002',
        created_at: new Date().toISOString(),
        created_by: 'system'
      },
      { 
        tenantId, 
        name: 'Imports Warehouse', 
        branch_code: 'WH1', 
        type: 'Warehouse' as const, 
        status: 'Active' as const, 
        address: 'Industrial Area, Kampala', 
        phone: '+256 700 000 003',
        created_at: new Date().toISOString(),
        created_by: 'system'
      },
    ];

    const branchIds: string[] = [];
    for (const b of branches) {
      const bRef = await addDoc(collection(db, 'branches'), b);
      branchIds.push(bRef.id);
    }

    // 3. Seed Staff (Mocking UIDs for demo accounts)
    const staff = [
      { 
        uid: 'admin-uid',
        tenantId, 
        username: 'admin',
        password: 'admin123',
        full_name: 'Peter Omondi', 
        displayName: 'Peter Omondi',
        email: 'admin@pharmapro.io', 
        role: 'owner' as const, 
        branch_id: branchIds[0],
        assigned_branches: branchIds, 
        default_branch_id: branchIds[0],
        status: 'active' as const, 
        active: true,
        phone_number: '+256 700 000 010',
        password_set: true,
        created_at: new Date().toISOString() 
      },
      { 
        uid: 'it-uid',
        tenantId, 
        username: 'it_manager',
        password: 'it123',
        full_name: 'IT Manager', 
        displayName: 'IT Manager',
        email: 'it@radah.pharmflow.io', 
        role: 'IT Head' as const, 
        branch_id: branchIds[0],
        assigned_branches: branchIds, 
        default_branch_id: branchIds[0],
        status: 'active' as const, 
        active: true,
        phone_number: '+256 700 000 011',
        password_set: true,
        created_at: new Date().toISOString() 
      },
      { 
        uid: 'cashier-uid',
        tenantId, 
        username: 'cashier',
        password: 'cashier123',
        full_name: 'Grace Atim', 
        displayName: 'Grace Atim',
        email: 'cashier@radah.pharmflow.io', 
        role: 'cashier' as const, 
        branch_id: branchIds[0],
        assigned_branches: [branchIds[0]], 
        default_branch_id: branchIds[0],
        status: 'active' as const, 
        active: true,
        phone_number: '+256 700 000 012',
        password_set: true,
        created_at: new Date().toISOString() 
      },
      { 
        uid: 'dev2-uid',
        tenantId, 
        username: 'dev_tester',
        password: 'tester123',
        full_name: 'Dev Tester', 
        displayName: 'Dev Tester',
        email: 'dev2@pharmapro.io', 
        role: 'owner' as const, 
        branch_id: branchIds[0],
        assigned_branches: branchIds, 
        default_branch_id: branchIds[0],
        status: 'active' as const, 
        active: true,
        phone_number: '+256 700 000 013',
        password_set: true,
        created_at: new Date().toISOString() 
      }
    ];

    for (const s of staff) {
      // Use email as doc ID for easier matching in rules for demo accounts
      await setDoc(doc(db, 'staff', s.uid), s);
    }

    console.log('Seeding complete.');
  } catch (err) {
    console.warn('Seed check skipped or failed (likely due to permissions):', err);
  }
}

export async function ensureTenantTestingData(tenantId: string) {
  if (!tenantId) return;
  try {
    const clientsQuery = query(collection(db, 'clients'), where('tenantId', '==', tenantId));
    const clientsSnap = await getDocs(clientsQuery);
    
    let clientIds: string[] = [];

    if (clientsSnap.empty) {
      console.log(`Seeding clients for tenant ${tenantId}...`);
      const testClients = [
        {
          tenantId,
          name: 'John Mukasa',
          phone: '+256 772 123 456',
          type: 'individual',
          sms_opt_in: true,
          sms_opt_in_date: '2026-05-10',
          sms_opt_in_logged_by: 'Marketing Head',
          preferred_channel: 'SMS',
          segment_tags: ['Hypertension', 'Cardio', 'Chronic'],
          next_refill_due_date: '2026-06-15',
          loyalty_points: 350,
          balance: 450000,
          created_at: '2026-04-10T10:00:00Z'
        },
        {
          tenantId,
          name: 'Jane Namuli',
          phone: '+256 701 987 654',
          type: 'individual',
          sms_opt_in: true,
          sms_opt_in_date: '2026-05-12',
          sms_opt_in_logged_by: 'Marketing Head',
          preferred_channel: 'WhatsApp',
          segment_tags: ['Diabetes Type II', 'Endocrine', 'Chronic'],
          next_refill_due_date: '2026-06-10',
          loyalty_points: 520,
          balance: 1200000,
          created_at: '2026-04-15T11:30:00Z'
        },
        {
          tenantId,
          name: 'Peter Semanda',
          phone: '+256 752 444 333',
          type: 'individual',
          sms_opt_in: true,
          sms_opt_in_date: '2026-05-20',
          sms_opt_in_logged_by: 'Marketing Head',
          preferred_channel: 'SMS',
          segment_tags: ['Asthma', 'Pulmonary', 'Chronic'],
          next_refill_due_date: '2026-06-25',
          loyalty_points: 180,
          balance: 0,
          created_at: '2026-05-01T09:00:00Z'
        },
        {
          tenantId,
          name: 'Sarah Alupo',
          phone: '+256 782 555 111',
          type: 'individual',
          sms_opt_in: false,
          sms_opt_in_date: '',
          sms_opt_in_logged_by: '',
          preferred_channel: 'None',
          segment_tags: ['Hypertension', 'Cardio', 'Chronic'],
          next_refill_due_date: '2026-06-12',
          loyalty_points: 290,
          balance: 850000,
          created_at: '2026-04-20T14:15:00Z'
        },
        {
          tenantId,
          name: 'David Okot',
          phone: '+256 703 666 777',
          type: 'individual',
          sms_opt_in: true,
          sms_opt_in_date: '2026-05-22',
          sms_opt_in_logged_by: 'Marketing Personnel',
          preferred_channel: 'SMS',
          segment_tags: ['Diabetes Type I', 'Endocrine', 'Chronic'],
          next_refill_due_date: '2026-06-20',
          loyalty_points: 410,
          balance: 250000,
          created_at: '2026-05-05T16:45:00Z'
        },
        {
          tenantId,
          name: 'Semakula Henry',
          phone: '+256 774 111 222',
          type: 'individual',
          sms_opt_in: true,
          sms_opt_in_date: '2026-05-22',
          sms_opt_in_logged_by: 'System',
          preferred_channel: 'SMS',
          segment_tags: ['Hypertension', 'Cardio', 'Chronic'],
          next_refill_due_date: '2026-07-15',
          loyalty_points: 800,
          balance: 0,
          created_at: '2026-03-10T12:00:00Z'
        },
        {
          tenantId,
          name: 'Nakitende Prossy',
          phone: '+256 702 333 444',
          type: 'individual',
          sms_opt_in: true,
          sms_opt_in_date: '2026-05-25',
          sms_opt_in_logged_by: 'System',
          preferred_channel: 'WhatsApp',
          segment_tags: ['General', 'Pediatric'],
          next_refill_due_date: '',
          loyalty_points: 120,
          balance: 0,
          created_at: '2026-05-12T15:20:00Z'
        },
        {
          tenantId,
          name: 'Kato Syrus',
          phone: '+256 753 222 111',
          type: 'individual',
          sms_opt_in: true,
          sms_opt_in_date: '2026-05-28',
          sms_opt_in_logged_by: 'System',
          preferred_channel: 'SMS',
          segment_tags: ['Chronic'],
          next_refill_due_date: '2026-07-20',
          loyalty_points: 950,
          balance: 150000,
          created_at: '2026-03-25T11:10:00Z'
        }
      ];

      for (const c of testClients) {
        const ref = await addDoc(collection(db, 'clients'), c);
        clientIds.push(ref.id);
      }
    } else {
      clientIds = clientsSnap.docs.map(d => d.id);
    }

    // Seed Prescribers
    const prescribersQuery = query(collection(db, 'prescribers'), where('tenantId', '==', tenantId));
    const prescribersSnap = await getDocs(prescribersQuery);
    
    let prescriberIds: string[] = [];
    if (prescribersSnap.empty) {
      console.log(`Seeding prescribers for tenant ${tenantId}...`);
      const testPrescribers = [
        {
          tenantId,
          name: 'Dr. Sarah Nabatanzi',
          licenseNumber: 'NDA/P/2194',
          facility: 'Mulago Referral Hospital',
          isEnrolledInRewardProgram: true,
          isKOL: true,
          keyOpinionLeaderCategory: 'Doctor',
          contactDetails: 'sarah.nabatanzi@mulago.org',
          associatedInstitution: 'Mulago Hospital',
          monthlyPrescriptions: 145,
          created_at: new Date().toISOString()
        },
        {
          tenantId,
          name: 'Dr. James Okello',
          licenseNumber: 'NDA/P/3382',
          facility: 'Mbarara Regional Referral',
          isEnrolledInRewardProgram: true,
          isKOL: true,
          keyOpinionLeaderCategory: 'Doctor',
          contactDetails: 'jokello@mbararahosp.go.ug',
          associatedInstitution: 'Mbarara Hospital',
          monthlyPrescriptions: 98,
          created_at: new Date().toISOString()
        },
        {
          tenantId,
          name: 'Dr. Mary Atwine',
          licenseNumber: 'NDA/P/1049',
          facility: 'Kisenyi Health Center IV',
          isEnrolledInRewardProgram: true,
          isKOL: true,
          keyOpinionLeaderCategory: 'Doctor',
          contactDetails: 'atwine.m@kisenyihc.org',
          associatedInstitution: 'Kisenyi Health Center',
          monthlyPrescriptions: 85,
          created_at: new Date().toISOString()
        },
        {
          tenantId,
          name: 'Dr. Robert Kato',
          licenseNumber: 'NDA/P/5831',
          facility: 'Kawempe National Referral',
          isEnrolledInRewardProgram: true,
          isKOL: false,
          keyOpinionLeaderCategory: 'Doctor',
          contactDetails: 'rkato@kawempe.go.ug',
          associatedInstitution: 'Kawempe Hospital',
          monthlyPrescriptions: 62,
          created_at: new Date().toISOString()
        },
        {
          tenantId,
          name: 'Dr. Alice Namono',
          licenseNumber: 'NDA/P/7742',
          facility: 'Lubaga Hospital',
          isEnrolledInRewardProgram: false,
          isKOL: false,
          keyOpinionLeaderCategory: 'Doctor',
          contactDetails: 'namono.alice@lubagahosp.org',
          associatedInstitution: 'Lubaga Hospital',
          monthlyPrescriptions: 45,
          created_at: new Date().toISOString()
        }
      ];

      for (const p of testPrescribers) {
        const ref = await addDoc(collection(db, 'prescribers'), p);
        prescriberIds.push(ref.id);
      }
    } else {
      prescriberIds = prescribersSnap.docs.map(d => d.id);
    }

    // Seed Institutions
    const instQuery = query(collection(db, 'institutions'), where('tenantId', '==', tenantId));
    const instSnap = await getDocs(instQuery);
    if (instSnap.empty) {
      console.log(`Seeding institutions for tenant ${tenantId}...`);
      const testInstitutions = [
        {
          tenantId,
          name: 'NSSF Uganda',
          type: 'corporate',
          contactPerson: 'Richard Byarugaba',
          phone: '+256 414 331221',
          email: 'info@nssfug.org',
          tin: '1000284812',
          whtExempt: true,
          discountRate: 5,
          creditLimit: 120000000,
          balance: 45000000,
          created_at: new Date().toISOString()
        },
        {
          tenantId,
          name: 'UAP Insurance',
          type: 'insurance',
          contactPerson: 'Dorothy Kabagambe',
          phone: '+256 414 332300',
          email: 'info@uap-oldmutual.com',
          tin: '1000392942',
          whtExempt: false,
          discountRate: 8,
          creditLimit: 80000000,
          balance: 22000000,
          created_at: new Date().toISOString()
        },
        {
          tenantId,
          name: 'Jubilee Health',
          type: 'insurance',
          contactPerson: 'Patrick Tumbo',
          phone: '+256 414 236030',
          email: 'info@jubileeuganda.com',
          tin: '1000184821',
          whtExempt: true,
          discountRate: 10,
          creditLimit: 150000000,
          balance: 12000000,
          created_at: new Date().toISOString()
        },
        {
          tenantId,
          name: 'Sanlam Life',
          type: 'insurance',
          contactPerson: 'Gary Corbit',
          phone: '+256 414 340450',
          email: 'info@sanlam.co.ug',
          tin: '1000921822',
          whtExempt: false,
          discountRate: 7,
          creditLimit: 50000000,
          balance: 8500000,
          created_at: new Date().toISOString()
        }
      ];

      for (const inst of testInstitutions) {
        await addDoc(collection(db, 'institutions'), inst);
      }
    }

    // Seed Sales for deep CRM and sales analytics correlation
    const salesQuery = query(collection(db, 'sales'), where('tenantId', '==', tenantId));
    const salesSnap = await getDocs(salesQuery);
    if (salesSnap.empty) {
      console.log(`Seeding sales records for tenant ${tenantId}...`);
      
      const testSales = [
        {
          tenantId,
          branchId: 'main',
          subtotal: 12500000,
          tax: 0,
          taxAmount: 0,
          discountAmount: 0,
          discountPercentage: 0,
          total: 12500000,
          totalAmount: 12500000,
          paymentMethod: 'insurance',
          timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
          status: 'completed',
          receiptNumber: 'REC-9921',
          patientName: 'John Mukasa',
          patientId: clientIds[0] || 'mock-c1',
          prescriberName: 'Dr. Sarah Nabatanzi',
          prescriberId: prescriberIds[0] || 'mock-p1',
          items: [
            { id: 'prod-hypertension-1', name: 'Telmisartan 40mg', quantity: 3, price: 150000, total: 450000 }
          ]
        },
        {
          tenantId,
          branchId: 'main',
          subtotal: 8400000,
          tax: 0,
          taxAmount: 0,
          discountAmount: 0,
          discountPercentage: 0,
          total: 8400000,
          totalAmount: 8400000,
          paymentMethod: 'insurance',
          timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
          status: 'completed',
          receiptNumber: 'REC-9922',
          patientName: 'Jane Namuli',
          patientId: clientIds[1] || 'mock-c2',
          prescriberName: 'Dr. James Okello',
          prescriberId: prescriberIds[1] || 'mock-p2',
          items: [
            { id: 'prod-diabetes-1', name: 'Metformin 500mg', quantity: 4, price: 80000, total: 320000 }
          ]
        },
        {
          tenantId,
          branchId: 'main',
          subtotal: 7200000,
          tax: 0,
          taxAmount: 0,
          discountAmount: 0,
          discountPercentage: 0,
          total: 7200000,
          totalAmount: 7200000,
          paymentMethod: 'cash',
          timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
          status: 'completed',
          receiptNumber: 'REC-9923',
          patientName: 'Peter Semanda',
          patientId: clientIds[2] || 'mock-c3',
          prescriberName: 'Dr. Mary Atwine',
          prescriberId: prescriberIds[2] || 'mock-p3',
          items: [
            { id: 'prod-asthma-1', name: 'Salbutamol Inhaler', quantity: 1, price: 45000, total: 45000 }
          ]
        },
        {
          tenantId,
          branchId: 'main',
          subtotal: 5100000,
          tax: 0,
          taxAmount: 0,
          discountAmount: 0,
          discountPercentage: 0,
          total: 5100000,
          totalAmount: 5100000,
          paymentMethod: 'cash',
          timestamp: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
          status: 'completed',
          receiptNumber: 'REC-9924',
          patientName: 'Sarah Alupo',
          patientId: clientIds[3] || 'mock-c4',
          prescriberName: 'Dr. Robert Kato',
          prescriberId: prescriberIds[3] || 'mock-p4',
          items: [
            { id: 'prod-hypertension-2', name: 'Amlodipine 5mg', quantity: 2, price: 90000, total: 180000 }
          ]
        },
        {
          tenantId,
          branchId: 'main',
          subtotal: 3800000,
          tax: 0,
          taxAmount: 0,
          discountAmount: 0,
          discountPercentage: 0,
          total: 3800000,
          totalAmount: 3800000,
          paymentMethod: 'mobile_money',
          timestamp: new Date(Date.now() - 22 * 24 * 60 * 60 * 1000).toISOString(),
          status: 'completed',
          receiptNumber: 'REC-9925',
          patientName: 'David Okot',
          patientId: clientIds[4] || 'mock-c5',
          prescriberName: 'Dr. Alice Namono',
          prescriberId: prescriberIds[4] || 'mock-p5',
          items: [
            { id: 'prod-diabetes-2', name: 'Insulin Glargine', quantity: 1, price: 250000, total: 250000 }
          ]
        },
        // Duplicate client transactions to create a realistic retention rate!
        {
          tenantId,
          branchId: 'main',
          subtotal: 150000,
          tax: 0,
          taxAmount: 0,
          discountAmount: 0,
          discountPercentage: 0,
          total: 150000,
          totalAmount: 150000,
          paymentMethod: 'cash',
          timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
          status: 'completed',
          receiptNumber: 'REC-9926',
          patientName: 'John Mukasa',
          patientId: clientIds[0] || 'mock-c1',
          prescriberName: 'Dr. Sarah Nabatanzi',
          prescriberId: prescriberIds[0] || 'mock-p1',
          items: [
            { id: 'prod-supplements-1', name: 'Multivitamins Forte', quantity: 1, price: 50000, total: 50000 }
          ]
        },
        {
          tenantId,
          branchId: 'main',
          subtotal: 320000,
          tax: 0,
          taxAmount: 0,
          discountAmount: 0,
          discountPercentage: 0,
          total: 320000,
          totalAmount: 320000,
          paymentMethod: 'cash',
          timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          status: 'completed',
          receiptNumber: 'REC-9927',
          patientName: 'Jane Namuli',
          patientId: clientIds[1] || 'mock-c2',
          prescriberName: 'Dr. James Okello',
          prescriberId: prescriberIds[1] || 'mock-p2',
          items: [
            { id: 'prod-supplements-2', name: 'Omega 3 Fish Oil', quantity: 2, price: 60000, total: 120000 }
          ]
        }
      ];

      for (const s of testSales) {
        await addDoc(collection(db, 'sales'), s);
      }
    }

    console.log(`Dynamic seeding check completed for tenant ${tenantId}`);
  } catch (err) {
    console.warn(`Dynamic seeding failed for tenant ${tenantId}:`, err);
  }
}

