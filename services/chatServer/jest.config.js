module.exports = {
  testEnvironment: 'node',
  testTimeout: 30000, // 30 seconds timeout for async operations
  setupFilesAfterEnv: [],
  collectCoverageFrom: [
    'src/**/*.js',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testMatch: [
    '<rootDir>/test/**/*.test.js'
  ],
  verbose: true,
  // Force exit to avoid hanging after tests complete
  forceExit: true,
  // Detect open handles for debugging
  detectOpenHandles: true
};
