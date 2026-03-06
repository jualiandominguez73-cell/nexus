import { Bot } from 'grammy';
import { env, allowedUserIds } from '../config/env.js';
import { memoryDb } from '../db/memory.js';
import { runAgentLoop } from '../agent/loop.js';
import { transcribeAudio, generateVoice } from '../agent/voice.js';
import { InputFile } from 'grammy';
import { unlink } from 'node:fs/promises';

export const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

// Middleware for whitelist security
bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId || !allowedUserIds.includes(userId)) {
        console.warn(`Unauthorized access attempt from user ID: ${userId}`);
        // Silently ignore unauthorized users
        return;
    }
    await next();
});

bot.command('start', async (ctx) => {
    const userId = ctx.from!.id;
    const threadId = `thread_${userId}`; // One thread per user for simplicity

    await memoryDb.createThread(threadId, userId);
    await ctx.reply(`Welcome to NEXUS Tech Hub. I'm your local AI agent. Ready to assist you.`);
});

bot.command('clear', async (ctx) => {
    const userId = ctx.from!.id;
    const threadId = `thread_${userId}`;

    await memoryDb.clearHistory(threadId);
    await ctx.reply("Memory cleared for this conversation.");
});

bot.on('message:text', async (ctx) => {
    const userId = ctx.from!.id;
    const threadId = `thread_${userId}`;
    const userText = ctx.message.text;

    // Ensure thread exists before inserting messages
    await memoryDb.createThread(threadId, userId);

    // Send a typing action to indicate thinking process
    await ctx.replyWithChatAction('typing');

    try {
        const response = await runAgentLoop(threadId, userText);
        await ctx.reply(response);
    } catch (error: any) {
        console.error('Agent loop error:', error);
        await ctx.reply(`I encountered an internal error: ${error.message}`);
    }
});

bot.on('message:voice', async (ctx) => {
    const userId = ctx.from!.id;
    const threadId = `thread_${userId}`;

    await memoryDb.createThread(threadId, userId);
    await ctx.replyWithChatAction('record_voice');

    let voicePath: string | null = null;
    try {
        const file = await ctx.getFile();
        const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

        const transcribedText = await transcribeAudio(fileUrl);
        console.log(`Transcribed voice from ${userId}: ${transcribedText}`);

        const responseText = await runAgentLoop(threadId, transcribedText);

        voicePath = await generateVoice(responseText);
        await ctx.replyWithVoice(new InputFile(voicePath));

    } catch (error: any) {
        console.error('Voice handler error:', error);
        await ctx.reply(`Voice error: ${error.message}`);
    } finally {
        if (voicePath) {
            try { await unlink(voicePath); } catch (e) { }
        }
    }
});
