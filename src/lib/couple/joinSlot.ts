/**
 * First empty seat. Already-a-member is not an error. A room with both
 * seats taken is full. The room URL and the code box on /match share this.
 */
export function nextJoinSlot(
  user1: string | null,
  user2: string | null,
  uid: string,
): 'member' | 'user1' | 'user2' | 'full' {
  if (user1 === uid || user2 === uid) return 'member';
  if (!user1) return 'user1';
  if (!user2) return 'user2';
  return 'full';
}
