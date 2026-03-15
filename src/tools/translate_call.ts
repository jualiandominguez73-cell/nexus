import pkg from 'twilio';
import { env, allowedUserIds } from '../config/env.js';
import { registerTool, Tool, ToolExecutionMeta } from './index.js';
import { tenantDb } from '../db/tenant.js';

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
    execute: async (args: { to: string; userPhone: string }, meta?: ToolExecutionMeta) => {
        const tenantId = meta?.tenantId || 'default';
        const tenant = await tenantDb.getTenant(tenantId);

        const accountSid = tenant?.twilioAccountSid || env.TWILIO_ACCOUNT_SID;
        const authToken = tenant?.twilioAuthToken || env.TWILIO_AUTH_TOKEN;
        const fromNumber = tenant?.twilioPhoneNumber || env.TWILIO_PHONE_NUMBER;

        if (!accountSid || !authToken || !fromNumber) {
            return { error: 'Twilio credentials or phone number not configured for this Tenant.' };
        }

        if (!env.BASE_URL) {
            return { error: 'BASE_URL not configured in .env' };
        }

        try {
            const client = pkg(accountSid, authToken);
            const conferenceName = `Room_${Date.now()}`;

            const wsHostUrl = env.BASE_URL ? new URL(env.BASE_URL).host : 'example.ngrok.io';

            // 1. TwiML for the Foreigner (Normal Join)
            // 1. TwiML for the Foreigner (Normal Join with an isolated listening stream)
            const foreignerTwiML = `
                <Response>
                    <Say language="es-MX" voice="alice">Entrando a sala de traducción.</Say>
                    <Start>
                        <Stream url="wss://${wsHostUrl}/api/twilio/stream" track="inbound_track">
                            <Parameter name="ConferenceName" value="${conferenceName}" />
                            <Parameter name="Role" value="Foreigner" />
                            <Parameter name="TenantId" value="${tenantId}" />
                        </Stream>
                    </Start>
                    <Dial>
                        <Conference>
                            ${conferenceName}
                        </Conference>
                    </Dial>
                </Response>
            `;

            // 2. TwiML for the User (Joins with their own isolated listening stream)
            const userTwiML = `
                <Response>
                    <Say language="es-MX" voice="alice">Sala de traducción iniciada. Esperando a la otra parte.</Say>
                    <Start>
                        <Stream url="wss://${wsHostUrl}/api/twilio/stream" track="inbound_track">
                            <Parameter name="ConferenceName" value="${conferenceName}" />
                            <Parameter name="Role" value="User" />
                            <Parameter name="TenantId" value="${tenantId}" />
                        </Stream>
                    </Start>
                    <Dial>
                        <Conference>
                            ${conferenceName}
                        </Conference>
                    </Dial>
                </Response>
            `;

            // 3. NEXUS calls the Foreigner
            console.log(`[TranslateTool] Calling Foreigner: ${args.to}`);
            await client.calls.create({
                to: args.to,
                from: fromNumber,
                twiml: foreignerTwiML
            });

            // 4. NEXUS calls you (The User) and attaches the AI spy stream
            console.log(`[TranslateTool] Calling User: ${args.userPhone}`);
            await client.calls.create({
                to: args.userPhone,
                from: fromNumber,
                twiml: userTwiML
            });

            return {
                success: true,
                message: `He marcado a tu celular (${args.userPhone}) y al contacto (${args.to}) en México. La IA escuchará la conferencia invisiblemente y lanzará las traducciones por el altavoz para que ambos escuchen.`
            };
        } catch (error: any) {
            console.error('[TranslateTool] Error:', error);
            return { error: `No se pudo crear la sala de traducción: ${error.message}` };
        }
    }
};

registerTool(translateCallTool);
