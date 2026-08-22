/**
 * Hermes 2026-08-22 (Manus admin fix): Jest config for the new
 * adminMetrics + matchNavigation regression tests. The existing
 * `cards.test.ts` uses Node's built-in test runner (see package.json
 * `test:cards`); this Jest config is scoped to the new admin-fixes
 * tests so the two runners don't fight over `*.test.ts` files.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: [
    '<rootDir>/src/lib/couple/__tests__/adminMetrics.test.ts',
    '<rootDir>/src/lib/couple/__tests__/matchNavigation.test.ts',
  ],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  clearMocks: true,
};