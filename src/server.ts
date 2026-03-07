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
        const userId = req.body.From || 'UnknownUser';
        const threadId = `twilio_${userId.replace(/\+/g, '')}`;

        if (!recordingUrl) {
            console.error('[Twilio] No RecordingUrl in request body:', JSON.stringify(req.body));
            response.say('No pude recibir tu mensaje de voz.');
            return res.type('text/xml').send(response.toString());
        }

        if (req.body.CallStatus === 'completed' || req.body.RecordingDuration === '0' || req.body.Digits === 'hangup') {
            console.log(`[Twilio] Call completed or zero duration. Ignoring processing for ${threadId}.`);
            return res.type('text/xml').send(response.toString()); // Empty response
        }

        console.log(`[Twilio] Step 1: Downloading recording from ${recordingUrl}`);
        const tempFilePath = join(tmpdir(), `twilio_${Date.now()}.wav`);

        // Ensure URL has .wav extension for media download
        const mediaUrl = recordingUrl.endsWith('.wav') || recordingUrl.endsWith('.mp3')
            ? recordingUrl
            : `${recordingUrl}.wav`;

        // Prepare axios config with optional Twilio Auth
        const axiosConfig: any = {
            method: 'GET',
            url: mediaUrl,
            responseType: 'arraybuffer',
            timeout: 10000
        };

        if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
            console.log('[Twilio] Using Auth for recording download.');
            axiosConfig.auth = {
                username: env.TWILIO_ACCOUNT_SID,
                password: env.TWILIO_AUTH_TOKEN
            };
        }

        // Retry loop for 404 (recording might take a second to be ready)
        let audioRes;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`[Twilio] Download attempt ${attempt}...`);
                audioRes = await axios(axiosConfig);
                break; // Success
            } catch (err: any) {
                if (err.response?.status === 404 && attempt < 3) {
                    console.log(`[Twilio] Recording not ready (404). Retrying in 1.5s...`);
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    continue;
                }
                throw err; // Permanent error or last attempt
            }
        }

        if (!audioRes) throw new Error('Failed to download audio after retries');

        writeFileSync(tempFilePath, Buffer.from(audioRes.data));
        console.log(`[Twilio] Download complete: ${tempFilePath}`);

        console.log(`[Twilio] Step 2: Transcribing audio file...`);
        const userText = await transcribeFile(tempFilePath).catch(e => {
            console.error('[STT Failure]:', e);
            throw new Error(`Transcription failed: ${e.message}`);
        });
        console.log(`[Twilio] User said: ${userText}`);

        if (!userText || userText.trim() === '') {
            response.say('No pude escucharte bien. ¿Puedes repetir?');
            response.record({ action: '/api/twilio/voice-process', maxLength: 30, playBeep: true });
            return res.type('text/xml').send(response.toString());
        }

        console.log(`[Twilio] Step 3: Running AI agent loop for thread ${threadId}...`);
        const voiceSystemPrompt = 'Eres NEXUS, un asistente por teléfono rápido y amable. Responde de forma muy breve y conversacional. No uses listas ni explicaciones largas. No asumas que quieren buscar información o correos a menos que lo digan explícitamente.';

        // Allow up to 3 iterations for telephone calls so it can use tools if requested, and then answer.
        const aiResponse = await runAgentLoop(threadId, userText, 3, voiceSystemPrompt).catch(e => {
            console.error('[Agent Loop Failure]:', e);
            throw new Error(`AI Agent failed: ${e.message}`);
        });
        console.log(`[Twilio] AI Response: ${aiResponse}`);

        console.log(`[Twilio] Step 4: Generating TTS audio...`);
        const localAudioPath = await generateVoice(aiResponse).catch(e => {
            console.error('[TTS Failure]:', e);
            throw new Error(`Voice generation failed: ${e.message}`);
        });

        console.log(`[Twilio] Step 5: Moving audio to public folder...`);
        const publicAudioName = basename(localAudioPath);
        const finalPublicPath = join(audioDir, publicAudioName);
        copyFileSync(localAudioPath, finalPublicPath);
        console.log(`[Twilio] Audio saved to: ${finalPublicPath}`);

        const myUrl = req.protocol + '://' + req.get('host');
        const audioFullUrl = `${myUrl}/audio/${publicAudioName}`;
        console.log(`[Twilio] Step 6: Playing audio from ${audioFullUrl}`);

        response.play(audioFullUrl);

        // After playing the response, listen again
        response.record({
            action: '/api/twilio/voice-process',
            maxLength: 30,
            playBeep: true
        });

        res.type('text/xml');
        res.send(response.toString());
    } catch (err: any) {
        const statusCode = err.response?.status || 500;
        console.error(`[Voice Process Error Details] Status: ${statusCode}`, {
            message: err.message,
            stack: err.stack,
            body: req.body
        });

        const errorResponse = new VoiceResponse();
        let errorMsg = 'Lo siento, hubo un error procesando tu audio.';

        if (statusCode === 401) {
            errorMsg = 'Error 401: Autorización fallida. Por favor revisa las llaves API y los permisos de Twilio.';
        }

        errorResponse.say({ voice: 'alice', language: 'es-ES' }, errorMsg);
        res.type('text/xml').send(errorResponse.toString());
    }
});

export async function startServer() {
    // Startup Check
    console.log('[Server] Starting up...');
    if (!env.GROQ_API_KEY) {
        console.error('[CRITICAL] GROQ_API_KEY is missing!');
    } else {
        console.log('[Server] GROQ_API_KEY is present.');
    }

    app.listen(env.PORT, () => console.log(`[Server] Running on ${env.PORT}`));
}
