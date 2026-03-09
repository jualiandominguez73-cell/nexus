import { db } from './memory.js';

export interface Contact {
    name: string;
    phone: string;
    createdAt: number;
}

export const contactsDb = {
    async saveContact(telegramChatId: number | string, name: string, phone: string): Promise<void> {
        const ref = db.collection('users').doc(telegramChatId.toString()).collection('contacts').doc(name.toLowerCase());
        await ref.set({
            name,
            phone,
            createdAt: Date.now()
        }, { merge: true });
    },

    async getContactByName(telegramChatId: number | string, name: string): Promise<Contact | null> {
        const ref = db.collection('users').doc(telegramChatId.toString()).collection('contacts').doc(name.toLowerCase());
        const doc = await ref.get();
        if (!doc.exists) return null;
        return doc.data() as Contact;
    },

    async getAllContacts(telegramChatId: number | string): Promise<Contact[]> {
        const ref = db.collection('users').doc(telegramChatId.toString()).collection('contacts');
        const snapshot = await ref.get();
        return snapshot.docs.map(doc => doc.data() as Contact);
    }
};
