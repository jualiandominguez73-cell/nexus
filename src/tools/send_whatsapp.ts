import { registerTool, ToolExecutionMeta } from './index.js';
import { env } from '../config/env.js';
import twilio from 'twilio';
import { tenantDb } from '../db/tenant.js';

const tool = {
    name: 'send_whatsapp',
    description: 'Envia un mensaje de WhatsApp a un usuario dado. Debes proporcionar el numero de telefono internacional (con o sin +). SOLO USAR CUANDO EL USUARIO TE PIDA EXPLICITAMENTE QUE ENVÍES UN WHATSAPP.',
    parameters: {
        type: 'object',
        properties: {
            to: {
                type: 'string',
                description: 'Número de teléfono de destino (ej. +52656...)'
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

            // Format number to ensure it has whatsapp: prefix and a +
            let destination = args.to.replace(/\s+/g, '');
            if (!destination.startsWith('+')) destination = '+' + destination;
            if (!destination.startsWith('whatsapp:')) destination = 'whatsapp:' + destination;

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
