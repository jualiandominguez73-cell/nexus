import { registerTool, ToolExecutionMeta } from './index.js';
import { env } from '../config/env.js';
import twilio from 'twilio';
import { tenantDb } from '../db/tenant.js';

const tool = {
    name: 'reply_to_active_whatsapp',
    description: 'Envía un mensaje de texto libre de WhatsApp. REGLA ESTRICTA DE WHATSAPP: SOLO puedes usar esta herramienta si sabes que la persona te ha enviado un mensaje de WhatsApp en las últimas 24 horas. Si vas a escribirle a alguien POR PRIMERA VEZ o iniciar un nuevo contacto, ESTÁ PROHIBIDO usar esta herramienta; en su lugar, OBLIGATORIAMENTE debes usar la herramienta "send_new_whatsapp".',
    parameters: {
        type: 'object',
        properties: {
            to: {
                type: 'string',
                description: 'Número de teléfono de destino completo (ej. +526561234567)'
            },
            message: {
                type: 'string',
                description: 'Cuerpo del mensaje a enviar.'
            }
        },
        required: ['to', 'message']
    },
    execute: async (args: { to: string, message: string }, meta?: ToolExecutionMeta) => {
        const tenantId = meta?.tenantId || 'default';
        const tenant = await tenantDb.getTenant(tenantId);

        const accountSid = tenant?.twilioAccountSid || env.TWILIO_ACCOUNT_SID;
        const authToken = tenant?.twilioAuthToken || env.TWILIO_AUTH_TOKEN;
        const fromWhatsappNumber = tenant?.twilioWhatsappNumber || env.TWILIO_WHATSAPP_NUMBER;

        try {
            if (!accountSid || !authToken || !fromWhatsappNumber) {
                return "Error: Faltan credenciales de Twilio o el número origen (WhatsApp) en las variables del cliente y del entorno.";
            }

            const client = twilio(accountSid, authToken);

            let destination = args.to.replace(/\s+/g, '').replace(/[^0-9+]/g, '');
            if (!destination.startsWith('+')) destination = '+' + destination;
            if (!destination.startsWith('whatsapp:')) destination = 'whatsapp:' + destination;

            // Fix for Mexico WhatsApp numbers (Twilio requires +521 instead of +52)
            if (destination.match(/^whatsapp:\+52[^1]/)) {
                destination = destination.replace('whatsapp:+52', 'whatsapp:+521');
            }

            let source = fromWhatsappNumber;
            if (!source.startsWith('whatsapp:')) source = 'whatsapp:' + source;

            console.log(`[Tool] Ejecutando envío de WhatsApp a ${destination}...`);
            const sentMessage = await client.messages.create({
                from: source,
                to: destination,
                body: args.message
            });

            return `Mensaje enviado exitosamente a WhatsApp de ${args.to}. Message SID: ${sentMessage.sid}`;
        } catch (error: any) {
            console.error('[Tool send_whatsapp Error]:', error);
            return `Error al enviar el mensaje de WhatsApp: ${error.message}`;
        }
    }
};

registerTool(tool);
