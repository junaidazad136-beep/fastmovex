/**
 * Phase 23 needs sign-in with Google switched on (pointed at a key server the test runs itself) and browser
 * notifications switched on (keys made for this run). Imported before the app so the settings are read at start.
 */
import webpush from 'web-push';

export const GOOGLE_CLIENT = 'p23-web.apps.googleusercontent.com';
export const JWKS_PORT = 47_823;
process.env.GOOGLE_CLIENT_IDS = GOOGLE_CLIENT;
process.env.GOOGLE_JWKS_URL = `http://127.0.0.1:${JWKS_PORT}/certs`;
const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
process.env.VAPID_SUBJECT = 'mailto:tests@jovia.test';
