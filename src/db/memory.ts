import { adminDb as db, FieldValue } from './firebase.js';

export const memoryDb = {
  getThreadRef(threadId: string, tenantId: string) {
    if (tenantId === 'default') return db.collection('threads').doc(threadId);
    return db.collection('tenants').doc(tenantId).collection('threads').doc(threadId);
  },

  async createThread(threadId: string, userId: number, tenantId: string = 'default') {
    const threadRef = this.getThreadRef(threadId, tenantId);
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

  async addMessage(threadId: string, messageParam: any, tenantId: string = 'default') {
    const threadRef = this.getThreadRef(threadId, tenantId);
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

  async getMessages(threadId: string, limit = 30, tenantId: string = 'default'): Promise<any[]> {
    const messagesRef = this.getThreadRef(threadId, tenantId).collection('messages');

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

  async clearHistory(threadId: string, tenantId: string = 'default') {
    // Clear the main thread
    await this._deleteMessages(threadId, tenantId);

    // Clear all agent sub-threads (multi-agent mode)
    const agentNames = ['chat', 'comms', 'voice', 'scheduler', 'workspace'];
    for (const agent of agentNames) {
      await this._deleteMessages(`${threadId}_${agent}`, tenantId);
    }
  },

  async _deleteMessages(threadId: string, tenantId: string) {
    const messagesRef = this.getThreadRef(threadId, tenantId).collection('messages');
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
