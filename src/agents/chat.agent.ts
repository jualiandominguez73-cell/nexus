import { BaseAgent } from './base-agent.js';

/**
 * Chat Agent — General conversation, no tools.
 * Cheapest possible: small system prompt, zero tool definitions.
 */
export const chatAgent = new BaseAgent({
    name: 'chat',
    systemPrompt: [
        'Eres NEXUS, un asistente personal de IA amigable e inteligente.',
        'Responde de forma concisa, util y conversacional.',
        'Si el usuario te pide hacer algo que requiere herramientas (enviar mensajes, hacer llamadas, buscar correos, agendar citas), dile que puede pedirtelo directamente y lo haras.',
        'No inventes que no puedes hacer cosas — tienes capacidades de comunicacion, agenda y workspace, solo que en este momento estas en modo conversacion.',
    ].join(' '),
    toolNames: [],
    maxIterations: 1,
    timeoutMs: 15000,
});
