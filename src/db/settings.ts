import { db } from './memory.js';
import { env } from '../config/env.js';

export interface VoiceSettings {
    voiceEngine: 'twilio_basic' | 'twilio_neural' | 'openai' | 'elevenlabs';
}

const DEFAULT_SETTINGS: VoiceSettings = {
    voiceEngine: 'twilio_basic'
};

export const settingsDb = {
    async getSettings(): Promise<VoiceSettings> {
        const ref = db.collection('system').doc('voice_settings');
        const doc = await ref.get();
        if (!doc.exists) {
            return DEFAULT_SETTINGS;
        }
        return { ...DEFAULT_SETTINGS, ...doc.data() };
    },

    async saveSettings(settings: Partial<VoiceSettings>): Promise<void> {
        const ref = db.collection('system').doc('voice_settings');
        await ref.set(settings, { merge: true });
    }
};
