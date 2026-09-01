import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';

/**
 * Upload a file directly to the Cloud Object Storage bucket (Firebase Storage).
 * Prevents bloating the main Firestore document database with large Base64 binary strings.
 */
export async function uploadFileToObjectStorage(file: File, folder: string = 'logos'): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please select a supported image file.');
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error('Logo files must be 2 MB or smaller.');
  }
  const fileExtension = file.name.split('.').pop() || 'png';
  const uniqueName = `${folder}/${Date.now()}-${Math.random().toString(36).slice(-6)}.${fileExtension}`;

  const storageRef = ref(storage, uniqueName);
  const snapshot = await uploadBytes(storageRef, file, { contentType: file.type });
  return getDownloadURL(snapshot.ref);
}
