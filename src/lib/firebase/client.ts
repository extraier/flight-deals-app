// Firebase client SDK for flight-deals-app Couple Room.
// Project: savetheday-2377a (reused — couple rooms share the same Firestore.
//   Collections are namespaced: coupleRooms, coupleSpots, coupleAds.)
// Hermes 2026-08-11.
//
// F-06 fix (2026-08-13): defer Firebase initialization to first client-side
// call. Previously `const app = initializeApp(...)` ran at module-eval time,
// which crashed the build when NEXT_PUBLIC_FIREBASE_* env vars were missing.
// Now: `db` and `auth` are Proxy objects that lazily resolve to real
// Firestore/Auth instances on first property access. Server-side code should
// import from `@/lib/firebase/admin` instead.

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

let _app: FirebaseApp | null = null;
let _db: Firestore | null = null;
let _auth: Auth | null = null;

function getApp(): FirebaseApp {
  if (_app) return _app;
  _app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
  return _app;
}

function getDb(): Firestore {
  if (!_db) _db = getFirestore(getApp());
  return _db;
}

function getAuthClient(): Auth {
  if (!_auth) _auth = getAuth(getApp());
  return _auth;
}

/**
 * Proxy wrapper that lazily delegates every property access to the real
 * Firestore/Auth instance. This keeps call-site code identical to before
 * (`collection(db, ...)`) while deferring initialization.
 */
function lazy<T extends object>(factory: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop, receiver) {
      const real = factory();
      const value = Reflect.get(real, prop, receiver);
      return typeof value === 'function' ? value.bind(real) : value;
    },
    has(_target, prop) {
      return prop in factory();
    },
  });
}

export const db = lazy(getDb);
export const auth = lazy(getAuthClient);

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
      const cred = await signInAnonymously(getAuthClient());
      resolve(cred.user.uid);
    } catch (err) {
      reject(err);
    }
  });
  return _anonCache;
}
