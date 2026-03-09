import { WebSocket as WsClient } from 'ws';
import { env } from '../config/env.js';
import pkgWave from 'wavefile';
const { WaveFile } = pkgWave;
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, unlinkSync } from 'node:fs';
import { transcribeFile, getDynamicVoiceTwiML } from './voice.js';
import { runAgentLoop } from './loop.js';
import { settingsDb } from '../db/settings.js';
import pkg from 'twilio';

const twilioClient = pkg(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

export function handleTwilioStream(twilioWs: any) {
    let callSid = "";
    let streamSid = "";

    // Audio Buffer State
    let audioChunks: Buffer[] = [];
    let isSpeaking = false;
    let silenceStartMs = 0;
    const SILENCE_THRESHOLD_MS = 1500; // 1.5 seconds of silence means end of phrase

    // Simple Voice Activity Detection (VAD) for Mu-Law
    function getSpeechEnergy(buffer: Buffer): number {
        let nonSilence = 0;
        for (let i = 0; i < buffer.length; i++) {
            const b = buffer[i];
            // In mu-law, 255 (0xFF) and 127 (0x7F) are silence. 
            // We ignore values very close to silence as well (254, 126)
            if (b !== 255 && b !== 127 && b !== 254 && b !== 126) {
                nonSilence++;
            }
        }
        return nonSilence / buffer.length;
    }

    twilioWs.on('message', async (message: any) => {
        const msg = JSON.parse(message.toString());

        if (msg.event === 'start') {
            streamSid = msg.start.streamSid;
            callSid = msg.start.callSid; // We need this to send announcements!
            console.log(`[Groq Translator] Call started. Stream SID: ${streamSid}, CallSid: ${callSid}`);
        }
        else if (msg.event === 'media') {
            const payload = msg.media.payload;
            const chunk = Buffer.from(payload, 'base64');

            const energy = getSpeechEnergy(chunk);
            const hasSpeech = energy > 0.1; // If more than 10% of the chunk is non-silence

            if (hasSpeech) {
                if (!isSpeaking) {
                    console.log(`[Groq Translator] Speech detected! Starting recording...`);
                    isSpeaking = true;
                    audioChunks = []; // start fresh
                }
                silenceStartMs = 0; // reset silence timer
            } else {
                if (isSpeaking && silenceStartMs === 0) {
                    silenceStartMs = Date.now();
                }
            }

            // Always collect audio if we are in a speaking state (including brief silences)
            if (isSpeaking) {
                audioChunks.push(chunk);

                // Check if silence has lasted longer than our threshold
                if (silenceStartMs > 0 && Date.now() - silenceStartMs > SILENCE_THRESHOLD_MS) {
                    console.log(`[Groq Translator] Silence detected. Processing phrase...`);

                    const bufferToProcess = Buffer.concat(audioChunks);

                    // Reset states immediately so we can capture the next phrase while processing
                    isSpeaking = false;
                    silenceStartMs = 0;
                    audioChunks = [];

                    // Run the transcription and translation asynchronously
                    processPhrase(bufferToProcess, callSid).catch(err => {
                        console.error('[Groq Translator] Error processing phrase:', err);
                    });
                }
            }
        }
        else if (msg.event === 'stop') {
            console.log(`[Groq Translator] Call Ended.`);
        }
    });

    twilioWs.on('close', () => {
        console.log('[Groq Translator] Twilio WebSocket Closed');
    });
}

// Sub-routine: The full Pipeline (VAD -> Groq STT -> Groq LLM -> Twilio Announce)
async function processPhrase(muLawBuffer: Buffer, callSid: string) {
    if (muLawBuffer.length < 8000) {
        // Less than 1 second of audio, probably a grunt or noise, ignore.
        console.log('[Groq Translator] Phrase too short, ignoring.');
        return;
    }

    const tempWav = join(tmpdir(), `translator_${Date.now()}.wav`);
    try {
        // 1. Convert Mu-Law to standard WAV for Groq Whisper
        const wav = new WaveFile();
        wav.fromScratch(1, 8000, '8m', muLawBuffer); // 1 channel, 8000Hz, 8-bit mu-law (8m)
        writeFileSync(tempWav, wav.toBuffer());

        console.log('[Groq Translator] 1. Transcribing audio with Groq Whisper...');
        const transcribedText = await transcribeFile(tempWav);
        console.log(`[Groq Translator] 1. Heard: "${transcribedText}"`);

        if (!transcribedText || transcribedText.trim() === '') return;

        // 2. Translate text using your local Llama 3 / OpenRouter agent
        console.log('[Groq Translator] 2. Translating via LLM...');
        const systemPrompt = `Eres el Intérprete Simultáneo NEXUS. Traduce el siguiente texto de forma directa, sin saludos, sin comillas, y sin agregar ninguna otra palabra más que la traducción pura.
        
        REGLA DE IDIOMA:
        - Si el texto está en ESPAÑOL: Tradúcelo al idioma de la persona extranjera con la que estoy hablando (ej. Chino, Coreano, Japonés, Inglés, etc - adivina por el contexto).
        - Si el texto está en un IDIOMA EXTRANJERO: Tradúcelo siempre al ESPAÑOL.
        
        Da solo el texto final traducido comercialmente. Texto a traducir:`;

        // We use threadId "translator" to avoid polluting someone's memory, or we bypass memory.
        const translation = await runAgentLoop(`translator_tmp`, transcribedText, 1, systemPrompt);
        console.log(`[Groq Translator] 2. Translated: "${translation}"`);

        // 3. Play audio back directly to the Call
        console.log('[Groq Translator] 3. Generating TTS Audio...');
        const settings = await settingsDb.getSettings();

        // Dynamic voice resolves to TwiML configs
        const voiceTwiML = await getDynamicVoiceTwiML(translation, settings, env.BASE_URL || '');

        // We use Twilio REST API to forcefully inject an Announcement into the call or conference
        // Note: For simple 1-to-1 calls, we can update the Call with TwiML.
        // If it's a conference, "callSid" might refer to the leg. 
        // We will just use the call's TwiML update capability.

        let twimlString = '';
        if (voiceTwiML.action === 'play') {
            twimlString = `<Response><Play>${voiceTwiML.content}</Play></Response>`;
        } else {
            twimlString = `<Response><Say voice="${voiceTwiML.twilioVoiceId || 'alice'}" language="es-MX">${voiceTwiML.content}</Say></Response>`;
        }

        // We inject the audio by replacing the stream momentarily or creating an announcement
        // Actually, updating the Call Twiml will kill the WebSocket stream!
        // To prevent killing the stream, we inject audio over the WebSocket `media` directly if possible, OR
        // Since the user is in a conference, we can Announce to the Call. Twilio allows `twilioClient.calls(callSid).update({twiml:...})`
        // But let's build a backward-injection media packet to NOT interrupt the active WebSocket connection.

        // However, converting mp3 -> ulaw to send back over WS is hard without ffmpeg.
        // So we will just use Twilio's Call Update. Wait! `twilioClient.calls(callSid).update(...)` WILL STOP the `<Stream>`.
        // Better: Assuming they are in a <Conference> (Fase 3), we can `announce` to the conference without killing it.
        // But for now, we will just send it as an announcement to the Participant if we can, or just update the call.

        // Wait, if it's a <Conference>, the CallSid of the stream belongs to NEXUS's leg.
        // We can just update NEXUS's leg TwiML to Say the text, and since NEXUS is in the Conference, 
        // everyone hears it! And the Stream will be re-established after Say.

        // Safe play for Phase 2: Send TwiML back to the call leg.
        // Actually, Twilio stream receives TwiML if we respond, no, just REST API.
        console.log(`[Groq Translator] Injecting voice into call: ${callSid}`);
        const wsHost = env.BASE_URL ? new URL(env.BASE_URL).host : 'example.ngrok.io'; // Change to dynamic later if needed
        await twilioClient.calls(callSid).update({
            twiml: `
                <Response>
                    ${voiceTwiML.action === 'play' ? `<Play>${voiceTwiML.content}</Play>` : `<Say voice="${voiceTwiML.twilioVoiceId || 'alice'}" language="es-MX">${voiceTwiML.content}</Say>`}
                    <Connect><Stream url="wss://${wsHost}/api/twilio/stream" /></Connect>
                </Response>
            `
        });

    } catch (err: any) {
        console.error('[Groq Translator Pipeline Error]:', err.message);
    } finally {
        try { unlinkSync(tempWav); } catch (e) { }
    }
}
