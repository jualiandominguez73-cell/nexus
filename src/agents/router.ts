import Groq from 'groq-sdk';
import { env } from '../config/env.js';
import { ToolExecutionMeta } from '../tools/index.js';
import { chatAgent } from './chat.agent.js';
import { commsAgent } from './comms.agent.js';
import { voiceAgent } from './voice.agent.js';
import { schedulerAgent } from './scheduler.agent.js';
import { workspaceAgent } from './workspace.agent.js';
import { BaseAgent } from './base-agent.js';

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

/**
 * LRU cache for LLM classification results.
 * Avoids re-classifying identical or near-identical messages.
 * Max 100 entries, entries expire after 10 minutes.
 */
const classifyCache = new Map<string, { agent: string; ts: number }>();
const CACHE_MAX = 100;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCachedClassification(text: string): string | null {
    const key = text.toLowerCase().trim();
    const entry = classifyCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL) {
        classifyCache.delete(key);
        return null;
    }
    return entry.agent;
}

function setCachedClassification(text: string, agent: string) {
    const key = text.toLowerCase().trim();
    // Evict oldest if full
    if (classifyCache.size >= CACHE_MAX) {
        const oldest = classifyCache.keys().next().value;
        if (oldest !== undefined) classifyCache.delete(oldest);
    }
    classifyCache.set(key, { agent, ts: Date.now() });
}

/** Available agents by key */
const agents: Record<string, BaseAgent> = {
    chat: chatAgent,
    comms: commsAgent,
    voice: voiceAgent,
    scheduler: schedulerAgent,
    workspace: workspaceAgent,
};

/**
 * Classification prompt for the router.
 * The router is a tiny, fast model that only picks which agent handles the request.
 * It receives NO tools — just the user's message and a menu of agents.
 */
const ROUTER_SYSTEM_PROMPT = `You are an intent classifier for the NEXUS AI assistant. Your ONLY job is to read the user's message and return a JSON object picking the best agent.

Available agents:
- "chat": General conversation, greetings, questions, jokes, opinions, advice, anything that does NOT require an external action.
- "comms": Sending WhatsApp messages, saving contacts, searching contacts.
- "voice": Making phone calls, translated/bilingual calls.
- "scheduler": Scheduling future calls or tasks ("call X in 30 minutes", "remind me tomorrow").
- "workspace": Gmail (read/send email), Google Calendar (events), Google Drive (search files), Sheets, Docs, Contacts.

Rules:
- If the message is a greeting, small talk, or general question, return "chat".
- If the user wants to SEND a message via WhatsApp, return "comms".
- If the user wants to MAKE A CALL right now, return "voice".
- If the user wants to SCHEDULE a call or task for later, return "scheduler".
- If the user mentions email, calendar, drive, sheets, or docs, return "workspace".
- If the user shares a contact (phone number + name) and wants to save it, return "comms".
- If ambiguous, prefer "chat".

RESPOND WITH ONLY a JSON object, no markdown, no explanation:
{"agent": "chat"}`;

/**
 * Keyword-based pre-routing. Resolves ~60-70% of intents without an LLM call.
 * Returns an agent key if confident, or null to fall through to the LLM classifier.
 */
function classifyByKeywords(text: string): string | null {
    const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // strip accents

    // Workspace — Gmail, Calendar, Drive, Sheets, Docs
    if (/\b(correo|email|gmail|e-mail|inbox|bandeja)\b/.test(t)) return 'workspace';
    if (/\b(calendar|calendario|evento|cita|reunion)\b/.test(t)) return 'workspace';
    if (/\b(drive|archivo|documento|sheets|hoja de calculo|docs)\b/.test(t)) return 'workspace';

    // Scheduler — future tasks (must check BEFORE voice to catch "llama en 30 minutos")
    if (/\b(agenda|programa|recuerda|en \d+ minuto|dentro de \d+|manana a las|pasado manana)\b/.test(t)) return 'scheduler';
    if (/\b(llam[ae].*(?:en \d|manana|luego|despues|a las))\b/.test(t)) return 'scheduler';

    // Voice — immediate calls
    if (/\b(llama|marca|llamada|telefono|telefonea|marcar)\b/.test(t) && !/whatsapp|mensaje/i.test(t)) return 'voice';
    if (/\b(llamada traducida|traduccion|bilingue|interprete)\b/.test(t)) return 'voice';

    // Comms — WhatsApp, contacts
    if (/\b(whatsapp|whats|wsp|mensaje|manda.*mensaje|envia.*mensaje)\b/.test(t)) return 'comms';
    if (/\b(guarda.*contacto|guardar.*contacto|nuevo contacto|agregar contacto)\b/.test(t)) return 'comms';
    if (/\b(busca.*contacto|buscar.*contacto|numero de)\b/.test(t)) return 'comms';

    // No confident match — fall through to LLM
    return null;
}

/**
 * Extract text from a user prompt that may be a string or multipart content.
 */
function extractText(userPrompt: string | any[]): string {
    if (typeof userPrompt === 'string') return userPrompt;
    if (Array.isArray(userPrompt)) {
        return userPrompt
            .filter((p: any) => p.type === 'text')
            .map((p: any) => p.text)
            .join(' ');
    }
    return String(userPrompt);
}

/**
 * Check if the prompt contains image content (needs vision, bypass router).
 */
function hasImage(userPrompt: string | any[]): boolean {
    if (!Array.isArray(userPrompt)) return false;
    return userPrompt.some((p: any) => p.type === 'image_url');
}

/**
 * Classify intent using a tiny fast model.
 * Returns the agent key ("chat", "comms", "voice", "scheduler", "workspace").
 */
async function classify(userText: string): Promise<string> {
    // Check cache first
    const cached = getCachedClassification(userText);
    if (cached) {
        console.log(`[Router] Cache hit → "${cached}"`);
        return cached;
    }

    try {
        const response = await groq.chat.completions.create({
            model: env.ROUTER_MODEL,
            messages: [
                { role: 'system', content: ROUTER_SYSTEM_PROMPT },
                { role: 'user', content: userText },
            ],
            temperature: 0,
            max_tokens: 50,
        });

        const raw = response.choices[0]?.message?.content?.trim() || '';
        console.log(`[Router] Raw classification: ${raw}`);

        const jsonStr = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(jsonStr);
        const agentKey = parsed.agent || 'chat';

        if (agents[agentKey]) {
            setCachedClassification(userText, agentKey);
            return agentKey;
        }

        console.warn(`[Router] Unknown agent key "${agentKey}", defaulting to chat`);
        return 'chat';
    } catch (err: any) {
        console.error(`[Router] Classification failed: ${err.message}. Defaulting to chat.`);
        return 'chat';
    }
}

/**
 * Check if the agent's response indicates it couldn't fulfill the request.
 * If so, the router should try a different agent.
 */
function needsReroute(response: string): boolean {
    const t = response.toLowerCase();
    const failureSignals = [
        'no tengo acceso',
        'no puedo hacer eso',
        'no cuento con',
        'no tengo la herramienta',
        'no estoy autorizado',
        'fuera de mis capacidades',
        'no tengo esa funcion',
        'tool not found',
        'not authorized for agent',
    ];
    return failureSignals.some(signal => t.includes(signal));
}

/**
 * Main dispatcher: classifies the message and routes to the right specialist agent.
 */
export async function dispatch(
    threadId: string,
    userPrompt: string | any[],
    meta?: ToolExecutionMeta,
    systemPromptOverride?: string
): Promise<string> {
    // If prompt has images, route to chat (vision is handled at LLM level)
    if (hasImage(userPrompt)) {
        console.log('[Router] Image detected, routing to chat agent');
        return chatAgent.run(threadId, userPrompt, meta);
    }

    const userText = extractText(userPrompt);
    if (!userText.trim()) {
        return chatAgent.run(threadId, userPrompt, meta);
    }

    // Step 1: Try keyword-based routing (free, instant, no tokens)
    const keywordMatch = classifyByKeywords(userText);
    let agentKey = keywordMatch || await classify(userText);
    const method = keywordMatch ? 'Keyword' : 'LLM';

    console.log(`[Router] ${method} → "${agentKey}" for: "${userText.substring(0, 80)}..."`);

    // Step 2: Run the agent
    const response = await agents[agentKey].run(threadId, userPrompt, meta);

    // Step 3: Re-routing check — if the agent couldn't help, try a different one
    if (needsReroute(response) && agentKey !== 'chat') {
        console.log(`[Router] Agent "${agentKey}" couldn't help. Re-routing to chat as fallback.`);
        return chatAgent.run(threadId, userPrompt, meta);
    }

    return response;
}

/**
 * Get an agent by name (for direct invocation from server endpoints).
 */
export function getAgent(name: string): BaseAgent | undefined {
    return agents[name];
}
