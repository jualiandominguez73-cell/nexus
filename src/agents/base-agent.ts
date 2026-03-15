import { chatCompletion } from '../agent/llm.js';
import { toolsRegistry, ToolExecutionMeta } from '../tools/index.js';
import { memoryDb } from '../db/memory.js';
import { contactsDb } from '../db/contacts.js';
import { withTimeout } from './concurrency.js';

export interface AgentConfig {
    /** Unique name for logging */
    name: string;
    /** System prompt specific to this agent's role */
    systemPrompt: string;
    /** Which tool names this agent has access to (empty = no tools) */
    toolNames: string[];
    /** Max LLM iterations for tool-use loops */
    maxIterations: number;
    /** Timeout in ms for the entire agent run (default: 30000) */
    timeoutMs?: number;
}

/**
 * Base agent that runs a focused agent loop with only its assigned tools.
 * Each specialist agent extends this with its own config.
 */
export class BaseAgent {
    readonly config: AgentConfig;

    constructor(config: AgentConfig) {
        this.config = config;
    }

    /**
     * Build the tools array for this agent only (filtered from global registry).
     */
    private getTools() {
        if (this.config.toolNames.length === 0) return undefined;

        const tools: any[] = [];
        for (const name of this.config.toolNames) {
            const tool = toolsRegistry.get(name);
            if (tool) {
                tools.push({
                    type: 'function' as const,
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.parameters,
                    },
                });
            }
        }
        return tools.length > 0 ? tools : undefined;
    }

    /**
     * Build the full system prompt with time context and optional contacts.
     */
    protected async buildSystemPrompt(meta?: ToolExecutionMeta, tenantId: string = 'default'): Promise<string> {
        const now = new Date();
        const timeStr = now.toLocaleString('es-MX', {
            timeZone: 'America/Mexico_City',
            dateStyle: 'full',
            timeStyle: 'medium',
        });

        let prompt = this.config.systemPrompt;
        prompt += `\n\n[RELOJ INTERNO: ${timeStr}]`;
        prompt += `\nHabla siempre en Espanol.`;

        // Load contacts if available and agent has comms/voice tools
        if (meta?.telegramChatId && this.config.toolNames.length > 0) {
            try {
                const contacts = await contactsDb.getAllContacts(meta.telegramChatId, tenantId);
                if (contacts.length > 0) {
                    const contactList = contacts.map(c => `- ${c.name}: ${c.phone}`).join('\n');
                    prompt += `\n\n[AGENDA DE CONTACTOS]\n${contactList}\n- Usa esta agenda para deducir el numero de telefono cuando el usuario te pida llamar o mandar mensaje a alguien por su nombre.`;
                }
            } catch {
                // Contacts not critical, continue without them
            }
        }

        return prompt;
    }

    /**
     * Run the agent loop with only this agent's tools and system prompt.
     * Uses a namespaced threadId to isolate memory per agent.
     */
    async run(
        baseThreadId: string,
        userPrompt: string | any[],
        meta?: ToolExecutionMeta,
        tenantId: string = 'default'
    ): Promise<string> {
        const timeoutMs = this.config.timeoutMs ?? 30000;
        try {
            return await withTimeout(
                this._runLoop(baseThreadId, userPrompt, meta, tenantId),
                timeoutMs,
                `Agent ${this.config.name}`
            );
        } catch (err: any) {
            if (err.message.includes('timed out')) {
                console.error(`[${this.config.name}] Timed out after ${timeoutMs}ms`);
                return 'Lo siento, tarde demasiado en procesar tu solicitud. Intenta de nuevo.';
            }
            throw err;
        }
    }

    private async _runLoop(
        baseThreadId: string,
        userPrompt: string | any[],
        meta?: ToolExecutionMeta,
        tenantId: string = 'default'
    ): Promise<string> {
        const threadId = `${baseThreadId}_${this.config.name}`;
        const systemPrompt = await this.buildSystemPrompt(meta, tenantId);
        const tools = this.getTools();

        console.log(`[${this.config.name}] Starting loop (tools: ${this.config.toolNames.length}, maxIter: ${this.config.maxIterations})`);

        // Store user message in this agent's thread
        await memoryDb.addMessage(threadId, { role: 'user', content: userPrompt }, tenantId);

        for (let i = 0; i < this.config.maxIterations; i++) {
            const messages = await memoryDb.getMessages(threadId, 30, tenantId);

            const fullMessages = [
                { role: 'system', content: systemPrompt },
                ...messages,
            ];

            const assistantMessage = await chatCompletion(fullMessages, false, tools);
            await memoryDb.addMessage(threadId, assistantMessage, tenantId);

            if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
                for (const toolCall of assistantMessage.tool_calls) {
                    const functionName = toolCall.function.name;
                    const tool = toolsRegistry.get(functionName);

                    let toolResultStr = '';
                    try {
                        if (!tool) throw new Error(`Tool ${functionName} not found`);
                        if (!this.config.toolNames.includes(functionName)) {
                            throw new Error(`Tool ${functionName} is not authorized for agent ${this.config.name}`);
                        }
                        const args = JSON.parse(toolCall.function.arguments || '{}');
                        const result = await tool.execute(args, meta);
                        toolResultStr = JSON.stringify(result);
                    } catch (err: any) {
                        toolResultStr = JSON.stringify({ error: err.message });
                    }

                    await memoryDb.addMessage(threadId, {
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        name: functionName,
                        content: toolResultStr,
                    }, tenantId);
                }
            } else {
                const response = assistantMessage.content || 'No output generated.';
                console.log(`[${this.config.name}] Finished in ${i + 1} iteration(s)`);
                return response;
            }
        }

        console.warn(`[${this.config.name}] Hit max iterations (${this.config.maxIterations})`);
        return 'Alcance mi limite de procesamiento para esta solicitud.';
    }
}
