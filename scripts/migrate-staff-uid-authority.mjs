import admin from 'firebase-admin';

const APPLY = process.argv.includes('--apply');
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0911422817';
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}

const auth = admin.auth();
const db = admin.firestore();
if (DATABASE_ID && DATABASE_ID !== '(default)') {
  db.settings({ databaseId: DATABASE_ID, ignoreUndefinedProperties: true });
} else {
  db.settings({ ignoreUndefinedProperties: true });
}

const normalizeEmail = value => String(value || '').trim().toLowerCase();
const stable = value => JSON.stringify(value ?? null);
const criticalSignature = data => stable({
  tenantId: data?.tenantId ?? null,
  role: data?.role ?? null,
  secondaryRoles: data?.secondaryRoles ?? [],
  roleRealmId: data?.roleRealmId ?? null,
  assigned_branches: data?.assigned_branches ?? [],
  branch_id: data?.branch_id ?? null,
  default_branch_id: data?.default_branch_id ?? null,
  status: data?.status ?? null,
  active: data?.active ?? null
});

async function listAllAuthUsers() {
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

const stats = {
  authUsers: 0,
  staffDocs: 0,
  alreadyAuthoritative: 0,
  migrated: 0,
  wouldMigrate: 0,
  noAuthMatch: 0,
  ambiguousLegacy: 0,
  targetConflict: 0,
  invalidLegacy: 0
};

console.log(`[staff-uid-migration] mode=${APPLY ? 'APPLY' : 'DRY_RUN'} project=${PROJECT_ID} database=${DATABASE_ID}`);

const [users, staffSnap] = await Promise.all([
  listAllAuthUsers(),
  db.collection('staff').get()
]);

stats.authUsers = users.length;
stats.staffDocs = staffSnap.size;

const authByEmail = new Map();
for (const user of users) {
  const email = normalizeEmail(user.email);
  if (email) authByEmail.set(email, user);
}

const docs = staffSnap.docs.map(doc => ({ id: doc.id, ref: doc.ref, data: doc.data() }));
const authoritativeIds = new Set(users.map(user => user.uid));

for (const row of docs) {
  if (authoritativeIds.has(row.id)) stats.alreadyAuthoritative += 1;
}

const candidatesByUid = new Map();
for (const row of docs) {
  if (authoritativeIds.has(row.id)) continue;
  const email = normalizeEmail(row.data.authEmail || row.data.email);
  if (!email) {
    stats.invalidLegacy += 1;
    console.log(`[skip invalid-email] legacy=${row.id}`);
    continue;
  }
  const authUser = authByEmail.get(email);
  if (!authUser) {
    stats.noAuthMatch += 1;
    console.log(`[skip no-auth-match] legacy=${row.id} email=${email}`);
    continue;
  }
  const rows = candidatesByUid.get(authUser.uid) || [];
  rows.push({ ...row, authUser, email });
  candidatesByUid.set(authUser.uid, rows);
}

for (const [uid, candidates] of candidatesByUid.entries()) {
  const targetRef = db.collection('staff').doc(uid);
  const targetSnap = await targetRef.get();

  if (targetSnap.exists) {
    const target = targetSnap.data();
    const sourceTenants = new Set(candidates.map(c => c.data.tenantId).filter(Boolean));
    if (sourceTenants.size > 0 && !sourceTenants.has(target?.tenantId)) {
      stats.targetConflict += 1;
      console.log(`[conflict target-tenant] uid=${uid} targetTenant=${target?.tenantId || ''} sourceTenants=${Array.from(sourceTenants).join(',')}`);
    } else {
      console.log(`[already linked] uid=${uid} email=${normalizeEmail(target?.authEmail || target?.email)}`);
    }
    continue;
  }

  const signatures = new Set(candidates.map(c => criticalSignature(c.data)));
  if (candidates.length > 1 && signatures.size > 1) {
    stats.ambiguousLegacy += 1;
    console.log(`[skip ambiguous] uid=${uid} email=${candidates[0].email} legacyDocs=${candidates.map(c => c.id).join(',')}`);
    continue;
  }

  const source = candidates.find(c => c.data.status === 'active' || c.data.active === true) || candidates[0];
  if (!source?.data?.tenantId || !source?.data?.role) {
    stats.invalidLegacy += 1;
    console.log(`[skip invalid-authority] legacy=${source?.id || ''} uid=${uid}`);
    continue;
  }

  const { password, ...safeSource } = source.data;
  const migrated = {
    ...safeSource,
    id: uid,
    uid,
    authEmail: normalizeEmail(source.authUser.email || source.data.authEmail || source.data.email),
    legacyStaffId: source.id,
    uidAuthorityMigratedAt: admin.firestore.FieldValue.serverTimestamp(),
    uidAuthorityMigrationVersion: 1
  };

  if (!APPLY) {
    stats.wouldMigrate += 1;
    console.log(`[would migrate] legacy=${source.id} -> uid=${uid} email=${source.email} tenant=${source.data.tenantId} role=${source.data.role}`);
    continue;
  }

  const batch = db.batch();
  batch.create(targetRef, migrated);
  for (const candidate of candidates) {
    batch.set(candidate.ref, {
      legacyStaffId: candidate.id,
      uidMigratedTo: uid,
      uidMigratedAt: admin.firestore.FieldValue.serverTimestamp(),
      uidAuthorityMigrationVersion: 1
    }, { merge: true });
  }
  await batch.commit();
  stats.migrated += 1;
  console.log(`[migrated] legacy=${source.id} -> uid=${uid} email=${source.email} tenant=${source.data.tenantId} role=${source.data.role}`);
}

console.log('[staff-uid-migration] summary');
console.log(JSON.stringify(stats, null, 2));

if (stats.targetConflict > 0 || stats.ambiguousLegacy > 0) {
  console.log('[staff-uid-migration] completed with conflicts requiring manual review; no conflicting authority was overwritten.');
}
