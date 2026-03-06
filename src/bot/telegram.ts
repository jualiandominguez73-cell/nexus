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
    await ctx.reply("He recibido tu audio, déjame escucharlo... 🎧");
    await ctx.replyWithChatAction('record_voice');

    let voicePath: string | null = null;
    try {
        console.log(`[Voice] Starting processing for user ${userId}`);
        const file = await ctx.getFile();
        const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

        console.log(`[Voice] Transcribing audio from: ${file.file_path}`);
        const transcribedText = await transcribeAudio(fileUrl);

        if (!transcribedText || transcribedText.trim() === '') {
            throw new Error("No pude entender nada en el audio.");
        }

        console.log(`[Voice] Transcription: ${transcribedText}`);
        await ctx.reply(`Te he entendido: "${transcribedText}"\n\nDejame pensar...`);

        const responseText = await runAgentLoop(threadId, transcribedText);
        console.log(`[Voice] Agent response ready. Generating TTS...`);

        voicePath = await generateVoice(responseText);
        await ctx.replyWithVoice(new InputFile(voicePath));
        console.log(`[Voice] Audio response sent successfully.`);

    } catch (error: any) {
        console.error('[Voice Error]:', error);
        await ctx.reply(`Lo siento, tuve un problema con el audio: ${error.message}`);
    } finally {
        if (voicePath) {
            try { await unlink(voicePath); } catch (e) { }
        }
    }
});

bot.on('message:photo', async (ctx) => {
    const userId = ctx.from!.id;
    const threadId = `thread_${userId}`;
    const caption = ctx.message.caption || "Analiza esta imagen.";

    await memoryDb.createThread(threadId, userId);
    await ctx.replyWithChatAction('typing');

    try {
        console.log(`[Vision] Processing photo from user ${userId}`);
        const photo = ctx.message.photo.pop()!; // Get the largest photo
        const file = await ctx.getFile();
        const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

        // Prepare multi-part content
        const visionContent = [
            { type: 'text', text: caption },
            { type: 'image_url', image_url: { url: fileUrl } }
        ];

        console.log(`[Vision] Sending image to agent loop...`);
        const response = await runAgentLoop(threadId, visionContent);
        await ctx.reply(response);
        console.log(`[Vision] Response sent.`);

    } catch (error: any) {
        console.error('[Vision Error]:', error);
        await ctx.reply(`Lo siento, no pude procesar la imagen: ${error.message}`);
    }
});
