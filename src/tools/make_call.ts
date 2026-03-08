import pkg from 'twilio';
import { env, allowedUserIds } from '../config/env.js';
import { registerTool, Tool } from './index.js';
import { setOutboundContext } from '../outbound/store.js';

const makeCallTool: Tool = {
    name: 'make_call',
    description: 'Initiate an outbound phone call to a given number. NEXUS will call the person, have a live voice conversation to accomplish the stated objective, and report back with a summary via Telegram. Use this when the user asks you to call someone.',
    parameters: {
        type: 'object',
        properties: {
            to: {
                type: 'string',
                description: 'The destination phone number in E.164 format (e.g., +5215512345678)'
            },
            objective: {
                type: 'string',
                description: 'What NEXUS should accomplish or ask during the call (e.g., "Ask for the price of regular gasoline")'
            }
        },
        required: ['to', 'objective']
    },
    execute: async (args: { to: string; objective: string }, meta?: { telegramChatId?: number }) => {
        if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) {
            return { error: 'Twilio credentials or phone number not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env' };
        }

        if (!env.BASE_URL) {
            return { error: 'BASE_URL not configured. Set BASE_URL in .env to your public server URL (e.g., https://your-domain.ngrok.io)' };
        }

        const telegramChatId = meta?.telegramChatId || allowedUserIds[0];
        if (!telegramChatId) {
            return { error: 'Could not determine Telegram chat ID to report back.' };
        }

        try {
            const client = pkg(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

            const call = await client.calls.create({
                to: args.to,
                from: env.TWILIO_PHONE_NUMBER,
                url: `${env.BASE_URL}/voice-outbound-init`,
                statusCallback: `${env.BASE_URL}/voice-outbound-status`,
                statusCallbackEvent: ['completed'],
                statusCallbackMethod: 'POST',
            });

            const threadId = `outbound_${call.sid}`;

            setOutboundContext(call.sid, {
                callSid: call.sid,
                to: args.to,
                objective: args.objective,
                telegramChatId,
                threadId,
                conversationLog: [],
                createdAt: new Date(),
            });

            console.log(`[Outbound] Call initiated: ${call.sid} -> ${args.to}`);

            return {
                success: true,
                callSid: call.sid,
                message: `Llamada iniciada a ${args.to}. Te envio el resumen por Telegram cuando termine.`
            };
        } catch (error: any) {
            console.error('[Outbound] Error creating call:', error);
            return { error: `Failed to initiate call: ${error.message}` };
        }
    }
};

registerTool(makeCallTool);
