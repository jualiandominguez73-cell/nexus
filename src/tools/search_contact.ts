import { registerTool, Tool } from './index.js';
import { contactsDb } from '../db/contacts.js';
import { allowedUserIds } from '../config/env.js';

const searchContactTool: Tool = {
    name: 'search_contact',
    description: 'Búsqueda de contactos en la base de datos por nombre (ej. "Carlos Barron"). Devuelve el número para marcarle, enviar archivo, o enviarle WhatsApp si el usuario te lo pide usando solo el nombre.',
    parameters: {
        type: 'object',
        properties: {
            name: {
                type: 'string',
                description: 'The exact or approximate name of the person saved (e.g., "Carlos Barron")'
            }
        },
        required: ['name']
    },
    execute: async (args: { name: string }, meta?: { telegramChatId?: number }) => {
        const telegramChatId = meta?.telegramChatId || allowedUserIds[0];

        try {
            // First try an exact match
            let result = await contactsDb.getContactByName(telegramChatId, args.name);

            if (result) {
                return {
                    success: true,
                    name: result.name,
                    phone: result.phone,
                    message: `Encontrado: ${result.name} - ${result.phone}`
                };
            }

            // Fallback to searching all contacts if not exact match
            const allContacts = await contactsDb.getAllContacts(telegramChatId);
            const matches = allContacts.filter(c => c.name.toLowerCase().includes(args.name.toLowerCase()));

            if (matches.length > 0) {
                return {
                    success: true,
                    message: "Aproximaciones encontradas.",
                    matches: matches.map(c => ({ name: c.name, phone: c.phone }))
                };
            }

            return { success: false, message: `El contacto "${args.name}" no está guardado en tu libreta.` };
        } catch (error: any) {
            console.error('[SearchContact] Error:', error);
            return { error: `No se pudo buscar el contacto: ${error.message}` };
        }
    }
};

registerTool(searchContactTool);
