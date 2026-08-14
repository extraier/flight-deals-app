// Phase 2.1 — Firebase Auth provider helpers.
//
// Wraps the standard Firebase Auth SDK calls with the project's existing
// `auth` instance (already initialized in src/lib/firebase/client.ts).
// Anonymous auth is already handled by `ensureAnonAuth()` — these helpers
// are for upgrading to a permanent account so the user's wishlist
// (Phase 2.3) can persist across devices.
//
// Hermes 2026-08-14: simplified from the original plan. The original
// `upgradeAnonToGoogle` was tangled (Firebase Auth can't link a popup
// result back to an anon UID cleanly). For v1 we just instruct the user
// to sign in fresh — anon-to-permanent is a v2 problem.

import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
  type UserCredential,
} from 'firebase/auth';
import { auth } from './client';

/**
 * Sign in with Google via popup. Returns the UserCredential.
 *
 * IMPORTANT: if the user is currently signed in anonymously, this will
 * SIGN OUT the anon user and sign in as the Google user (a new UID).
 * Any data tied to the anon UID will be lost. For v1 we accept this;
 * the user sees a "請先登出匿名模式" prompt before triggering this.
 */
export async function signInWithGoogle(): Promise<UserCredential> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(auth, provider);
}

export async function signUpWithEmail(
  email: string,
  password: string
): Promise<UserCredential> {
  return createUserWithEmailAndPassword(auth, email, password);
}

export async function signInWithEmail(
  email: string,
  password: string
): Promise<UserCredential> {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signOut(): Promise<void> {
  return fbSignOut(auth);
}

/**
 * Returns true iff the current user is anonymous (i.e. has no permanent
 * account yet). Used by /match/account to show the right UI.
 */
export function isAnonymous(user: User | null): boolean {
  return !!user?.isAnonymous;
}

/**
 * Returns the human-readable provider name for the current user, e.g.
 * "Google", "Email/Password", "Anonymous". Used in the account page.
 */
export function providerLabel(user: User | null): string {
  if (!user) return '未登入';
  const id = user.providerData[0]?.providerId ?? 'anonymous';
  switch (id) {
    case 'google.com': return 'Google';
    case 'password': return 'Email/Password';
    case 'anonymous': return '匿名（升級以保存心願清單）';
    default: return id;
  }
}
