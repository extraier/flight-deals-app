// Firebase client SDK for flight-deals-app Couple Room.
// Project: savetheday-2377a (reused — couple rooms share the same Firestore.
//   Collections are namespaced: coupleRooms, coupleSpots, coupleAds.)
// Hermes 2026-08-11.
//
// F-06/F-11 fix (2026-08-13): env vars are always present in Vercel production
// (verified 2026-08-13), so we can initialize at module-eval time. The previous
// lazy-Proxy approach (commit e149bac) broke at runtime: Firebase SDK v12.17.1
// checks `db instanceof Firestore` inside `doc()` / `setDoc()` / `collection()`,
// and a Proxy wrapping `{}` fails the instanceof check, throwing
// "Expected first argument to doc() to be a CollectionReference, a DocumentReference
// or FirebaseFirestore" — even though `collection(db, ...)` looked fine because
// those paths go through the Proxy's `get` trap.
//
// If you ever need to support builds without NEXT_PUBLIC_FIREBASE_* env vars,
// wrap the `initializeApp()` call in a try/catch + dynamic import pattern,
// NOT a Proxy.
//
// Server-side code should import from `@/lib/firebase/admin` instead.

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const _app: FirebaseApp =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const db: Firestore = getFirestore(_app);
export const auth: Auth = getAuth(_app);

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