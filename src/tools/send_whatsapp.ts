import { registerTool } from './index.js';
import { env } from '../config/env.js';
import twilio from 'twilio';

const tool = {
    name: 'send_whatsapp_message',
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
    execute: async (args: { to: string, message: string }) => {
        try {
            if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_WHATSAPP_NUMBER) {
                return "Error: Faltan credenciales de Twilio o el número origen (TWILIO_WHATSAPP_NUMBER) en las variables de entorno.";
            }

            const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

            // Format number to ensure it has whatsapp: prefix and a +
            let destination = args.to.replace(/\s+/g, '');
            if (!destination.startsWith('+')) destination = '+' + destination;
            if (!destination.startsWith('whatsapp:')) destination = 'whatsapp:' + destination;

            let source = env.TWILIO_WHATSAPP_NUMBER;
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
