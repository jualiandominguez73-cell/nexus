import { registerTool, ToolExecutionMeta } from './index.js';
import { env } from '../config/env.js';
import twilio from 'twilio';
import { tenantDb } from '../db/tenant.js';

const tool = {
    name: 'send_whatsapp_template_contacto',
    description: 'Inicia por primera vez una conversación de WhatsApp enviando la plantilla oficial aprobada para agendar contacto con el usuario. USAR ESTO SIEMPRE SI NUNCA SE LE HA HABLADO A LA PERSONA ANTES.',
    parameters: {
        type: 'object',
        properties: {
            to: {
                type: 'string',
                description: 'Número de teléfono de destino (ej. +52656...)'
            },
            clientName: {
                type: 'string',
                description: 'Nombre o Alias de la persona a la que se le envía el mensaje.'
            }
        },
        required: ['to', 'clientName']
    },
    execute: async (args: { to: string, clientName: string }, meta?: ToolExecutionMeta) => {
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

            let destination = args.to.replace(/\s+/g, '');
            if (!destination.startsWith('+')) destination = '+' + destination;
            if (!destination.startsWith('whatsapp:')) destination = 'whatsapp:' + destination;

            let source = fromWhatsappNumber;
            if (!source.startsWith('whatsapp:')) source = 'whatsapp:' + source;

            console.log(`[Tool] Ejecutando envío de plantilla WhatsApp a ${destination}...`);
            const sentMessage = await client.messages.create({
                from: source,
                to: destination,
                contentSid: 'HX2700e39b41cb96af581b4301ff114270', // Content SID Dinámico
                contentVariables: JSON.stringify({ "1": args.clientName })
            });

            return `Plantilla de contacto enviada exitosamente a WhatsApp de ${args.to}. SID: ${sentMessage.sid}. El cliente ahora podrá darle clic al botón para la vCard.`;
        } catch (error: any) {
            console.error('[Tool send_whatsapp_template Error]:', error);
            return `Error al enviar la plantilla de WhatsApp: ${error.message}`;
        }
    }
};

registerTool(tool);
