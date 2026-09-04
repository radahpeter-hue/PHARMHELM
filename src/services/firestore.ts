import { 
  collection, 
  collectionGroup,
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  onSnapshot, 
  query, 
  where,
  getDoc,
  getDocs,
  serverTimestamp,
  runTransaction,
  QueryConstraint
} from 'firebase/firestore';
import { db } from '../firebase';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const deepClean = (obj: any): any => {
  if (obj === null || obj === undefined) {
    return null;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => deepClean(item));
  }
  if (typeof obj === 'object') {
    // Firestore Timestamps, FieldValues and Dates are class instances. Recursing
    // into them turns them into plain objects and can make an otherwise valid
    // write fail after an existing document has been loaded into a form.
    const prototype = Object.getPrototypeOf(obj);
    if (prototype !== Object.prototype && prototype !== null) {
      return obj;
    }
    const cleaned: any = {};
    for (const [key, val] of Object.entries(obj)) {
      if (val !== undefined) {
        cleaned[key] = deepClean(val);
      }
    }
    return cleaned;
  }
  return obj;
};

export const firestoreService = {
  subscribeToCollection: <T>(path: string, tenantId: string, callback: (data: T[]) => void) => {
    const q = query(collection(db, path), where('tenantId', '==', tenantId));
    return onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...(doc.data() as any), id: doc.id } as T));
      callback(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });
  },

  subscribeToCollectionByQuery: <T>(path: string, tenantId: string, constraints: QueryConstraint[], callback: (data: T[]) => void) => {
    const colRef = collection(db, path);
    const q = query(colRef, where('tenantId', '==', tenantId), ...constraints);
    return onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...(doc.data() as any), id: doc.id } as T));
      callback(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });
  },

  addDocument: async (path: string, data: any) => {
    try {
      const cleanData = deepClean(data);
      const docRef = await addDoc(collection(db, path), {
        ...cleanData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      return docRef.id;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  updateDocument: async (path: string, id: string, data: any) => {
    try {
      const cleanData = deepClean(data);
      const docRef = doc(db, path, id);
      return await updateDoc(docRef, {
        ...cleanData,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `${path}/${id}`);
    }
  },

  getDocument: async <T>(path: string, id: string) => {
    try {
      const docRef = doc(db, path, id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return { ...(docSnap.data() as any), id: docSnap.id } as T;
      }
      return null;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `${path}/${id}`);
    }
  },

  deleteDocument: async (path: string, id: string) => {
    try {
      const docRef = doc(db, path, id);
      return await deleteDoc(docRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `${path}/${id}`);
    }
  },

  getCollection: async <T>(path: string, tenantId?: string) => {
    try {
      const colRef = collection(db, path);
      const q = tenantId ? query(colRef, where('tenantId', '==', tenantId)) : colRef;
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ ...(doc.data() as any), id: doc.id } as T));
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
      return [];
    }
  },

  getCollectionGroup: async <T>(collectionId: string, tenantId?: string, branchId?: string) => {
    try {
      const colRef = collectionGroup(db, collectionId);
      const constraints: QueryConstraint[] = [];
      if (tenantId) constraints.push(where('tenantId', '==', tenantId));
      if (branchId) constraints.push(where('branchId', '==', branchId));
      
      const q = constraints.length > 0 ? query(colRef, ...constraints) : colRef;
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ ...(doc.data() as any), id: doc.id } as T));
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, collectionId);
      return [];
    }
  },

  subscribeToCollectionGroup: <T>(collectionId: string, tenantId: string, branchId: string, callback: (data: T[]) => void) => {
    const colRef = collectionGroup(db, collectionId);
    const q = query(
      colRef, 
      where('tenantId', '==', tenantId),
      where('branchId', '==', branchId)
    );
    return onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...(doc.data() as any), id: doc.id } as T));
      callback(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, collectionId);
    });
  },

  getDocumentsByQuery: async <T>(path: string, constraints: { field: string; operator: any; value: any }[]) => {
    try {
      const colRef = collection(db, path);
      const queryConstraints = constraints.map(c => where(c.field, c.operator, c.value));
      const q = query(colRef, ...queryConstraints);
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ ...(doc.data() as any), id: doc.id } as T));
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
      return [];
    }
  },

  getDocumentsByField: async <T>(path: string, field: string, value: any) => {
    try {
      const colRef = collection(db, path);
      const q = query(colRef, where(field, '==', value));
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ ...(doc.data() as any), id: doc.id } as T));
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
      return [];
    }
  },

  runTransaction: async <T>(updateFunction: (transaction: any) => Promise<T>, operationPath = 'transaction') => {
    try {
      return await runTransaction(db, updateFunction);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, operationPath);
    }
  }
};
