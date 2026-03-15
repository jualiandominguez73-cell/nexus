import { adminDb as db, FieldValue } from './firebase.js';

export interface ScheduledTask {
    id?: string;
    type: 'make_call';
    scheduledTime: Date;
    payload: any;
    status: 'pending' | 'completed' | 'failed';
    createdAt: Date;
}

export const queueDb = {
    getQueueRef(tenantId: string = 'default') {
        if (tenantId === 'default') return db.collection('scheduled_tasks');
        return db.collection('tenants').doc(tenantId).collection('scheduled_tasks');
    },

    async addTask(task: Omit<ScheduledTask, 'id' | 'createdAt' | 'status'>, tenantId: string = 'default') {
        const ref = this.getQueueRef(tenantId);
        const doc = await ref.add({
            ...task,
            status: 'pending',
            createdAt: FieldValue.serverTimestamp()
        });
        return doc.id;
    },

    async getPendingTasks(tenantId: string = 'default'): Promise<ScheduledTask[]> {
        const now = new Date();
        const ref = this.getQueueRef(tenantId);
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

    async markTaskComplete(taskId: string, status: 'completed' | 'failed' = 'completed', tenantId: string = 'default') {
        const ref = this.getQueueRef(tenantId).doc(taskId);
        await ref.update({
            status,
            updatedAt: FieldValue.serverTimestamp()
        });
    }
};
