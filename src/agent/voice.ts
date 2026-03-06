import Groq from 'groq-sdk';
import { env } from '../config/env.js';
import gtts from 'node-gtts';
import axios from 'axios';
import { createReadStream, createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const groq = new Groq({ apiKey: env.GROQ_API_KEY });
const googleTts = gtts('es'); // 'es' for Spanish

export async function transcribeAudio(fileUrl: string): Promise<string> {
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

        return await transcribeFile(tempFilePath);
    } finally {
        // Cleanup
        try { await unlink(tempFilePath); } catch (e) { }
    }
}

export async function transcribeFile(filePath: string): Promise<string> {
    console.log(`[STT] Sending to Groq Whisper: ${filePath}`);
    const transcription = await groq.audio.transcriptions.create({
        file: createReadStream(filePath),
        model: 'whisper-large-v3',
        response_format: 'verbose_json',
    });
    console.log(`[STT] Transcription successful.`);
    return transcription.text;
}

export async function generateVoice(text: string): Promise<string> {
    // Railway sometimes has issues with persistent fs, so we use tmp
    const outputPath = join(tmpdir(), `response_${Date.now()}.mp3`);

    return new Promise((resolve, reject) => {
        googleTts.save(outputPath, text, (err: any) => {
            if (err) {
                console.error('TTS Error:', err);
                return reject(err);
            }
            resolve(outputPath);
        });
    });
}
