import express from 'express';
import twilio from 'twilio';
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

// Global Logging Middleware
app.use((req, res, next) => {
    console.log(`[HTTP] ${req.method} ${req.url} - ${new Date().toISOString()}`);
    next();
});

// Health Check
app.get('/', (req, res) => {
    res.send('NEXUS Voice Server is LIVE 🚀');
});

// Serve static audio files
const publicDir = join(process.cwd(), 'public');
const audioDir = join(publicDir, 'audio');
if (!existsSync(audioDir)) mkdirSync(audioDir, { recursive: true });
app.use('/audio', express.static(audioDir));

const VoiceResponse = twilio.twiml.VoiceResponse;

// 1. Initial Call Entry
app.post(['/voice', '/api/twilio'], (req, res) => {
    const twiml = new VoiceResponse();
    console.log(`[Twilio] Incoming call from ${req.body.From}`);

    twiml.say({ voice: 'alice', language: 'es-ES' }, 'Hola, soy NEXUS. ¿En qué puedo ayudarte hoy? Escucharé tu mensaje después del tono.');
    twiml.record({
        action: '/voice-process',
        maxLength: 30,
        playBeep: true
    });

    res.type('text/xml');
    res.send(twiml.toString());
});

// 2. Process Recording and Respond
app.post('/voice-process', async (req, res) => {
    const twiml = new VoiceResponse();
    const recordingUrl = req.body.RecordingUrl;
    const userId = req.body.From;
    const threadId = `twilio_${userId}`;

    try {
        console.log(`[Twilio] Processing recording from ${userId}: ${recordingUrl}`);

        const tempFilePath = join(tmpdir(), `twilio_${Date.now()}.wav`);
        const response = await axios({ method: 'GET', url: recordingUrl, responseType: 'arraybuffer' });
        writeFileSync(tempFilePath, Buffer.from(response.data));

        // STT
        const userText = await transcribeFile(tempFilePath);
        console.log(`[Twilio] User said: ${userText}`);

        // LLM
        const aiResponse = await runAgentLoop(threadId, userText);
        console.log(`[Twilio] AI Response: ${aiResponse}`);

        // TTS
        const localAudioPath = await generateVoice(aiResponse);

        // Move to public folder so it can be served
        const publicAudioName = basename(localAudioPath);
        const publicAudioPath = join(audioDir, publicAudioName);
        copyFileSync(localAudioPath, publicAudioPath);

        // TwiML Response
        const myUrl = req.protocol + '://' + req.get('host');
        twiml.play(`${myUrl}/audio/${publicAudioName}`);

        // Listen again
        twiml.record({
            action: '/voice-process',
            maxLength: 30,
            playBeep: true
        });

    } catch (error: any) {
        console.error('[Twilio Error]:', error);
        twiml.say({ voice: 'alice', language: 'es-ES' }, 'Lo siento, tuve un problema procesando tu mensaje. Por favor, inténtalo de nuevo.');
        twiml.hangup();
    }

    res.type('text/xml');
    res.send(twiml.toString());
});

export function startServer() {
    const port = env.PORT;
    app.listen(port, () => {
        console.log(`[Server] Voice server running on port ${port}`);
        console.log(`[Server] Webhook URL: /voice`);
    });
}
