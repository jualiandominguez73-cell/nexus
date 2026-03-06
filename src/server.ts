import express from 'express';
import pkg from 'twilio';
const { twiml } = pkg;
const { VoiceResponse } = twiml;

import { env } from './config/env.js';
import { runAgentLoop } from './agent/loop.js';
import { transcribeFile, generateVoice } from './agent/voice.js';
import axios from 'axios';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { Buffer } from 'node:buffer';

const app = express();
app.use(express.urlencoded({ extended: false }));

// Global Logging
app.use((req, res, next) => {
    console.log(`[HTTP] ${req.method} ${req.url}`);
    next();
});

app.get('/', (req, res) => res.send('NEXUS Voice Server is LIVE 🚀'));

// Serve static audio
const audioDir = join(process.cwd(), 'public', 'audio');
if (!existsSync(audioDir)) mkdirSync(audioDir, { recursive: true });
app.use('/audio', express.static(audioDir));

// Webhook Aliases
app.all(['/voice', '/api/twilio', '/api/twilio/voice'], async (req, res) => {
    try {
        const response = new VoiceResponse();
        const from = req.body?.From || 'Unknown';
        console.log(`[Twilio] Call from ${from}`);

        response.say({ voice: 'alice', language: 'es-ES' }, 'Hola, soy NEXUS. ¿En qué puedo ayudarte? Te escucharé después del tono.');
        response.record({
            action: '/api/twilio/voice-process', // Use specific path to avoid ambiguity
            maxLength: 30,
            playBeep: true
        });

        res.type('text/xml');
        res.send(response.toString());
    } catch (err: any) {
        console.error('[Voice Entry Error]:', err);
        res.status(500).send(`Error: ${err.message}`);
    }
});

app.all(['/voice-process', '/api/twilio/voice-process'], async (req, res) => {
    try {
        const response = new VoiceResponse();
        if (req.method === 'GET') {
            response.say('Endpoint de proceso activo.');
            return res.type('text/xml').send(response.toString());
        }

        const recordingUrl = req.body.RecordingUrl;
        const userId = req.body.From;
        const threadId = `twilio_${userId}`;

        console.log(`[Twilio] Processing: ${recordingUrl}`);

        const tempFilePath = join(tmpdir(), `twilio_${Date.now()}.wav`);
        const audioRes = await axios({ method: 'GET', url: recordingUrl, responseType: 'arraybuffer' });
        writeFileSync(tempFilePath, Buffer.from(audioRes.data));

        const userText = await transcribeFile(tempFilePath);
        const aiResponse = await runAgentLoop(threadId, userText);
        const localAudioPath = await generateVoice(aiResponse);

        const publicAudioName = basename(localAudioPath);
        copyFileSync(localAudioPath, join(audioDir, publicAudioName));

        const myUrl = req.protocol + '://' + req.get('host');
        response.play(`${myUrl}/audio/${publicAudioName}`);

        response.record({
            action: '/api/twilio/voice-process',
            maxLength: 30,
            playBeep: true
        });

        res.type('text/xml');
        res.send(response.toString());
    } catch (err: any) {
        console.error('[Voice Process Error]:', err);
        const errorResponse = new VoiceResponse();
        errorResponse.say({ voice: 'alice', language: 'es-ES' }, 'Lo siento, hubo un error. Inténtalo más tarde.');
        res.type('text/xml').send(errorResponse.toString());
    }
});

export function startServer() {
    app.listen(env.PORT, () => console.log(`[Server] Running on ${env.PORT}`));
}
