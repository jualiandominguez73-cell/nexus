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

    await bot.start({
        onStart: (botInfo) => {
            console.log(`Bot @${botInfo.username} successfully started.`);
            console.log(`Listening for messages from authorized users...`);
        }
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
