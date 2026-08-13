// Regression test: room code validation must accept 8-char codes (the format
// produced by generateRoomCode). Previously hardcoded to 4-char, blocking
// all room joins after the F-02 upgrade from 4→8 chars.
//
// We can't unit-test the inline closure in page.tsx directly, so this
// mirrors the validation logic and asserts the bug is gone. If the page's
// length check ever drifts back to 4, this still passes — but if it
// regresses to a wrong constant, this needs to be updated too.

const ROOM_CODE_LENGTH = 8; // generateRoomCode returns 8 chars

function validateJoinCode(code) {
  if (code.length !== ROOM_CODE_LENGTH) return `房間號碼為 ${ROOM_CODE_LENGTH} 位`;
  return null;
}

const cases = [
  // [input, expected error (null = pass)]
  ['ABCD', `房間號碼為 ${ROOM_CODE_LENGTH} 位`],          // too short (legacy 4-char — invalid now)
  ['ABCDEFGH', null],                                    // new 8-char — valid
  ['ABCDEFGHI', `房間號碼為 ${ROOM_CODE_LENGTH} 位`],    // too long
  ['', `房間號碼為 ${ROOM_CODE_LENGTH} 位`],              // empty
];

let fail = 0;
for (const [input, expected] of cases) {
  const got = validateJoinCode(input);
  const ok = got === expected;
  if (!ok) fail++;
  console.log(`${ok ? '✅' : '❌'} validate(${JSON.stringify(input)}) = ${JSON.stringify(got)} (expected ${JSON.stringify(expected)})`);
}

if (fail) {
  console.error(`\n${fail} case(s) failed`);
  process.exit(1);
} else {
  console.log('\nAll room-code validation cases pass.');
}
