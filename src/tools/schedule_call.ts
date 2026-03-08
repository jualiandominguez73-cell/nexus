import { registerTool } from './index.js';
import { queueDb } from '../db/queue.js';
import { allowedUserIds } from '../config/env.js';

const tool = {
    name: 'schedule_call',
    description: 'Programa una llamada telefónica saliente (Outbound Call) automática para el futuro. Usa esta herramienta SÓLO si el usuario te pide explícitamente que le marques "más al rato", "mañana" o a una hora específica.',
    parameters: {
        type: 'object',
        properties: {
            to: {
                type: 'string',
                description: 'El número de teléfono destino en formato E.164 (ej. +52...). Usa tu agenda para resolver nombres.'
            },
            objective: {
                type: 'string',
                description: 'Objetivo de la llamada que NEXUS debe cumplir.'
            },
            minutes_from_now: {
                type: 'number',
                description: 'Cuántos minutos a partir del momento exacto actual faltan para que suene la alarma de esta llamada. Haz las matemáticas necesarias basándote en la hora (RELOJ INTERNO) que se te proporcionó en tus instrucciones.'
            }
        },
        required: ['to', 'objective', 'minutes_from_now']
    },
    execute: async (args: { to: string, objective: string, minutes_from_now: number }, meta?: { telegramChatId?: number }) => {
        try {
            if (args.minutes_from_now <= 0) {
                return `Error: Los minutos (minutes_from_now) deben ser positivos y estar en el futuro.`;
            }

            const telegramChatId = meta?.telegramChatId || allowedUserIds[0];
            const targetTime = new Date(Date.now() + args.minutes_from_now * 60000);

            const taskId = await queueDb.addTask({
                type: 'make_call',
                scheduledTime: targetTime,
                payload: {
                    to: args.to,
                    objective: args.objective,
                    telegramChatId
                }
            });

            const timeFormatted = targetTime.toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

            return `¡Misión agendada! Acabo de programar internamente la llamada (ID: ${taskId}). Esta se ejecutará en automático 100% sola cuando sean exactamente las ${timeFormatted}. No necesito hacer nada más por ahora.`;
        } catch (e: any) {
            console.error('[Schedule Call Tool Error]:', e);
            return `Error crítico al guardar la tarea en base de datos: ${e.message}`;
        }
    }
};

registerTool(tool);
