// Phase 2.3 — Wishlist helpers.
//
// Path: users/{uid}/wishlist/{spotId}
// Each doc represents one saved destination. Doc id = spotId so
// addToWishlist is idempotent (setDoc with merge:true). Subscribing
// to the collection gives the user's full wishlist in real time.

import {
  doc,
  setDoc,
  deleteDoc,
  collection,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  type QuerySnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';

export type WishlistEntry = {
  id: string;            // spotId (doc id)
  spotId: string;
  addedAt: ReturnType<typeof serverTimestamp>;
  note?: string;
  targetMonth?: number;  // 1-12
  targetYear?: number;
  travelWith?: 'solo' | 'couple' | 'family' | 'friends';
};

/**
 * Add a spot to the user's wishlist. Idempotent — calling twice for the
 * same spotId is a no-op (setDoc with merge:true).
 */
export async function addToWishlist(
  uid: string,
  spotId: string,
  extras?: Partial<
    Pick<WishlistEntry, 'note' | 'targetMonth' | 'targetYear' | 'travelWith'>
  >
): Promise<void> {
  const ref = doc(db, 'users', uid, 'wishlist', spotId);
  await setDoc(
    ref,
    {
      spotId,
      addedAt: serverTimestamp(),
      ...extras,
    },
    { merge: true }
  );
}

export async function removeFromWishlist(
  uid: string,
  spotId: string
): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'wishlist', spotId));
}

/**
 * Live subscription. Returns the unsubscribe function.
 * The callback receives the entries sorted newest-first (by addedAt desc).
 */
export function subscribeWishlist(
  uid: string,
  cb: (entries: WishlistEntry[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(
    collection(db, 'users', uid, 'wishlist'),
    orderBy('addedAt', 'desc')
  );
  return onSnapshot(
    q,
    (snap: QuerySnapshot) => {
      const entries: WishlistEntry[] = snap.docs.map((d) => {
        const data = d.data() as Omit<WishlistEntry, 'id'>;
        return { ...data, id: d.id, spotId: data.spotId ?? d.id };
      });
      cb(entries);
    },
    onError
  );
}

/**
 * Synchronous helper: check whether a spotId is in a local cache of
 * entries. Used by SpotCard to render the saved/unsaved heart state
 * without an extra round-trip.
 */
export function isInWishlist(
  entries: WishlistEntry[],
  spotId: string
): boolean {
  return entries.some((e) => e.spotId === spotId);
}
