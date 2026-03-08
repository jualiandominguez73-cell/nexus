import { initializeApp, cert, getApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { env } from '../config/env.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Load service account (Try from JSON string first, then from file)
let serviceAccount: any;

if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  try {
    serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    console.log('Firebase initialized using FIREBASE_SERVICE_ACCOUNT_JSON environment variable.');
  } catch (err) {
    console.error('Error parsing FIREBASE_SERVICE_ACCOUNT_JSON:', err);
    throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON format');
  }
} else {
  const serviceAccountPath = join(process.cwd(), env.FIREBASE_SERVICE_ACCOUNT_PATH);
  console.log(`Loading Firebase from file: ${serviceAccountPath}`);
  serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
}

// Initialize Firebase
const app = getApps().length === 0
  ? initializeApp({ credential: cert(serviceAccount) })
  : getApp();

export const db = getFirestore(app);

export const memoryDb = {
  async createThread(threadId: string, userId: number) {
    const threadRef = db.collection('threads').doc(threadId);
    try {
      await threadRef.update({
        user_id: userId,
        updated_at: FieldValue.serverTimestamp()
      });
    } catch (err: any) {
      if (err.code === 5) { // NOT_FOUND
        await threadRef.set({
          user_id: userId,
          updated_at: FieldValue.serverTimestamp()
        });
      } else {
        throw err;
      }
    }
  },

  async addMessage(threadId: string, messageParam: any) {
    const threadRef = db.collection('threads').doc(threadId);
    const messagesRef = threadRef.collection('messages');

    // Add message
    await messagesRef.add({
      ...messageParam,
      created_at: FieldValue.serverTimestamp()
    });

    // Update thread timestamp
    try {
      await threadRef.update({
        updated_at: FieldValue.serverTimestamp()
      });
    } catch (err: any) {
      if (err.code === 5) { // NOT_FOUND
        await threadRef.set({
          updated_at: FieldValue.serverTimestamp()
        });
      } else {
        throw err;
      }
    }
  },

  async getMessages(threadId: string): Promise<any[]> {
    const messagesRef = db.collection('threads').doc(threadId).collection('messages');
    const snapshot = await messagesRef.orderBy('created_at', 'asc').get();

    return snapshot.docs.map(doc => {
      const data = doc.data();
      // Remove internal firestore timestamp and unsupported LLM fields before returning to agent
      const { created_at, reasoning_details, ...message } = data;
      return message;
    });
  },

  async clearHistory(threadId: string) {
    const messagesRef = db.collection('threads').doc(threadId).collection('messages');
    const snapshot = await messagesRef.get();

    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();
  }
};
