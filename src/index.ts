import { bot } from './bot/telegram.js';

async function bootstrap() {
    console.log("Starting NEXUS Tech Hub...");
    console.log("Initializing tools and memory...");

    // Dynamically load tools to register them
    await import('./tools/get_current_time.js');
    await import('./tools/gog.js');
    await import('./tools/make_call.js');
    await import('./tools/schedule_call.js');
    await import('./tools/send_whatsapp.js');
    await import('./tools/translate_call.js');
    await import('./tools/save_contact.js');
    await import('./tools/search_contact.js');

    // Start Express Server for Twilio
    const { startServer } = await import('./server.js');
    startServer();

    // Start Cron Scheduler for background Tasks
    const { startCron } = await import('./cron.js');
    startCron();

    console.log("Connecting Telegram Bot in polling mode...");

    bot.catch((err) => {
        console.error("Telegram bot runtime error:", err.message);
    });

    // Drop any lingering webhook/polling session from a previous instance
    console.log("[Telegram] Clearing old sessions with deleteWebhook...");
    await bot.api.deleteWebhook({ drop_pending_updates: false });

    // Brief pause to let Telegram release the old getUpdates connection
    await new Promise(res => setTimeout(res, 2000));

    const startBotWithRetry = async (maxRetries = 15) => {
        for (let i = 0; i < maxRetries; i++) {
            try {
                await bot.start({
                    onStart: (botInfo) => {
                        console.log(`Bot @${botInfo.username} successfully started.`);
                        console.log(`Listening for messages from authorized users...`);
                    }
                });
                return; // successfully connected
            } catch (err: any) {
                if (err.error_code === 409 || (err.message && err.message.includes('409'))) {
                    console.warn(`[Telegram] 409 Conflict: Old bot instance still polling. Retrying in 3 seconds... (${i + 1}/${maxRetries})`);
                    await new Promise(res => setTimeout(res, 3000));
                } else {
                    throw err; // Other errors are fatal
                }
            }
        }
        console.error("Failed to start bot after maximum retries due to persistent 409 Conflict.");
    };

    await startBotWithRetry();
}

// Handle graceful shutdowns for PM2, Railway, Docker or Ctrl+C
const shutdown = (signal: string) => {
    console.log(`\nStopping bot (${signal})...`);
    bot.stop();
    // Give grammy 3s to close the getUpdates long-poll before the process dies
    setTimeout(() => process.exit(0), 3000);
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

bootstrap().catch(err => {
    console.error("Fatal error during bootstrap:", err);
    // Don't exit immediately — let the event loop drain so Telegram releases the session
    setTimeout(() => process.exit(1), 3000);
});
