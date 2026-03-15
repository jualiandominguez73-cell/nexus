import Groq from 'groq-sdk';
import { env } from '../config/env.js';
import gtts from 'node-gtts';
import axios from 'axios';
import { createReadStream, createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { tenantDb } from '../db/tenant.js';

const googleTts = gtts('es'); // 'es' for Spanish

export async function transcribeAudio(fileUrl: string, tenantId: string = 'default'): Promise<string> {
    const tempFilePath = join(tmpdir(), `voice_${Date.now()}.ogg`);

    try {
        // Download file from Telegram
        console.log(`[STT] Downloading voice file...`);
        const response = await axios({
            method: 'GET',
            url: fileUrl,
            responseType: 'stream'
        });

        const writer = createWriteStream(tempFilePath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(undefined));
            writer.on('error', reject);
        });

        return await transcribeFile(tempFilePath, tenantId);
    } finally {
        // Cleanup
        try { await unlink(tempFilePath); } catch (e) { }
    }
}

export async function transcribeFile(filePath: string, tenantId: string = 'default'): Promise<string> {
    const tenant = await tenantDb.getTenant(tenantId);
    const groqApiKey = tenant?.groqApiKey || env.GROQ_API_KEY;
    const groq = new Groq({ apiKey: groqApiKey });

    console.log(`[STT] Sending to Groq Whisper: ${filePath} (Tenant: ${tenantId})`);
    const transcription = await groq.audio.transcriptions.create({
        file: createReadStream(filePath),
        model: 'whisper-large-v3',
        response_format: 'verbose_json',
    });
    console.log(`[STT] Transcription successful.`);
    return transcription.text;
}

import { VoiceSettings } from '../db/settings.js';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';

export async function generateVoice(text: string): Promise<string> {
    // Keep backwards compatibility for local Telegram TTS (node-gtts for simplicity if needed)
    const outputPath = join(tmpdir(), `response_${Date.now()}.mp3`);
    return new Promise((resolve, reject) => {
        googleTts.save(outputPath, text, (err: any) => {
            if (err) return reject(err);
            resolve(outputPath);
        });
    });
}

// Ensure public audio dir exists
const AUDIO_DIR = join(process.cwd(), 'public', 'audio');
if (!existsSync(AUDIO_DIR)) mkdirSync(AUDIO_DIR, { recursive: true });

export async function getDynamicVoiceTwiML(text: string, settings: VoiceSettings, baseUrl: string, tenantId: string = 'default'): Promise<{ action: 'say' | 'play', content: string, twilioVoiceId?: string }> {
    const engine = settings.voiceEngine;
    const tenant = await tenantDb.getTenant(tenantId);

    // Twilio Native
    if (engine === 'twilio_basic') {
        return { action: 'say', content: text, twilioVoiceId: 'alice' };
    }
    if (engine === 'twilio_neural') {
        return { action: 'say', content: text, twilioVoiceId: 'Google.es-US-Neural2-A' };
    }

    try {
        const fileName = `tts_${Date.now()}.mp3`;
        const localPath = join(AUDIO_DIR, fileName);
        const publicUrl = `${baseUrl}/audio/${fileName}`;

        // OpenAI TTS
        const openAiKey = tenant?.openAiApiKey || env.OPENAI_API_KEY;
        if (engine === 'openai' && openAiKey) {
            console.log(`[TTS] Generating voice via OpenAI (Tenant: ${tenantId})...`);
            const res = await axios.post('https://api.openai.com/v1/audio/speech', {
                model: 'tts-1',
                input: text,
                voice: 'nova', // Good neutral voice
            }, {
                headers: { 'Authorization': `Bearer ${openAiKey}` },
                responseType: 'arraybuffer',
                timeout: 10000
            });
            writeFileSync(localPath, Buffer.from(res.data));
            return { action: 'play', content: publicUrl };
        }

        // ElevenLabs TTS
        const elevenLabsKey = tenant?.elevenLabsApiKey || env.ELEVENLABS_API_KEY;
        if (engine === 'elevenlabs' && elevenLabsKey) {
            console.log(`[TTS] Generating voice via ElevenLabs (Tenant: ${tenantId})...`);
            const voiceId = 'EXAVITQu4vr4xnSDxMaL'; // Sarah - Mature, Reassuring, Confident
            const res = await axios.post(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
                text,
                model_id: 'eleven_multilingual_v2'
            }, {
                headers: { 'xi-api-key': elevenLabsKey },
                responseType: 'arraybuffer',
                timeout: 15000
            });
            writeFileSync(localPath, Buffer.from(res.data));
            return { action: 'play', content: publicUrl };
        }

    } catch (err: any) {
        console.error(`[TTS Engine Error] fallback to Alice:`, err.message);
    }

    // Fallback if API keys fail or aren't set
    return { action: 'say', content: text, twilioVoiceId: 'alice' };
}
