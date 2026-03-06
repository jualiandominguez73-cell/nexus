import { chatCompletion } from './llm.js';
import { toolsRegistry } from '../tools/index.js';
import { memoryDb } from '../db/memory.js';

const MAX_ITERATIONS = 5;

export async function runAgentLoop(threadId: string, userPrompt: string | any[], maxIterations = MAX_ITERATIONS, systemPrompt?: string): Promise<string> {
    // Add user prompt to memory
    await memoryDb.addMessage(threadId, { role: 'user', content: userPrompt });

    for (let i = 0; i < maxIterations; i++) {
        const messages = await memoryDb.getMessages(threadId);

        // Inject system instructions dynamically
        const messagesToSent = [
            {
                role: 'system',
                content: systemPrompt || 'You are NEXUS Tech Hub, a highly capable AI assistant on Telegram. You can see images and listen to voice messages. For images, describe what you see in detail if asked. Keep answers helpful and concise.'
            },
            ...messages
        ];

        const assistantMessage = await chatCompletion(messagesToSent);
        await memoryDb.addMessage(threadId, assistantMessage);

        // If there are tool calls, execute them and continue the loop
        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
            for (const toolCall of assistantMessage.tool_calls) {
                const functionName = toolCall.function.name;
                const tool = toolsRegistry.get(functionName);

                let toolResultStr = '';
                try {
                    if (!tool) throw new Error(`Tool ${functionName} not found`);
                    const args = JSON.parse(toolCall.function.arguments || '{}');
                    const result = await tool.execute(args);
                    toolResultStr = JSON.stringify(result);
                } catch (err: any) {
                    toolResultStr = JSON.stringify({ error: err.message });
                }

                await memoryDb.addMessage(threadId, {
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    name: functionName,
                    content: toolResultStr
                });
            }
            // Continue loop: the LLM will see the tool output on the next iteration
        } else {
            // No more tools, generation is complete
            return assistantMessage.content || "No output generated.";
        }
    }

    return "I've reached my thinking limit (max iterations) and couldn't resolve the request fully.";
}
