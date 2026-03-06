import { config } from 'dotenv';
import { z } from 'zod';

// Load variables from .env
console.log('Current working directory:', process.cwd());
const result = config();
if (result.error) {
    console.error('Error loading .env file:', result.error);
} else {
    console.log('.env file loaded successfully');
}

const envSchema = z.object({
    TELEGRAM_BOT_TOKEN: z.string().min(1, "Telegram bot token is required"),
    TELEGRAM_ALLOWED_USER_IDS: z.string().min(1, "Allowed user IDs are required"),
    GROQ_API_KEY: z.string().min(1, "Groq API key is required"),
    OPENROUTER_API_KEY: z.string().optional(),
    OPENROUTER_MODEL: z.string().default('openrouter/free'),
    DB_PATH: z.string().default('./memory.db'),
    FIREBASE_SERVICE_ACCOUNT_PATH: z.string().default('./firebase-service-account.json'),
});

// Validate env vars
export const env = envSchema.parse(process.env);

// Parse allowed user IDs into an array of numbers
export const allowedUserIds = env.TELEGRAM_ALLOWED_USER_IDS
    .split(',')
    .map(id => parseInt(id.trim(), 10))
    .filter(id => !isNaN(id));
