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

    if (!useFallback && !hasImage) {
        try {
            const response = await groq.chat.completions.create({
                model: GROQ_MODEL,
                messages,
                tools,
                tool_choice: 'auto'
            });
            return response.choices[0].message;
        } catch (error) {
            console.warn('Groq API failed. Attempting fallback...', error);
            return await chatCompletionOpenRouter(messages, tools);
        }
    } else if (hasImage) {
        // Use Vision capable model
        try {
            console.log('Vision detected, using vision-capable model...');
            // We can try Groq's vision model or go straight to OpenRouter (Gemini is usually better for vision)
            if (env.OPENROUTER_API_KEY) {
                return await chatCompletionOpenRouter(messages, tools);
            }
            const response = await groq.chat.completions.create({
                model: GROQ_VISION_MODEL,
                messages,
                // Groq vision models might have limited tool support, so we skip tools for vision for now if on Groq
            });
            return response.choices[0].message;
        } catch (error) {
            console.error('Vision completion failed:', error);
            throw error;
        }
    } else {
        return await chatCompletionOpenRouter(messages, tools);
    }
}

async function chatCompletionOpenRouter(messages: any[], tools: any) {
    if (!env.OPENROUTER_API_KEY) throw new Error('OpenRouter API key not configured.');

    const payload: any = {
        model: env.OPENROUTER_MODEL,
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
