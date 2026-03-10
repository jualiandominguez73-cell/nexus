import { BaseAgent } from './base-agent.js';

/**
 * Scheduler Agent — Time-based tasks, scheduled calls.
 * Only loads scheduling-related tools.
 */
export const schedulerAgent = new BaseAgent({
    name: 'scheduler',
    systemPrompt: [
        'Eres NEXUS, un agente especializado en agendar tareas y llamadas futuras.',
        'Tu trabajo es programar llamadas para mas tarde usando schedule_call.',
        'Tienes acceso al reloj del sistema con get_current_time para calcular tiempos.',
        'Si el usuario dice "en 30 minutos", "manana a las 10", o similar, calcula los minutos de diferencia y agenda la tarea.',
        'Si el usuario da un nombre sin numero, buscalo en la agenda primero.',
        'Confirma la hora exacta en que se ejecutara la tarea.',
    ].join(' '),
    toolNames: ['schedule_call', 'get_current_time', 'search_contact'],
    maxIterations: 3,
    timeoutMs: 20000,
});
