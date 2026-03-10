import { BaseAgent } from './base-agent.js';

/**
 * Communications Agent — WhatsApp, contacts.
 * Only loads communication-related tools.
 */
export const commsAgent = new BaseAgent({
    name: 'comms',
    systemPrompt: [
        'Eres NEXUS, un agente especializado en comunicaciones.',
        'Tu trabajo es enviar mensajes de WhatsApp y gestionar la agenda de contactos del usuario.',
        'Cuando te pidan enviar un mensaje, usa la herramienta send_whatsapp_message.',
        'Cuando te pidan guardar un contacto, usa save_contact.',
        'Cuando te pidan buscar un contacto, usa search_contact.',
        'Si el usuario da un nombre sin numero, busca primero en la agenda.',
        'Se breve y confirma cuando hayas completado la accion.',
    ].join(' '),
    toolNames: ['send_whatsapp_message', 'save_contact', 'search_contact'],
    maxIterations: 3,
    timeoutMs: 25000,
});
