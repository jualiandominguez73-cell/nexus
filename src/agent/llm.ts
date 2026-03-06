import Groq from 'groq-sdk';
import { env } from '../config/env.js';
import { getToolsForLLM } from '../tools/index.js';

const groq = new Groq({ apiKey: env.GROQ_API_KEY });
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_VISION_MODEL = 'llama-3.2-11b-vision-preview';

export async function chatCompletion(messages: any[], useFallback = false) {
    const tools = getToolsForLLM();

    // Check if any message contains an image_url
    const hasImage = messages.some(msg =>
        Array.isArray(msg.content) && msg.content.some((part: any) => part.type === 'image_url')
    );

    if (hasImage) {
        // Use Vision capable model - Prioritize Groq Vision for stability/speed
        try {
            console.log(`[LLM] Vision detected. Using Groq: ${GROQ_VISION_MODEL}`);
            const response = await groq.chat.completions.create({
                model: GROQ_VISION_MODEL,
                messages,
                max_tokens: 1024,
                // Do NOT pass tools for vision requests to avoid 404/Not Supported errors
            });
            return response.choices[0].message;
        } catch (error: any) {
            console.warn('[LLM] Groq Vision failed or rate limited:', error.message);

            // Fallback to OpenRouter if Groq fails
            if (env.OPENROUTER_API_KEY) {
                console.log('[LLM] Falling back to OpenRouter for Vision...');
                try {
                    // Try a specific, reliable vision model on OpenRouter as fallback
                    return await chatCompletionOpenRouter(messages, null, 'google/gemini-2.0-flash-001:free');
                } catch (orError: any) {
                    if (orError.message.includes('429') || orError.message.includes('Too Many Requests')) {
                        throw new Error("Límite de velocidad alcanzado en los modelos de visión (Groq y OpenRouter). Por favor, intenta de nuevo en un minuto.");
                    }
                    throw orError;
                }
            }
            throw error;
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
        throw new Error(`OpenRouter API failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message;
}
