import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { env } from '../config/env.js';
import { registerTool, Tool } from './index.js';

const execAsync = promisify(exec);

const gogTool: Tool = {
    name: 'gog_command',
    description: 'Execute gog CLI commands for Gmail, Calendar, Drive, Contacts, Sheets, and Docs. Commands follow the pattern `gog <service> <action> [args]`. IMPORTANT: To send an email, strictly use this format: `gmail send --to="correo@destinatario.com" --subject="El Asunto" --body="El contenido del mensaje"`. Do NOT say you cannot send emails; use the tool.',
    parameters: {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: 'The full gog command to run, e.g., `gmail search newer_than:1d --max 5` or `gmail send --to="johndoe@gmail.com" --subject="Hello" --body="Hi there!"` (without the "gog " prefix)'
            }
        },
        required: ['command']
    },
    execute: async ({ command }) => {
        try {
            // Determine binary path (local bin folder)
            const binDir = join(process.cwd(), 'bin');
            const gogPath = process.platform === 'win32' ? join(binDir, 'gog.exe') : join(binDir, 'gog');

            console.log(`[GOG] Executing: ${gogPath} ${command}`);
            const { stdout, stderr } = await execAsync(`"${gogPath}" ${command}`);

            if (stderr && !stdout) {
                return { error: stderr };
            }

            return { output: stdout || 'Command executed successfully.' };
        } catch (error: any) {
            console.error('[GOG Error]:', error);
            return { error: error.message };
        }
    }
};

registerTool(gogTool);
