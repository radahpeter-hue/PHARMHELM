import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0911422817';
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75';
const TARGET_BRANCH_ID = process.env.TARGET_BRANCH_ID || '1agW2eYBOGGqKR9w2V31';

const app = getApps()[0] || initializeApp({ projectId: PROJECT_ID });
const auth = getAuth(app);
const db = DATABASE_ID && DATABASE_ID !== '(default)'
  ? getFirestore(app, DATABASE_ID)
  : getFirestore(app);

db.settings({ ignoreUndefinedProperties: true });

const normalize = value => String(value || '').trim().toLowerCase();
const normalizeEmail = value => normalize(value);
const asArray = value => Array.isArray(value) ? value : [];
const hasBranch = (data, branchId) =>
  asArray(data?.assigned_branches).includes(branchId)
  || data?.branch_id === branchId
  || data?.default_branch_id === branchId;
const hasDispenserRole = data =>
  normalize(data?.role) === 'dispenser'
  || asArray(data?.secondaryRoles).some(role => normalize(role) === 'dispenser');

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

console.log(`[phase3-dispenser-authority] project=${PROJECT_ID} database=${DATABASE_ID} branch=${TARGET_BRANCH_ID}`);

const branchSnap = await db.collection('branches').doc(TARGET_BRANCH_ID).get();
if (!branchSnap.exists) {
  throw new Error(`Target branch ${TARGET_BRANCH_ID} does not exist in ${DATABASE_ID}.`);
}

const branch = branchSnap.data();
const tenantId = branch?.tenantId;
if (!tenantId) throw new Error(`Target branch ${TARGET_BRANCH_ID} has no tenantId.`);

console.log(JSON.stringify({
  branchId: TARGET_BRANCH_ID,
  branchName: branch?.name || null,
  branchCode: branch?.branch_code || null,
  tenantId
}, null, 2));

const [users, staffSnap] = await Promise.all([
  listAllAuthUsers(),
  db.collection('staff').where('tenantId', '==', tenantId).get()
]);

const authByUid = new Map(users.map(user => [user.uid, user]));
const authByEmail = new Map(users
  .filter(user => user.email)
  .map(user => [normalizeEmail(user.email), user]));

const staffRows = staffSnap.docs.map(doc => ({ id: doc.id, data: doc.data() }));
const dispenserRows = staffRows.filter(row => hasDispenserRole(row.data));

console.log(`[phase3-dispenser-authority] tenantStaff=${staffRows.length} dispenserRows=${dispenserRows.length}`);

const findings = [];
for (const row of dispenserRows) {
  const email = normalizeEmail(row.data.authEmail || row.data.email);
  const authUser = authByUid.get(row.id) || (email ? authByEmail.get(email) : undefined);
  const uid = authUser?.uid || row.data.uid || null;
  const isUidKeyed = Boolean(authUser && authUser.uid === row.id);
  findings.push({
    staffDocumentId: row.id,
    authUid: uid,
    isUidKeyed,
    role: row.data.role || null,
    secondaryRoles: asArray(row.data.secondaryRoles),
    status: row.data.status || null,
    active: row.data.active === true,
    assignedBranches: asArray(row.data.assigned_branches),
    branchId: row.data.branch_id || null,
    defaultBranchId: row.data.default_branch_id || null,
    targetBranchGranted: hasBranch(row.data, TARGET_BRANCH_ID),
    legacyMigratedTo: row.data.uidMigratedTo || null,
    legacyStaffId: row.data.legacyStaffId || null
  });
}

console.log(JSON.stringify(findings, null, 2));

const byAuthUid = new Map();
for (const finding of findings) {
  if (!finding.authUid) continue;
  const rows = byAuthUid.get(finding.authUid) || [];
  rows.push(finding);
  byAuthUid.set(finding.authUid, rows);
}

const anomalies = [];
for (const [uid, rows] of byAuthUid.entries()) {
  const authoritative = rows.find(row => row.staffDocumentId === uid);
  const legacyRows = rows.filter(row => row.staffDocumentId !== uid);
  if (!authoritative) {
    anomalies.push({ uid, type: 'MISSING_UID_AUTHORITY', legacyRows: legacyRows.map(row => row.staffDocumentId) });
    continue;
  }
  if (!authoritative.targetBranchGranted) {
    const legacyWithBranch = legacyRows.filter(row => row.targetBranchGranted);
    anomalies.push({
      uid,
      type: legacyWithBranch.length > 0 ? 'UID_BRANCH_STALE_VS_LEGACY' : 'UID_NOT_ASSIGNED_TO_TARGET_BRANCH',
      authoritativeDocument: authoritative.staffDocumentId,
      legacyRowsWithTargetBranch: legacyWithBranch.map(row => row.staffDocumentId)
    });
  }
  if (normalize(authoritative.role) !== 'dispenser'
      && !authoritative.secondaryRoles.some(role => normalize(role) === 'dispenser')) {
    anomalies.push({ uid, type: 'UID_ROLE_NOT_DISPENSER', authoritativeRole: authoritative.role });
  }
}

console.log('[phase3-dispenser-authority] anomalies');
console.log(JSON.stringify(anomalies, null, 2));

if (dispenserRows.length === 0) {
  console.log('[phase3-dispenser-authority] No dispenser staff rows were found for the target tenant.');
}

console.log('[phase3-dispenser-authority] DRY RUN ONLY. No Firestore or Auth records were modified.');
