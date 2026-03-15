import { chatCompletion } from './llm.js';
import { toolsRegistry, ToolExecutionMeta } from '../tools/index.js';
import { memoryDb } from '../db/memory.js';
import { tenantDb } from '../db/tenant.js';

const MAX_ITERATIONS = 5;

export async function runAgentLoop(threadId: string, userPrompt: string | any[], maxIterations = MAX_ITERATIONS, systemPrompt?: string, meta?: ToolExecutionMeta, tenantId: string = 'default'): Promise<string> {
    // Add user prompt to memory
    await memoryDb.addMessage(threadId, { role: 'user', content: userPrompt }, tenantId);

    for (let i = 0; i < maxIterations; i++) {
        const messages = await memoryDb.getMessages(threadId, 30, tenantId);

        // Core instructions that should NEVER be overridden by custom channel prompts
        const now = new Date();
        const currentTimeString = now.toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'full', timeStyle: 'medium' });

        const coreInstructions = `\n\n[RELOJ INTERNO: ${currentTimeString}]. USA esta información siempre que el usuario hable del tiempo o de programar algo en el futuro.\n\nYou HAVE tools to execute real-world actions like sending emails, sending WhatsApps, making phone calls, and SCHEDULING FUTURE CALLS (schedule_call). DO NOT say you cannot do these things; YOU CAN. ALWAYS use the appropriate tool when asked to communicate externally. Keep answers helpful and concise. Habla siempre en Español.\n\n[AGENDA DE CONTACTOS]\n- Noe (o Noé): +526562173335\n- Usa esta agenda para deducir el número de teléfono cuando el usuario te pida llamar o mandar mensaje a alguien por su nombre sin darte su número.`;

        // Dynamic Tenant System Prompt Injection
        const tenant = await tenantDb.getTenant(tenantId);

        // 1. If explicit prompt is passed (e.g. from WhatsApp/Outbound calls), use it.
        // 2. Otherwise use the Tenant's master prompt.
        // 3. Otherwise use the default NEXUS prompt.
        let finalSystemPrompt = systemPrompt || tenant?.systemPromptMaster || 'You are NEXUS Tech Hub, a highly capable AI assistant.';
        const basePrompt = finalSystemPrompt + coreInstructions;

        // Inject system instructions dynamically
        const messagesToSent = [
            {
                role: 'system',
                content: basePrompt
            },
            ...messages
        ];

        const assistantMessage = await chatCompletion(messagesToSent, false, undefined, tenantId);
        await memoryDb.addMessage(threadId, assistantMessage, tenantId);

        // If there are tool calls, execute them and continue the loop
        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
            for (const toolCall of assistantMessage.tool_calls) {
                const functionName = toolCall.function.name;
                const tool = toolsRegistry.get(functionName);

                let toolResultStr = '';
                try {
                    if (!tool) throw new Error(`Tool ${functionName} not found`);

                    const executionMeta = meta || {};
                    executionMeta.tenantId = tenantId;

                    const args = JSON.parse(toolCall.function.arguments || '{}');
                    const result = await tool.execute(args, executionMeta);
                    toolResultStr = JSON.stringify(result);
                } catch (err: any) {
                    toolResultStr = JSON.stringify({ error: err.message });
                }

                await memoryDb.addMessage(threadId, {
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    name: functionName,
                    content: toolResultStr
                }, tenantId);
            }
            // Continue loop: the LLM will see the tool output on the next iteration
        } else {
            // No more tools, generation is complete
            return assistantMessage.content || "No output generated.";
        }
    }

    return "I've reached my thinking limit (max iterations) and couldn't resolve the request fully.";
}
