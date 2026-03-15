import { adminDb as db } from './firebase.js';

export interface Contact {
    name: string;
    phone: string;
    createdAt: number;
}

export const contactsDb = {
    getContactsRef(telegramChatId: number | string, tenantId: string = 'default') {
        if (tenantId === 'default') return db.collection('users').doc(telegramChatId.toString()).collection('contacts');
        return db.collection('tenants').doc(tenantId).collection('users').doc(telegramChatId.toString()).collection('contacts');
    },

    async saveContact(telegramChatId: number | string, name: string, phone: string, tenantId: string = 'default'): Promise<void> {
        const ref = this.getContactsRef(telegramChatId, tenantId).doc(name.toLowerCase());
        await ref.set({
            name,
            phone,
            createdAt: Date.now()
        }, { merge: true });
    },

    async getContactByName(telegramChatId: number | string, name: string, tenantId: string = 'default'): Promise<Contact | null> {
        const ref = this.getContactsRef(telegramChatId, tenantId).doc(name.toLowerCase());
        const doc = await ref.get();
        if (!doc.exists) return null;
        return doc.data() as Contact;
    },

    async getAllContacts(telegramChatId: number | string, tenantId: string = 'default'): Promise<Contact[]> {
        const ref = this.getContactsRef(telegramChatId, tenantId);
        const snapshot = await ref.get();
        return snapshot.docs.map(doc => doc.data() as Contact);
    }
};
