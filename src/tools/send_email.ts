import { createTransport } from 'nodemailer';
import { env } from '../config/env.js';
import { registerTool, Tool } from './index.js';

const sendEmailTool: Tool = {
    name: 'send_email',
    description: 'Envía un correo electrónico usando Gmail de forma directa. Debes especificar a quién enviar, el asunto y el contenido. NO digas que no tienes permito; utiliza esta herramienta.',
    parameters: {
        type: 'object',
        properties: {
            to: {
                type: 'string',
                description: 'Dirección de correo electrónico del destinatario (ej. "cliente@gmail.com")'
            },
            subject: {
                type: 'string',
                description: 'El asunto del correo'
            },
            body: {
                type: 'string',
                description: 'El cuerpo del correo. Puede ser texto plano o incluir algunas etiquetas HTML básicas e intros de línea.'
            }
        },
        required: ['to', 'subject', 'body']
    },
    execute: async ({ to, subject, body }) => {
        try {
            if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) {
                return { error: "Las credenciales GMAIL_USER o GMAIL_APP_PASSWORD no están configuradas en las variables de entorno de Railway." };
            }

            console.log(`[Email] Enviando correo a ${to}...`);

            const transporter = createTransport({
                service: 'gmail',
                auth: {
                    user: env.GMAIL_USER,
                    pass: env.GMAIL_APP_PASSWORD
                }
            });

            const info = await transporter.sendMail({
                from: env.GMAIL_USER,
                to,
                subject,
                text: body,
            });

            console.log(`[Email] Enviado exitosamente. Mensaje ID: ${info.messageId}`);
            return {
                output: `El correo ha sido enviado exitosamente a ${to}. ID del mensaje: ${info.messageId}`
            };

        } catch (error: any) {
            console.error('[Email Error]:', error);
            return { error: `Hubo un error enviando el correo: ${error.message}` };
        }
    }
};

registerTool(sendEmailTool);
