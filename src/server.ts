import express from 'express';
import pkg from 'twilio';
const { twiml } = pkg;
const { VoiceResponse, MessagingResponse } = twiml;

import { env, allowedUserIds } from './config/env.js';
import { bot } from './bot/telegram.js';
import { runAgentLoop } from './agent/loop.js';
import { transcribeFile, generateVoice } from './agent/voice.js';
import { getOutboundContext, deleteOutboundContext } from './outbound/store.js';
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

        response.say({ voice: 'alice', language: 'es-MX' }, 'Hola, soy NEXUS. ¿En qué puedo ayudarte? Te escucharé después del tono.');
        response.record({
            action: '/api/twilio/voice-process',
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

        // ====== TELEGRAM ALERT ======
        try {
            const adminId = allowedUserIds[0];
            if (adminId && userText.trim() !== '') {
                await bot.api.sendMessage(adminId, `📞 *Llamada Entrante ${userId}*\n\nNEXUS escuchó esto:\n_"${userText}"_`, { parse_mode: 'Markdown' });
            }
        } catch (botErr) {
            console.error('[Telegram Notify Error]:', botErr);
        }
        // ============================

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

        console.log(`[Twilio] Step 4: Generating TTS audio natively with Twilio...`);
        // Using Twilio's native Alice voice (or Polly) in Mexican Spanish to save the whole MP3 generation and public exposure latency
        response.say({ voice: 'alice', language: 'es-MX' }, aiResponse);

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

// WhatsApp / SMS Webhook
app.all(['/whatsapp', '/api/twilio/whatsapp', '/welcome'], async (req, res) => {
    try {
        const response = new MessagingResponse();
        const from = req.body?.From || 'Unknown';
        const bodyText = req.body?.Body || '';
        const numMedia = parseInt(req.body?.NumMedia || '0', 10);

        console.log(`[Twilio WhatsApp] Message from ${from}: ${bodyText}`);

        // Handle basic HTTP GET check
        if (req.method === 'GET') {
            return res.status(200).send('WhatsApp webhook is active.');
        }

        const threadId = `twilio_wa_${from.replace(/whatsapp:/, '').replace(/\+/g, '')}`;

        // Construct message. If it includes images, we format it for the vision model
        let finalMessageContent: any = bodyText;

        if (numMedia > 0) {
            finalMessageContent = [{ type: 'text', text: bodyText || "Describe la imagen adjunta." }];

            for (let i = 0; i < numMedia; i++) {
                const mediaUrl = req.body[`MediaUrl${i}`];
                const contentType = req.body[`MediaContentType${i}`];

                if (contentType?.startsWith('image/')) {
                    // Adding image URL directly so LLM can fetch it, this usually works well with Groq/OpenRouter
                    finalMessageContent.push({ type: 'image_url', image_url: { url: mediaUrl } });
                }
            }
        }

        // WhatsApp system prompt (similar to voice but formatted for texting)
        const waSystemPrompt = 'Eres NEXUS, un asistente inteligente integrado en WhatsApp. Sé amable, conciso y responde como si estuvieras texteando con un amigo. Puedes usar emojis.';

        const aiResponse = await runAgentLoop(threadId, finalMessageContent, 5, waSystemPrompt).catch(e => {
            console.error('[WhatsApp Agent Loop Failure]:', e);
            throw new Error(`AI Agent failed: ${e.message}`);
        });

        console.log(`[Twilio WhatsApp] AI Response: ${aiResponse}`);
        response.message(aiResponse);

        res.type('text/xml');
        res.send(response.toString());

    } catch (err: any) {
        console.error('[WhatsApp Webhook Error]:', err);
        const errorResponse = new MessagingResponse();
        errorResponse.message('Lo siento, encontré un error al procesar tu mensaje de WhatsApp.');
        res.type('text/xml').send(errorResponse.toString());
    }
});

// =============================================
// OUTBOUND CALL ENDPOINTS
// =============================================

// 1. Initial TwiML when the outbound call is answered
app.post('/voice-outbound-init', async (req, res) => {
    try {
        const response = new VoiceResponse();
        const callSid = req.body.CallSid;
        const ctx = callSid ? getOutboundContext(callSid) : undefined;

        const greeting = ctx
            ? `Hola, te habla el asistente NEXUS. Disculpa la molestia, te llamo para lo siguiente: ${ctx.objective}. Por favor responde despues del tono.`
            : 'Hola, te habla el asistente NEXUS. Disculpa la molestia, necesito hacerte una consulta rapida. Por favor responde despues del tono.';

        response.say({ voice: 'alice', language: 'es-MX' }, greeting);
        response.record({
            action: '/voice-process-outbound',
            maxLength: 30,
            playBeep: true,
        });

        res.type('text/xml');
        res.send(response.toString());
    } catch (err: any) {
        console.error('[Outbound Init Error]:', err);
        const errResponse = new VoiceResponse();
        errResponse.say('Lo siento, hubo un error. Adios.');
        errResponse.hangup();
        res.type('text/xml').send(errResponse.toString());
    }
});

// 2. Process each recorded segment from the outbound call
app.post('/voice-process-outbound', async (req, res) => {
    try {
        const response = new VoiceResponse();
        const callSid = req.body.CallSid;
        const ctx = callSid ? getOutboundContext(callSid) : undefined;

        if (!ctx) {
            console.error('[Outbound Process] No context found for CallSid:', callSid);
            response.say('Lo siento, hubo un error con esta llamada. Adios.');
            response.hangup();
            return res.type('text/xml').send(response.toString());
        }

        const recordingUrl = req.body.RecordingUrl;
        if (!recordingUrl) {
            response.say('No pude escucharte. Puedes repetir?');
            response.record({ action: '/voice-process-outbound', maxLength: 30, playBeep: true });
            return res.type('text/xml').send(response.toString());
        }

        if (req.body.RecordingDuration === '0') {
            response.say('No escuche nada. Puedes repetir?');
            response.record({ action: '/voice-process-outbound', maxLength: 30, playBeep: true });
            return res.type('text/xml').send(response.toString());
        }

        // Download and transcribe the recording
        const tempFilePath = join(tmpdir(), `outbound_${Date.now()}.wav`);
        const mediaUrl = recordingUrl.endsWith('.wav') ? recordingUrl : `${recordingUrl}.wav`;

        const axiosConfig: any = {
            method: 'GET',
            url: mediaUrl,
            responseType: 'arraybuffer',
            timeout: 10000,
        };

        if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
            axiosConfig.auth = { username: env.TWILIO_ACCOUNT_SID, password: env.TWILIO_AUTH_TOKEN };
        }

        let audioRes;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                audioRes = await axios(axiosConfig);
                break;
            } catch (err: any) {
                if (err.response?.status === 404 && attempt < 3) {
                    await new Promise(r => setTimeout(r, 1500));
                    continue;
                }
                throw err;
            }
        }
        if (!audioRes) throw new Error('Failed to download outbound recording after retries');

        writeFileSync(tempFilePath, Buffer.from(audioRes.data));

        const callerSaid = await transcribeFile(tempFilePath).catch(e => {
            console.error('[Outbound STT Failure]:', e);
            throw new Error(`Transcription failed: ${e.message}`);
        });

        console.log(`[Outbound] Person said: "${callerSaid}"`);
        ctx.conversationLog.push(`Persona: ${callerSaid}`);

        if (!callerSaid || callerSaid.trim() === '') {
            response.say('No pude escucharte bien. Puedes repetir?');
            response.record({ action: '/voice-process-outbound', maxLength: 30, playBeep: true });
            return res.type('text/xml').send(response.toString());
        }

        // Outbound system prompt: reminds the AI of its mission
        const outboundSystemPrompt = [
            'Eres NEXUS, un asistente de IA que esta realizando una llamada telefonica saliente.',
            `Tu OBJETIVO en esta llamada es: ${ctx.objective}`,
            `Estas llamando al numero: ${ctx.to}`,
            'Habla de forma amable, breve y directa. Eres profesional pero conversacional.',
            'Cuando ya tengas la informacion que necesitas, despidete amablemente y di exactamente la palabra "MISION_CUMPLIDA" al final de tu respuesta.',
            'Si la persona no puede ayudarte o se niega, despidete cortesmente y di "MISION_CUMPLIDA" al final.',
            'No uses listas, ni markdown. Habla como en una conversacion telefonica normal.',
        ].join(' ');

        const aiResponse = await runAgentLoop(ctx.threadId, callerSaid, 3, outboundSystemPrompt);
        console.log(`[Outbound] AI response: "${aiResponse}"`);
        ctx.conversationLog.push(`NEXUS: ${aiResponse}`);

        // Check if the AI signals mission complete
        const missionComplete = aiResponse.includes('MISION_CUMPLIDA');
        const cleanResponse = aiResponse.replace(/MISION_CUMPLIDA/g, '').trim();

        response.say({ voice: 'alice', language: 'es-MX' }, cleanResponse);

        if (missionComplete) {
            response.say({ voice: 'alice', language: 'es-MX' }, 'Gracias por tu tiempo. Hasta luego.');
            response.hangup();

            // Send summary to Telegram
            sendOutboundSummary(ctx).catch(err =>
                console.error('[Outbound] Error sending Telegram summary:', err)
            );
        } else {
            // Continue the conversation
            response.record({
                action: '/voice-process-outbound',
                maxLength: 30,
                playBeep: true,
            });
        }

        res.type('text/xml');
        res.send(response.toString());
    } catch (err: any) {
        console.error('[Outbound Process Error]:', err);
        const errResponse = new VoiceResponse();
        errResponse.say('Lo siento, hubo un error. Adios.');
        errResponse.hangup();
        res.type('text/xml').send(errResponse.toString());

        // Try to notify on error too
        const callSid = req.body?.CallSid;
        const ctx = callSid ? getOutboundContext(callSid) : undefined;
        if (ctx) {
            sendOutboundSummary(ctx, 'Error durante la llamada').catch(() => { });
        }
    }
});

// 3. Status callback: fires when the call ends (catches hangups, no-answer, busy, etc.)
app.post('/voice-outbound-status', async (req, res) => {
    const callSid = req.body.CallSid;
    const callStatus = req.body.CallStatus; // completed, busy, no-answer, failed, canceled
    console.log(`[Outbound Status] CallSid=${callSid} Status=${callStatus}`);

    const ctx = callSid ? getOutboundContext(callSid) : undefined;

    if (ctx) {
        if (callStatus !== 'completed' || ctx.conversationLog.length === 0) {
            // Call didn't connect or ended without conversation
            const reason = callStatus === 'busy' ? 'Linea ocupada'
                : callStatus === 'no-answer' ? 'No contestaron'
                    : callStatus === 'failed' ? 'Llamada fallida'
                        : callStatus === 'canceled' ? 'Llamada cancelada'
                            : 'Llamada terminada sin conversacion';

            await sendOutboundSummary(ctx, reason).catch(err =>
                console.error('[Outbound Status] Error sending summary:', err)
            );
        } else if (ctx.conversationLog.length > 0) {
            // Call completed normally - send summary if not already sent by MISION_CUMPLIDA
            await sendOutboundSummary(ctx).catch(err =>
                console.error('[Outbound Status] Error sending summary:', err)
            );
        }
        deleteOutboundContext(callSid);
    }

    res.sendStatus(200);
});

// Helper: send the call summary back to Telegram
async function sendOutboundSummary(ctx: import('./outbound/store.js').OutboundCallContext, errorReason?: string) {
    try {
        let summary: string;

        if (errorReason) {
            summary = `Llamada a ${ctx.to}\nEstado: ${errorReason}\nObjetivo: ${ctx.objective}`;
        } else if (ctx.conversationLog.length === 0) {
            summary = `Llamada a ${ctx.to}\nNo se pudo obtener informacion.\nObjetivo: ${ctx.objective}`;
        } else {
            // Ask the LLM to generate a clean summary of the conversation
            const transcript = ctx.conversationLog.join('\n');
            const summaryPrompt = [
                `Resume la siguiente conversacion telefonica de forma clara y concisa.`,
                `El objetivo de la llamada era: ${ctx.objective}`,
                `Numero llamado: ${ctx.to}`,
                `\nTranscripcion:\n${transcript}`,
                `\nDa un resumen breve con la informacion obtenida. Si se logro el objetivo, indicalo.`
            ].join('\n');

            const aiSummary = await runAgentLoop(
                `summary_${ctx.callSid}`,
                summaryPrompt,
                1,
                'Eres un asistente que resume conversaciones telefonicas. Se breve y claro. Resalta la informacion clave obtenida.'
            );

            summary = `Llamada a ${ctx.to}\nObjetivo: ${ctx.objective}\n\nResumen:\n${aiSummary}`;
        }

        await bot.api.sendMessage(ctx.telegramChatId, summary);
        console.log(`[Outbound] Summary sent to Telegram chat ${ctx.telegramChatId}`);
    } catch (err) {
        console.error('[Outbound] Failed to send Telegram summary:', err);
    }
}

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
