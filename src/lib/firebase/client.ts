// Firebase client SDK for flight-deals-app Couple Room.
// Project: savetheday-2377a (reused — couple rooms share the same Firestore.
//   Collections are namespaced: coupleRooms, coupleSpots, coupleAds.)
// Hermes 2026-08-11.

import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Initialize once (Next.js server-side rendering may re-import this).
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const db = getFirestore(app);
export const auth = getAuth(app);

/**
 * Sign in anonymously. Returns the user's UID.
 * - Cache promise so multiple components can await safely.
 * - On room creation, the UID is the "user1" or "user2" identifier.
 */
let _anonCache: Promise<string> | null = null;
export async function ensureAnonAuth(): Promise<string> {
  if (_anonCache) return _anonCache;
  _anonCache = new Promise(async (resolve, reject) => {
    try {
      const cred = await signInAnonymously(auth);
      resolve(cred.user.uid);
    } catch (err) {
      reject(err);
    }
  });
  return _anonCache;
}
