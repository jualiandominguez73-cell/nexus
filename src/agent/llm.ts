import Groq from 'groq-sdk';
import { env } from '../config/env.js';
import { getToolsForLLM } from '../tools/index.js';

const groq = new Groq({ apiKey: env.GROQ_API_KEY });
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_VISION_MODEL = 'llama-3.2-11b-vision-preview';

export async function chatCompletion(originalMessages: any[], useFallback = false) {
    const tools = getToolsForLLM();

    // Sanitize messages to avoid Groq/OpenRouter errors
    const messages = originalMessages.map((msg, index) => {
        const newMsg = { ...msg };

        // 1. Remove 'refusal' properties which cause Groq 400 Bad Request
        if ('refusal' in newMsg) {
            delete newMsg.refusal;
        }

        // 2. Flatten historical messages with images into plain text strings.
        // We only want to trigger the Vision model if the *latest* message has an image.
        if (index < originalMessages.length - 1 && Array.isArray(newMsg.content)) {
            newMsg.content = newMsg.content.map((part: any) => {
                if (part.type === 'image_url') return '[Imagen Adjuntada Históricamente]';
                if (part.type === 'text') return part.text;
                return '';
            }).join('\n');
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
                // Remove tools from messages if we send them to Vision to avoid errors
                return await chatCompletionOpenRouter(messages, null, 'google/gemini-2.0-flash-001');
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
            const response = await groq.chat.completions.create({
                model: GROQ_MODEL,
                messages,
                tools,
                tool_choice: 'auto'
            });
            return response.choices[0].message;
        } catch (error: any) {
            console.warn('[LLM] Groq text failed. Attempting fallback...', error.message);
            return await chatCompletionOpenRouter(messages, tools);
        }
    } else {
        return await chatCompletionOpenRouter(messages, tools);
    }
}

async function chatCompletionOpenRouter(messages: any[], tools: any, modelOverride?: string) {
    if (!env.OPENROUTER_API_KEY) throw new Error('OpenRouter API key not configured.');

    const payload: any = {
        model: modelOverride || env.OPENROUTER_MODEL,
        messages
    };

    if (tools) {
        payload.tools = tools;
    }

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
        throw new Error(`OpenRouter API failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message;
}
