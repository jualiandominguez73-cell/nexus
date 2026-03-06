import { initializeApp, cert, getApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { env } from '../config/env.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Load service account
const serviceAccountPath = join(process.cwd(), env.FIREBASE_SERVICE_ACCOUNT_PATH);
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

// Initialize Firebase
const app = getApps().length === 0
  ? initializeApp({ credential: cert(serviceAccount) })
  : getApp();

const db = getFirestore(app);

export const memoryDb = {
  async createThread(threadId: string, userId: number) {
    const threadRef = db.collection('threads').doc(threadId);
    await threadRef.set({
      user_id: userId,
      updated_at: FieldValue.serverTimestamp()
    }, { merge: true });
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
    await threadRef.update({
      updated_at: FieldValue.serverTimestamp()
    });
  },

  async getMessages(threadId: string): Promise<any[]> {
    const messagesRef = db.collection('threads').doc(threadId).collection('messages');
    const snapshot = await messagesRef.orderBy('created_at', 'asc').get();

    return snapshot.docs.map(doc => {
      const data = doc.data();
      // Remove internal firestore timestamp before returning to agent
      const { created_at, ...message } = data;
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
