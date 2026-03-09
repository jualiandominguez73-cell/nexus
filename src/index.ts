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

    const startBotWithRetry = async (maxRetries = 10) => {
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
                    console.warn(`[Telegram] 409 Conflict: Old bot instance still polling. Railway zero-downtime deploy. Retrying in 3 seconds... (${i + 1}/${maxRetries})`);
                    await new Promise(res => setTimeout(res, 3000));
                } else {
                    throw err; // Other errors are fatal
                }
            }
        }
        console.error("Failed to start bot after maximum retries due to persistent 409 Conflict.");
    };

    startBotWithRetry().catch(err => {
        console.error("Failed to start Telegram Bot:", err);
    });
}

// Handle graceful shutdowns for PM2 or standard Ctrl+C
process.once('SIGINT', () => {
    console.log('\nStopping bot (SIGINT)...');
    bot.stop();
});
process.once('SIGTERM', () => {
    console.log('\nStopping bot (SIGTERM)...');
    bot.stop();
});

bootstrap().catch(err => {
    console.error("Fatal error during bootstrap:", err);
    process.exit(1);
});
