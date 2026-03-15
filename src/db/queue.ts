import { adminDb as db, FieldValue } from './firebase.js';

export interface ScheduledTask {
    id?: string;
    type: 'make_call';
    scheduledTime: Date;
    payload: any;
    status: 'pending' | 'completed' | 'failed';
    createdAt: Date;
    tenantId?: string; // Automatically populated when querying across tenants
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
                scheduledTime: data.scheduledTime?.toDate ? data.scheduledTime.toDate() : new Date(data.scheduledTime),
                tenantId
            } as ScheduledTask;
        });
    },

    async getAllPendingTasksAcrossTenants(): Promise<ScheduledTask[]> {
        const now = new Date();
        const snapshot = await db.collectionGroup('scheduled_tasks')
            .where('status', '==', 'pending')
            .where('scheduledTime', '<=', now)
            .get();

        return snapshot.docs.map(doc => {
            const data = doc.data();
            // Parse tenantId backwards from the path if possible, or assume it's stored in data
            // Path structure for tenants: tenants/{tenantId}/scheduled_tasks/{taskId}
            // Path structure for default: scheduled_tasks/{taskId}
            let tenantId = 'default';
            if (doc.ref.parent.parent && doc.ref.parent.parent.id !== 'tenants') {
                tenantId = doc.ref.parent.parent.id;
            }

            return {
                id: doc.id,
                ...data,
                scheduledTime: data.scheduledTime?.toDate ? data.scheduledTime.toDate() : new Date(data.scheduledTime),
                tenantId
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
