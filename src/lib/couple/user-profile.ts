// Phase 2.2 — user profile doc helper.
//
// One profile doc per user at users/{uid}/profile/main. Idempotent
// write-on-first-sign-in pattern: we only write if the doc doesn't
// exist, so user-edited fields (future) won't be overwritten on every
// sign-in.

import { doc, setDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { User } from 'firebase/auth';

export type UserProfile = {
  uid: string;
  email: string | null;
  displayName: string | null;
  provider: 'password' | 'google.com' | 'anonymous' | string;
  createdAt: ReturnType<typeof serverTimestamp>;
  updatedAt: ReturnType<typeof serverTimestamp>;
};

/**
 * Create the user's profile doc on first sign-in. Idempotent.
 *
 * @returns true if a new profile was created, false if it already existed.
 */
export async function ensureUserProfile(user: User): Promise<boolean> {
  const ref = doc(db, 'users', user.uid, 'profile', 'main');
  const existing = await getDoc(ref);
  if (existing.exists()) return false;

  const provider = user.providerData[0]?.providerId ?? 'anonymous';
  await setDoc(ref, {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    provider,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return true;
}

/**
 * Read the current user's profile. Returns null if not signed in or no
 * profile doc exists (the latter means the user signed in but the
 * profile write failed — call ensureUserProfile to retry).
 */
export async function getUserProfile(
  uid: string
): Promise<UserProfile | null> {
  const ref = doc(db, 'users', uid, 'profile', 'main');
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data() as UserProfile;
}
