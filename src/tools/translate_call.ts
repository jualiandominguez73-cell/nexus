import pkg from 'twilio';
import { env, allowedUserIds } from '../config/env.js';
import { registerTool, Tool } from './index.js';

const translateCallTool: Tool = {
    name: 'translate_call',
    description: 'Call a remote person and connect both of you into a live real-time translation room so you can speak different languages natively. Use this tool ONLY when the user explicitly asks to call someone with a "Translator" or "Traductor".',
    parameters: {
        type: 'object',
        properties: {
            to: {
                type: 'string',
                description: 'The destination phone number of the foreigner in E.164 format (e.g., +8615512345678)'
            },
            userPhone: {
                type: 'string',
                description: 'The user\'s own phone number in E.164. If not provided by user, ask them what number they are calling from or dialing into.'
            }
        },
        required: ['to', 'userPhone']
    },
    execute: async (args: { to: string; userPhone: string }, meta?: { telegramChatId?: number }) => {
        if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) {
            return { error: 'Twilio credentials or phone number not configured.' };
        }

        if (!env.BASE_URL) {
            return { error: 'BASE_URL not configured in .env' };
        }

        try {
            const client = pkg(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
            const conferenceName = `Room_${Date.now()}`;

            const wsHostUrl = env.BASE_URL ? new URL(env.BASE_URL).host : 'example.ngrok.io';

            // 1. We create the TwiML for both humans to join the conference
            const joinConferenceTwiML = `
                <Response>
                    <Say language="es-MX" voice="alice">Entrando a la sala de intérprete.</Say>
                    <Dial>
                        <Conference>
                            ${conferenceName}
                        </Conference>
                    </Dial>
                </Response>
            `;

            // 2. NEXUS calls you (The User) and puts you in the conference
            console.log(`[TranslateTool] Calling User: ${args.userPhone}`);
            await client.calls.create({
                to: args.userPhone,
                from: env.TWILIO_PHONE_NUMBER,
                twiml: joinConferenceTwiML
            });

            // 3. NEXUS calls the Foreigner and puts them in the same conference
            console.log(`[TranslateTool] Calling Foreigner: ${args.to}`);
            await client.calls.create({
                to: args.to,
                from: env.TWILIO_PHONE_NUMBER,
                twiml: joinConferenceTwiML
            });

            // 4. NEXUS itself silently dials into the Conference and attaches the Translator WebSocket
            console.log(`[TranslateTool] Injecting AI WebSocket to Room: ${conferenceName}`);
            await client.calls.create({
                to: env.TWILIO_PHONE_NUMBER, // Dialing its own Twilio Number to join? 
                from: env.TWILIO_PHONE_NUMBER,
                twiml: `
                    <Response>
                        <Dial>
                            <Conference statusCallbackEvent="leave" statusCallback="${env.BASE_URL}/api/twilio/conference-status">
                                ${conferenceName}
                            </Conference>
                        </Dial>
                        <Connect><Stream url="wss://${wsHostUrl}/api/twilio/stream" /></Connect>
                    </Response>
                `
            });

            return {
                success: true,
                message: `Perfecto. He marcado a tu celular (${args.userPhone}) y al contacto (${args.to}). En cuanto ambos contesten, la Inteligencia Artificial estará escuchando y traduciendo en la sala.`
            };
        } catch (error: any) {
            console.error('[TranslateTool] Error:', error);
            return { error: `No se pudo crear la sala de traducción: ${error.message}` };
        }
    }
};

registerTool(translateCallTool);
