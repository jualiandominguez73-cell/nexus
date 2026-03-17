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
        const allTasks: ScheduledTask[] = [];

        // 1. Fetch from the 'default' legacy collection
        const defaultRef = db.collection('scheduled_tasks');
        const defaultSnap = await defaultRef
            .where('status', '==', 'pending')
            .where('scheduledTime', '<=', now)
            .get();

        defaultSnap.docs.forEach(doc => {
            const data = doc.data();
            allTasks.push({
                id: doc.id,
                ...data,
                scheduledTime: data.scheduledTime?.toDate ? data.scheduledTime.toDate() : new Date(data.scheduledTime),
                tenantId: 'default'
            } as ScheduledTask);
        });

        // 2. Fetch from all tenant subcollections by iterating tenants (to avoid Collection Group missing composite index)
        const tenantsSnap = await db.collection('tenants').get();
        for (const tenantDoc of tenantsSnap.docs) {
            const tenantId = tenantDoc.id;
            const tenantTasksRef = tenantDoc.ref.collection('scheduled_tasks');
            const tenantTasksSnap = await tenantTasksRef
                .where('status', '==', 'pending')
                .where('scheduledTime', '<=', now)
                .get();

            tenantTasksSnap.docs.forEach(taskDoc => {
                const data = taskDoc.data();
                allTasks.push({
                    id: taskDoc.id,
                    ...data,
                    scheduledTime: data.scheduledTime?.toDate ? data.scheduledTime.toDate() : new Date(data.scheduledTime),
                    tenantId: tenantId
                } as ScheduledTask);
            });
        }

        return allTasks;
    },

    async markTaskComplete(taskId: string, status: 'completed' | 'failed' = 'completed', tenantId: string = 'default') {
        const ref = this.getQueueRef(tenantId).doc(taskId);
        await ref.update({
            status,
            updatedAt: FieldValue.serverTimestamp()
        });
    }
};
