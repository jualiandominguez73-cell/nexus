import { queueDb } from './db/queue.js';
import { toolsRegistry } from './tools/index.js';
import { readdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let cronRunning = false;
let intervalId: NodeJS.Timeout | null = null;
let cleanupCounter = 0;

/**
 * Clean up orphaned audio files older than 10 minutes in tmpdir.
 * Runs every ~5 minutes (every 10th cron tick at 30s intervals).
 */
function cleanupTempFiles() {
    try {
        const tmp = tmpdir();
        const now = Date.now();
        const maxAge = 10 * 60 * 1000; // 10 minutes
        const patterns = /\.(wav|ogg|mp3|mp4)$/;
        const prefixes = ['voice_', 'twilio_', 'outbound_', 'wa_audio_', 'response_', 'tts_'];

        const files = readdirSync(tmp);
        let cleaned = 0;

        for (const file of files) {
            if (!patterns.test(file)) continue;
            if (!prefixes.some(p => file.startsWith(p))) continue;

            const fullPath = join(tmp, file);
            try {
                const stat = statSync(fullPath);
                if (now - stat.mtimeMs > maxAge) {
                    unlinkSync(fullPath);
                    cleaned++;
                }
            } catch {
                // File may have been deleted by another process
            }
        }

        if (cleaned > 0) {
            console.log(`[Cron] Cleaned ${cleaned} orphaned temp audio file(s)`);
        }
    } catch (err) {
        console.error('[Cron] Temp cleanup error:', err);
    }
}

export function startCron() {
    if (cronRunning) return;
    cronRunning = true;

    console.log('[Cron] Job Scheduler started. Checking for pending tasks every 30 seconds.');

    // Check every 30 seconds
    intervalId = setInterval(async () => {
        try {
            // Scheduled tasks
            const pending = await queueDb.getPendingTasks();
            if (pending.length > 0) {
                console.log(`[Cron] Found ${pending.length} pending task(s). Executing...`);
                for (const task of pending) {
                    try {
                        console.log(`[Cron] Executing task ${task.id} of type ${task.type}`);

                        if (task.type === 'make_call') {
                            const makeCallTool = toolsRegistry.get('make_call');
                            if (makeCallTool) {
                                await makeCallTool.execute(task.payload, { telegramChatId: task.payload.telegramChatId });
                                await queueDb.markTaskComplete(task.id!, 'completed');
                            } else {
                                console.error('[Cron] make_call tool not found in registry');
                            }
                        }
                    } catch (taskErr) {
                        console.error(`[Cron] Error executing task ${task.id}:`, taskErr);
                        await queueDb.markTaskComplete(task.id!, 'failed');
                    }
                }
            }

            // Temp file cleanup every ~5 minutes (every 10th tick)
            cleanupCounter++;
            if (cleanupCounter >= 10) {
                cleanupCounter = 0;
                cleanupTempFiles();
            }
        } catch (err) {
            console.error('[Cron Error]:', err);
        }
    }, 30000);
}

export function stopCron() {
    if (intervalId) clearInterval(intervalId);
    cronRunning = false;
    console.log('[Cron] Job Scheduler stopped.');
}
