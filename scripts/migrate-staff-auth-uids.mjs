import { ACCESS_TOKEN, APPLY, PROJECT_ID, documentsRoot, runQuery, commit, api } from './firebase-rest-utils.mjs';

let nextPageToken;
const users = [];
do {
  const result = await api(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:query`, {
    method: 'POST',
    body: JSON.stringify({ returnUserInfo: true, maxResults: 500, ...(nextPageToken ? { nextPageToken } : {}) })
  });
  users.push(...(result.userInfo || []));
  nextPageToken = result.nextPageToken;
} while (nextPageToken);

let alreadyLinked = 0;
let migratable = 0;
let unmatched = 0;
let ambiguous = 0;

for (const user of users) {
  if (!user.localId || !user.email) continue;
  const canonicalName = `${documentsRoot}/staff/${user.localId}`;
  const matches = await runQuery({
    from: [{ collectionId: 'staff' }],
    where: { fieldFilter: { field: { fieldPath: 'authEmail' }, op: 'EQUAL', value: { stringValue: user.email.toLowerCase() } } },
    limit: 3
  });
  if (matches.some(document => document.name === canonicalName)) { alreadyLinked += 1; continue; }
  if (matches.length === 0) { unmatched += 1; continue; }
  if (matches.length !== 1) { ambiguous += 1; continue; }

  migratable += 1;
  if (!APPLY) continue;
  const legacy = matches[0];
  const fields = { ...(legacy.fields || {}) };
  delete fields.password;
  fields.id = { stringValue: user.localId };
  fields.uid = { stringValue: user.localId };
  fields.legacyStaffId = { stringValue: legacy.name.split('/').pop() };
  fields.authEmail = { stringValue: user.email.toLowerCase() };
  await commit([
    { update: { name: canonicalName, fields }, currentDocument: { exists: false } },
    { delete: legacy.name, currentDocument: { updateTime: legacy.updateTime } }
  ]);
}

console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', authUsers: users.length, alreadyLinked, migratable, unmatched, ambiguous }, null, 2));
