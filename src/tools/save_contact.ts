import { registerTool, Tool } from './index.js';
import { contactsDb } from '../db/contacts.js';
import { allowedUserIds } from '../config/env.js';

const saveContactTool: Tool = {
    name: 'save_contact',
    description: 'Save a person\'s name and phone number to the digital rolodex / database so you can remember them later. Use this when the user asks you to save a contact, remember a number, etc.',
    parameters: {
        type: 'object',
        properties: {
            name: {
                type: 'string',
                description: 'The name of the person (e.g., "Carlos Barron")'
            },
            phone: {
                type: 'string',
                description: 'The phone number in E.164 format (e.g., +526562974683)'
            }
        },
        required: ['name', 'phone']
    },
    execute: async (args: { name: string; phone: string }, meta?: { telegramChatId?: number }) => {
        const telegramChatId = meta?.telegramChatId || allowedUserIds[0];

        try {
            await contactsDb.saveContact(telegramChatId, args.name, args.phone);
            return {
                success: true,
                message: `Contacto '${args.name}' guardado correctamente con el número ${args.phone}.`
            };
        } catch (error: any) {
            console.error('[SaveContact] Error:', error);
            return { error: `No se pudo guardar el contacto: ${error.message}` };
        }
    }
};

registerTool(saveContactTool);
