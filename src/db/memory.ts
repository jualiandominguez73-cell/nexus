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

  async getMessages(threadId: string, limit = 30): Promise<any[]> {
    const messagesRef = db.collection('threads').doc(threadId).collection('messages');

    // Fetch only the last N messages (descending) then reverse to get chronological order.
    // This avoids loading the entire conversation history on every LLM call.
    const snapshot = await messagesRef.orderBy('created_at', 'desc').limit(limit).get();

    const messages = snapshot.docs
      .reverse() // Back to chronological order
      .map(doc => {
        const data = doc.data();
        const { created_at, reasoning_details, ...message } = data;
        return message;
      });

    // Safety: ensure we don't start with orphaned tool responses.
    // If the first message is role:"tool", it means we cut in the middle of a
    // tool-call sequence. Drop leading tool messages until we hit a non-tool message.
    while (messages.length > 0 && messages[0].role === 'tool') {
      messages.shift();
    }

    // Also drop a leading assistant message that has tool_calls but whose
    // tool results got trimmed above (the LLM would error on dangling tool_calls).
    if (
      messages.length > 0 &&
      messages[0].role === 'assistant' &&
      messages[0].tool_calls?.length > 0
    ) {
      messages.shift();
    }

    return messages;
  },

  async clearHistory(threadId: string) {
    // Clear the main thread
    await this._deleteMessages(threadId);

    // Clear all agent sub-threads (multi-agent mode)
    const agentNames = ['chat', 'comms', 'voice', 'scheduler', 'workspace'];
    for (const agent of agentNames) {
      await this._deleteMessages(`${threadId}_${agent}`);
    }
  },

  async _deleteMessages(threadId: string) {
    const messagesRef = db.collection('threads').doc(threadId).collection('messages');
    const snapshot = await messagesRef.get();
    if (snapshot.empty) return;

    // Firestore batch limit is 500 ops per batch
    const batchSize = 450;
    for (let i = 0; i < snapshot.docs.length; i += batchSize) {
      const batch = db.batch();
      snapshot.docs.slice(i, i + batchSize).forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();
    }
  }
};
