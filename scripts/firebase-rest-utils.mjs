export const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0911422817';
export const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75';
export const ACCESS_TOKEN = process.env.GOOGLE_OAUTH_ACCESS_TOKEN || '';
export const APPLY = process.argv.includes('--apply');

if (!ACCESS_TOKEN) {
  throw new Error('Set GOOGLE_OAUTH_ACCESS_TOKEN to an authorised Google OAuth access token. No service-account key should be committed to this repository.');
}

export const documentsRoot = `projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;
export const firestoreBase = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

export async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

export async function runQuery(structuredQuery) {
  const rows = await api(`${firestoreBase}:runQuery`, {
    method: 'POST',
    body: JSON.stringify({ structuredQuery })
  });
  return rows.map(row => row.document).filter(Boolean);
}

export async function commit(writes) {
  return api(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents:commit`, {
    method: 'POST',
    body: JSON.stringify({ writes })
  });
}
