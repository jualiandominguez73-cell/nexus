import { queueDb } from './db/queue.js';
import { toolsRegistry } from './tools/index.js';

let cronRunning = false;
let intervalId: NodeJS.Timeout | null = null;

export function startCron() {
    if (cronRunning) return;
    cronRunning = true;

    console.log('[Cron] Job Scheduler started. Checking for pending tasks every 30 seconds.');

    // Check every 30 seconds
    intervalId = setInterval(async () => {
        try {
            const pending = await queueDb.getPendingTasks();
            if (pending.length > 0) {
                console.log(`[Cron] Found ${pending.length} pending task(s). Executing...`);
                for (const task of pending) {
                    try {
                        console.log(`[Cron] Executing task ${task.id} of type ${task.type}`);

                        if (task.type === 'make_call') {
                            const makeCallTool = toolsRegistry.get('make_call');
                            if (makeCallTool) {
                                // Execute call tool passing telegramChatId from payload if it exists
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
