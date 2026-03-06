import { Tool, registerTool } from './index.js';

const getCurrentTime: Tool = {
    name: 'get_current_time',
    description: 'Returns the current server time and date along with the timezone.',
    parameters: {
        type: 'object',
        properties: {},
        required: []
    },
    execute: async () => {
        return {
            currentTime: new Date().toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        };
    }
};

registerTool(getCurrentTime);
