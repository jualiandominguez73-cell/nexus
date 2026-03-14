import Groq from 'groq-sdk';
import { env } from '../config/env.js';
import { getToolsForLLM } from '../tools/index.js';
import { llmSemaphore } from '../agents/concurrency.js';

const groq = new Groq({ apiKey: env.GROQ_API_KEY });
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_VISION_MODEL = 'llama-3.2-11b-vision-preview';

export async function chatCompletion(originalMessages: any[], useFallback = false, toolsOverride?: any[] | undefined) {
    // Acquire semaphore slot (max 5 concurrent LLM calls)
    await llmSemaphore.acquire();
    try {
        return await _chatCompletionInner(originalMessages, useFallback, toolsOverride);
    } finally {
        llmSemaphore.release();
    }
}

async function _chatCompletionInner(originalMessages: any[], useFallback = false, toolsOverride?: any[] | undefined) {
    // If toolsOverride is provided, use it (multi-agent mode). Otherwise load all tools from registry (legacy mode).
    const tools = toolsOverride !== undefined ? (toolsOverride && toolsOverride.length > 0 ? toolsOverride : undefined) : getToolsForLLM();

    // Sanitize messages to avoid Groq/OpenRouter errors
    const messages = originalMessages.map((msg, index) => {
        const newMsg = { ...msg };

        // 1. Remove properties which cause Groq/OpenRouter 400 Bad Request
        if ('refusal' in newMsg) delete newMsg.refusal;
        if ('reasoning' in newMsg) delete newMsg.reasoning;
        if ('provider' in newMsg) delete newMsg.provider;

        // Ensure tool_calls are correctly shaped for OpenRouter
        if (newMsg.role === 'assistant' && newMsg.tool_calls) {
            newMsg.tool_calls = newMsg.tool_calls.map((tc: any) => ({
                id: tc.id,
                type: 'function',
                function: {
                    name: tc.name || tc.function?.name,
                    arguments: typeof tc.arguments === 'string' ? tc.arguments : (tc.function?.arguments || '{}')
                }
            }));
            if (!newMsg.content && newMsg.tool_calls.length > 0) {
                newMsg.content = ""; // OpenRouter sometimes wants content even if tool_calls is present
            }
        }

        // Ensure tool responses have string content
        if (newMsg.role === 'tool') {
            if (typeof newMsg.content !== 'string') {
                newMsg.content = String(newMsg.content);
            }
        }

        // 2. Flatten historical messages with images into plain text strings.
        // We only want to trigger the Vision model if the *latest* message has an image.
        if (index < originalMessages.length - 1 && Array.isArray(newMsg.content)) {
            const flattenedText = newMsg.content.map((part: any) => {
                if (part.type === 'image_url') return '[Imagen Adjuntada Históricamente]';
                if (part.type === 'text') return part.text;
                return '';
            }).join('\n');

            // Re-assign content to be just a flat string instead of an array of parts
            // so we don't accidentally pass malformed media objects to LLMs
            newMsg.content = flattenedText;
        }

        return newMsg;
    });

    // Check if the current (latest) message requires Vision capabilities
    const hasImage = messages.some(msg =>
        Array.isArray(msg.content) && msg.content.some((part: any) => part.type === 'image_url')
    );

    if (hasImage) {
        // Use Vision capable model - Groq vision is currently decommissioned, fallback directly to OpenRouter Gemini
        if (env.OPENROUTER_API_KEY) {
            console.log('[LLM] Vision detected. Using OpenRouter (Gemini)...');
            try {
                // Pass tools because Gemini 2.0 Flash supports tool calling
                return await chatCompletionOpenRouter(messages, tools, 'google/gemini-2.0-flash-001');
            } catch (orError: any) {
                if (orError.message.includes('429') || orError.message.includes('Too Many Requests')) {
                    throw new Error("Límite de velocidad alcanzado en los modelos de visión (OpenRouter). Por favor, intenta de nuevo en un minuto.");
                }
                throw orError;
            }
        } else {
            throw new Error("No hay modelo de visión configurado (OpenRouter Key faltante).");
        }
    }

    if (!useFallback) {
        try {
            const reqBody: any = {
                model: GROQ_MODEL,
                messages,
            };
            if (tools && tools.length > 0) {
                reqBody.tools = tools;
                reqBody.tool_choice = 'auto';
            }
            const response = await groq.chat.completions.create(reqBody);
            return response.choices[0].message;
        } catch (error: any) {
            console.warn('[LLM] Groq text failed. Attempting fallback... Stripping tools to avoid OpenRouter 500 errors.', error.message);
            // Completely strip out tools for the fallback, just answer in text
            return await chatCompletionOpenRouter(messages, null);
        }
    } else {
        return await chatCompletionOpenRouter(messages, tools);
    }
}

async function chatCompletionOpenRouter(messages: any[], tools: any, modelOverride?: string) {
    if (!env.OPENROUTER_API_KEY) throw new Error('OpenRouter API key not configured.');

    // Clone messages to avoid mutating the original array
    const sanitizedMessages = messages.map(m => ({ ...m }));

    // If tools are explicitly disabled/stripped (e.g. during a fallback), forcefully tell the model NOT to hallucinate tools.
    if (!tools || tools.length === 0) {
        let sysMsg = sanitizedMessages.find(m => m.role === 'system');
        if (sysMsg) {
            sysMsg.content += '\n\n[ALERTA DEL SISTEMA]: TUS HERRAMIENTAS ESTAN DESACTIVADAS POR EMERGENCIA. ESTÁS EN MODO DE TEXTO PURO. NO INTENTES USAR ETIQUETAS XML, NI <function>, NI LLAMAR A HERRAMIENTAS. RESPONDE SÓLO CON TEXTO COLOQUIAL Y EXPLICA AL USUARIO QUE TUS SISTEMAS DE ACCION ESTAN EN MANTENIMIENTO POR AHORA.';
        } else {
            sanitizedMessages.unshift({ role: 'system', content: '[ALERTA DEL SISTEMA]: ESTÁS EN MODO DE TEXTO PURO. NO USAR HERRAMIENTAS.' });
        }
    }

    const payload: any = {
        model: modelOverride || env.OPENROUTER_MODEL,
        messages: sanitizedMessages
    };

    if (tools && tools.length > 0) {
        payload.tools = tools;
        // Some models require tool_choice to be provided if tools are present
        payload.tool_choice = 'auto';
    }

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errBody = await response.text();
            console.error(`[OpenRouter API Error] Response: ${errBody}`);

            if (response.status === 429) {
                return { role: 'assistant', content: 'Lo siento, mis servidores de respaldo también están sobrecargados en este momento (Límite de tráfico). Por favor, intenta de nuevo en unos minutos.' };
            }

            // If OpenRouter throws a 500 Internal Server error or a 400 Bad Request, it's often due to complex tool arrays the model doesn't support.
            // Rescue the conversation by stripping tools and asking for a plain text answer.
            if ((response.status === 500 || response.status === 400) && tools && tools.length > 0) {
                console.warn(`[OpenRouter API] Error ${response.status}. Retrying as plain text without tools...`);
                return await chatCompletionOpenRouter(messages, null, modelOverride);
            }

            throw new Error(`OpenRouter API failed: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.error) {
            if (data.error.code === 429) {
                return { role: 'assistant', content: 'Lo siento, mis servidores de respaldo también están sobrecargados en este momento (Límite de tráfico). Por favor, intenta de nuevo en unos minutos.' };
            }

            // Check for OpenRouter format hallucinations where the model used XML instead of JSON for tools
            if (data.error.code === 'tool_use_failed' && tools && tools.length > 0) {
                console.warn(`[OpenRouter API] Model hallucinated tool formatting. Retrying without tools...`);
                return await chatCompletionOpenRouter(messages, null, modelOverride);
            }

            // If it hallucinates tools when NONE were provided, just answer gracefully
            if (data.error.code === 'tool_use_failed' || data.error.message?.includes('tool calls validator')) {
                return { role: 'assistant', content: 'Hubo un fallo de comunicación interno intentando usar unas herramientas sin autorización. Estoy tratando de procesarlo, por favor dime de nuevo qué necesitas pero en otras palabras.' };
            }

            console.error(`[OpenRouter API Explicit Error]:`, JSON.stringify(data.error));
            throw new Error(`OpenRouter API failed: ${data.error.message || 'Unknown error'}`);
        }

        if (!data.choices || data.choices.length === 0) {
            console.error(`[OpenRouter API Empty Choices]:`, JSON.stringify(data));
            throw new Error(`OpenRouter API devolvió una respuesta vacía o con formato inesperado.`);
        }

        return data.choices[0].message;
    } catch (err: any) {
        if (err.message.includes('Too Many Requests') || err.message.includes('429')) {
            return { role: 'assistant', content: 'Lo siento, mis servidores de respaldo también están al máximo de su capacidad (Límite de Red). Dame unos momentos de respiro.' };
        }
        throw new Error(`OpenRouter network or parsing error: ${err.message}`);
    }
}
