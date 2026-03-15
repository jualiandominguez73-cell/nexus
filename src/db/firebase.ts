import { initializeApp, cert, getApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { env } from '../config/env.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let serviceAccount: any;

if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
        serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch (err) {
        throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON format');
    }
} else {
    const serviceAccountPath = join(process.cwd(), env.FIREBASE_SERVICE_ACCOUNT_PATH);
    serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
}

const app = getApps().length === 0
    ? initializeApp({ credential: cert(serviceAccount) })
    : getApp();

export const adminDb = getFirestore(app);
export { FieldValue };
