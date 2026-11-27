import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextJoinSlot } from '../joinSlot.ts';

test('join takes the first empty seat and treats a member as already in', () => {
  assert.equal(nextJoinSlot(null, null, 'a'), 'user1');
  assert.equal(nextJoinSlot('a', null, 'b'), 'user2');
  assert.equal(nextJoinSlot('a', null, 'a'), 'member');
  assert.equal(nextJoinSlot('a', 'b', 'b'), 'member');
  assert.equal(nextJoinSlot('a', 'b', 'c'), 'full');
  assert.equal(nextJoinSlot(null, 'b', 'c'), 'user1');
});
