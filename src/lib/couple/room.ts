// Couple room Firestore helpers — client-side real-time sync.
// Mirrors the foodswipe HK pattern (see foodswipe-capacitor/app/src/App.tsx).

import {
  doc,
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
import { nextJoinSlot } from '@/lib/couple/joinSlot';

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

/** Join an existing room. Throws a Chinese error if the room is full or missing. */
export async function joinRoom(uid: string, roomId: string): Promise<RoomData> {
  const ref = doc(db, 'coupleRooms', roomId);
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('房間不存在');
      const data = snap.data() as RoomData;
      const slot = nextJoinSlot(data.user1, data.user2, uid);
      if (slot === 'member') return data;
      if (slot === 'full') throw new Error('房間已滿');
      tx.update(ref, { [slot]: uid });
      return { ...data, [slot]: uid };
    });
  } catch (err) {
    if (err instanceof Error && (err.message === '房間不存在' || err.message === '房間已滿')) {
      throw err;
    }
    throw new Error('加入房間失敗，請稍後再試');
  }
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

/** Fetch every spot. The room page samples 200 with the shared deckSeed. */
export async function fetchSpots(): Promise<SpotCard[]> {
  const q = query(collection(db, 'coupleSpots'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const data = d.data() as Omit<SpotCard, 'id'>;
    return { ...data, id: d.id };
  });
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
