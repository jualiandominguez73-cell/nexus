import { config } from 'dotenv';
import { z } from 'zod';
import { join } from 'node:path';

// Load variables from .env
const envPath = join(process.cwd(), '.env');
console.log(`Attempting to load .env from: ${envPath}`);

const result = config({ path: envPath });

if (result.error) {
    console.warn('Note: No .env file found at root. If you are in production, ensure environment variables are set in your host/dashboard.');
} else {
    console.log('.env file loaded successfully from root.');
}

const envSchema = z.object({
    TELEGRAM_BOT_TOKEN: z.string({ required_error: "TELEGRAM_BOT_TOKEN is missing" }).min(1),
    TELEGRAM_ALLOWED_USER_IDS: z.string({ required_error: "TELEGRAM_ALLOWED_USER_IDS is missing" }).min(1),
    GROQ_API_KEY: z.string({ required_error: "GROQ_API_KEY is missing" }).min(1),
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
