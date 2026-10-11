/** Integration tests: the real API against a real PostgreSQL + S3 (see TESTING.md). */
module.exports = {
  rootDir: '../..',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: 'test/integration/.*\\.int-spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/integration/setup-int.ts'],
  testTimeout: 120_000,
};
