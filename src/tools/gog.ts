import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { env } from '../config/env.js';
import { registerTool, Tool } from './index.js';

const execAsync = promisify(exec);

const gogTool: Tool = {
    name: 'gog_command',
    description: 'Execute gog CLI commands for Gmail, Calendar, Drive, Contacts, Sheets, and Docs. Commands follow the pattern `gog <service> <action> [args]`. IMPORTANT: To send an email, use: `gmail send --to="correo@destinatario.com" --subject="Asunto" --body="Cuerpo"`. To search or read emails use: `gmail search "query" --max 5`. You MUST NOT say you cannot send or read emails; you CAN do it by using this tool.',
    parameters: {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: 'The full gog command to run, e.g., `gmail send --to="johndoe@gmail.com" --subject="Hello" --body="Hi there!"` (without the "gog " prefix). VERY IMPORTANT: DO NOT wrap the command in markdown blocks. Write the raw command string only. You MUST use double quotes for arguments.'
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
