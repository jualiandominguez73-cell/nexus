import Groq from 'groq-sdk';
import { env } from '../config/env.js';
import { getToolsForLLM } from '../tools/index.js';

const groq = new Groq({ apiKey: env.GROQ_API_KEY });
const GROQ_MODEL = 'llama-3.3-70b-versatile'; // Or any preferred Groq free capability model

export async function chatCompletion(messages: any[], useFallback = false) {
    const tools = getToolsForLLM();

    if (!useFallback) {
        try {
            const response = await groq.chat.completions.create({
                model: GROQ_MODEL,
                messages,
                tools,
                tool_choice: 'auto'
            });
            return response.choices[0].message;
        } catch (error) {
            console.warn('Groq API failed. Attempting fallback if OpenRouter is configured...', error);
            if (env.OPENROUTER_API_KEY) {
                return await chatCompletionOpenRouter(messages, tools);
            }
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
