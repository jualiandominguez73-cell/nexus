export interface ToolExecutionMeta {
    telegramChatId?: number;
}
import './get_current_time.js';
import './schedule_call.js';
import './send_whatsapp.js';
import './translate_call.js';

export interface Tool {
    name: string;
    description: string;
    parameters: Record<string, any>;
    execute: (args: any, meta?: ToolExecutionMeta) => Promise<any> | any;
}

export const toolsRegistry = new Map<string, Tool>();

export function registerTool(tool: Tool) {
    toolsRegistry.set(tool.name, tool);
}

// Convert registered tools for the formatted LLM specifications
export function getToolsForLLM() {
    const tools = Array.from(toolsRegistry.values());
    if (tools.length === 0) return undefined;

    return tools.map(tool => ({
        type: 'function' as const,
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
        }
    }));
}
