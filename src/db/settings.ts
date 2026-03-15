import { adminDb as db } from './firebase.js';
import { env } from '../config/env.js';

export interface VoiceSettings {
    voiceEngine: 'twilio_basic' | 'twilio_neural' | 'openai' | 'elevenlabs';
}

const DEFAULT_SETTINGS: VoiceSettings = {
    voiceEngine: 'twilio_basic'
};

export const settingsDb = {
    async getSettings(tenantId: string = 'default'): Promise<VoiceSettings> {
        const ref = tenantId === 'default'
            ? db.collection('system').doc('voice_settings')
            : db.collection('tenants').doc(tenantId).collection('config').doc('voice_settings');
        const doc = await ref.get();
        if (!doc.exists) {
            return DEFAULT_SETTINGS;
        }
        return { ...DEFAULT_SETTINGS, ...doc.data() };
    },

    async saveSettings(settings: Partial<VoiceSettings>, tenantId: string = 'default'): Promise<void> {
        const ref = tenantId === 'default'
            ? db.collection('system').doc('voice_settings')
            : db.collection('tenants').doc(tenantId).collection('config').doc('voice_settings');
        await ref.set(settings, { merge: true });
    }
};
