import { APPLY, documentsRoot, runQuery, commit } from './firebase-rest-utils.mjs';

const documents = await runQuery({ from: [{ collectionId: 'management_expenses' }] });
let excluded = 0;
let operating = 0;
let unchanged = 0;
const writes = [];

for (const document of documents) {
  const fields = document.fields || {};
  if (fields.excludeFromOpexRollup?.booleanValue !== undefined) {
    unchanged += 1;
    continue;
  }
  const source = (fields.source?.stringValue || '').toLowerCase();
  const sourceType = (fields.sourceType?.stringValue || '').toLowerCase();
  const isExcluded = source === 'cash_grn' || source === 'credit_payment' || sourceType === 'procurement' || sourceType === 'credit';
  if (isExcluded) excluded += 1;
  else operating += 1;
  writes.push({
    update: {
      name: document.name,
      fields: { excludeFromOpexRollup: { booleanValue: isExcluded } }
    },
    updateMask: { fieldPaths: ['excludeFromOpexRollup'] },
    currentDocument: { updateTime: document.updateTime }
  });
}

console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', total: documents.length, excluded, operating, unchanged }, null, 2));
if (APPLY) {
  for (let index = 0; index < writes.length; index += 400) await commit(writes.slice(index, index + 400));
  console.log(`Updated ${writes.length} management_expenses documents in ${documentsRoot}.`);
}
