import { adminDb } from './firebase.js';

export interface TenantConfig {
    id: string; // "default", or the subdomain like "clinica"
    name: string;

    // API Keys (Encrypted in a real app, plaintext here for demo transition)
    groqApiKey?: string;
    openRouterApiKey?: string;
    telegramBotToken?: string;
    twilioAccountSid?: string;
    twilioAuthToken?: string;
    twilioPhoneNumber?: string;
    twilioWhatsappNumber?: string;
    openAiApiKey?: string;
    elevenLabsApiKey?: string;

    // Agent custom preferences
    systemPromptMaster?: string;
}

/**
 * TenantDatabase logic manages multiple clients (SaaS).
 */
export class TenantDatabase {
    private collection = adminDb.collection('tenants');

    /**
     * Get tenant credentials and config by ID.
     */
    async getTenant(tenantId: string): Promise<TenantConfig | null> {
        const doc = await this.collection.doc(tenantId).get();
        if (!doc.exists) return null;
        return { id: doc.id, ...doc.data() } as TenantConfig;
    }

    /**
     * Create or update a tenant configuration.
     */
    async saveTenant(tenantId: string, config: Partial<TenantConfig>): Promise<void> {
        await this.collection.doc(tenantId).set(config, { merge: true });
    }

    /**
     * Finds a tenant based on an incoming Twilio phone number (To parameter)
     */
    async findTenantByPhoneNumber(phoneNumber: string): Promise<TenantConfig | null> {
        // Query both voice and whatsapp numbers
        const snap = await this.collection.where('twilioPhoneNumber', '==', phoneNumber).limit(1).get();
        if (!snap.empty) {
            return { id: snap.docs[0].id, ...snap.docs[0].data() } as TenantConfig;
        }

        const snap2 = await this.collection.where('twilioWhatsappNumber', '==', phoneNumber.replace('whatsapp:', '')).limit(1).get();
        if (!snap2.empty) {
            return { id: snap2.docs[0].id, ...snap2.docs[0].data() } as TenantConfig;
        }

        return null;
    }
}

export const tenantDb = new TenantDatabase();
