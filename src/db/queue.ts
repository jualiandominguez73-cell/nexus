import { db } from './memory.js';
import { FieldValue } from 'firebase-admin/firestore';

export interface ScheduledTask {
    id?: string;
    type: 'make_call';
    scheduledTime: Date;
    payload: any;
    status: 'pending' | 'completed' | 'failed';
    createdAt: Date;
}

export const queueDb = {
    async addTask(task: Omit<ScheduledTask, 'id' | 'createdAt' | 'status'>) {
        const ref = db.collection('scheduled_tasks');
        const doc = await ref.add({
            ...task,
            status: 'pending',
            createdAt: FieldValue.serverTimestamp()
        });
        return doc.id;
    },

    async getPendingTasks(): Promise<ScheduledTask[]> {
        const now = new Date();
        const ref = db.collection('scheduled_tasks');
        const snapshot = await ref
            .where('status', '==', 'pending')
            .where('scheduledTime', '<=', now)
            .get();

        return snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                scheduledTime: data.scheduledTime?.toDate ? data.scheduledTime.toDate() : new Date(data.scheduledTime)
            } as ScheduledTask;
        });
    },

    async markTaskComplete(taskId: string, status: 'completed' | 'failed' = 'completed') {
        const ref = db.collection('scheduled_tasks').doc(taskId);
        await ref.update({
            status,
            updatedAt: FieldValue.serverTimestamp()
        });
    }
};
