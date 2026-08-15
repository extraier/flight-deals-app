// Couple room Firestore helpers — client-side real-time sync.
// Mirrors the foodswipe HK pattern (see foodswipe-capacitor/app/src/App.tsx).

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
  query,
  getDocs,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { SpotCard, AdCard } from '@/lib/couple/cards';

export type RoomData = {
  id: string;
  user1: string | null;
  user2: string | null;
  user1Likes: string[];
  user1Dislikes: string[];
  user2Likes: string[];
  user2Dislikes: string[];
  createdAt: number;
  deckSeed: number;
};

/**
 * Generate a room code. 8 chars, base32-ish (excludes I/O/0/1 for readability).
 * Space: 32^8 ≈ 1.1 trillion — brute-force enumeration is infeasible.
 * Manus review F-02: 4-char codes (~1.68M) were trivially enumerable.
 */
export function generateRoomCode(): string {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no I/O/0/1
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const b of bytes) {
    code += ALPHABET[b % 32];
  }
  return code;
}

/** Create a new room. Returns the roomId. */
export async function createRoom(uid: string): Promise<string> {
  const roomId = generateRoomCode();
  const deckSeed = Math.floor(Math.random() * 1_000_000);
  await setDoc(doc(db, 'coupleRooms', roomId), {
    id: roomId,
    user1: uid,
    user2: null,
    user1Likes: [],
    user1Dislikes: [],
    user2Likes: [],
    user2Dislikes: [],
    createdAt: Date.now(),
    deckSeed,
  });
  return roomId;
}

/** Join an existing room. Throws if room is full or doesn't exist. */
export async function joinRoom(uid: string, roomId: string): Promise<RoomData> {
  const ref = doc(db, 'coupleRooms', roomId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error('房間不存在');
  }
  const data = snap.data() as RoomData;
  if (data.user1 === uid || data.user2 === uid) {
    // Already in this room — rejoin
    return data;
  }
  if (data.user2) {
    throw new Error('房間已滿');
  }
  await updateDoc(ref, { user2: uid });
  return { ...data, user2: uid };
}

/** Subscribe to room changes. Returns unsubscribe fn. */
export function subscribeRoom(
  roomId: string,
  onUpdate: (room: RoomData | null) => void
): () => void {
  const ref = doc(db, 'coupleRooms', roomId);
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      onUpdate(null);
      return;
    }
    onUpdate(snap.data() as RoomData);
  });
}

/** Record a swipe — atomically push to the right field. */
export async function swipe(roomId: string, uid: string, cardId: string, direction: 'left' | 'right'): Promise<void> {
  const ref = doc(db, 'coupleRooms', roomId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Room not found');
    const data = snap.data() as RoomData;
    const isUser1 = data.user1 === uid;
    const isUser2 = data.user2 === uid;
    if (!isUser1 && !isUser2) throw new Error('Not in room');

    const field = isUser1
      ? direction === 'right' ? 'user1Likes' : 'user1Dislikes'
      : direction === 'right' ? 'user2Likes' : 'user2Dislikes';

    const existing: string[] = data[field] || [];
    if (existing.includes(cardId)) return; // dedupe
    tx.update(ref, { [field]: [...existing, cardId] });
  });
}

/** Leave a room. */
export async function leaveRoom(roomId: string): Promise<void> {
  const ref = doc(db, 'coupleRooms', roomId);
  await updateDoc(ref, { endedAt: Date.now() });
}

/** Fetch spots for a couple room (client-side; cached by Firestore).
 *
 * Hermes 2026-08-14 (Phase 3.5): with 674 spots live, fetching all of
 * them on every room open is ~1 MB of payload per session. We cap at
 * SESSION_SPOT_CAP random spots per session — variety across rooms
 * comes from the random sample + shuffled deck, not from showing the
 * whole library. Firestore's IndexedDB cache makes subsequent room
 * opens instant.
 */
const SESSION_SPOT_CAP = 200;

export async function fetchSpots(): Promise<SpotCard[]> {
  const q = query(collection(db, 'coupleSpots'));
  const snap = await getDocs(q);
  const all = snap.docs.map((d) => {
    const data = d.data() as Omit<SpotCard, 'id'>;
    return { ...data, id: d.id };
  });
  if (all.length <= SESSION_SPOT_CAP) return all;
  // Random sample without replacement (Fisher–Yates partial shuffle).
  const sampled = [...all];
  for (let i = 0; i < SESSION_SPOT_CAP; i++) {
    const j = i + Math.floor(Math.random() * (sampled.length - i));
    [sampled[i], sampled[j]] = [sampled[j], sampled[i]];
  }
  return sampled.slice(0, SESSION_SPOT_CAP);
}

/** Fetch all ads. */
export async function fetchAds(): Promise<AdCard[]> {
  const q = query(collection(db, 'coupleAds'));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => {
      const data = d.data() as Omit<AdCard, 'id'>;
      return { ...data, id: d.id };
    })
    .filter((ad) => ad.active);
}
