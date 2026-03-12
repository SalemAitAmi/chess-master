import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use v8 for coverage
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.js'],
      exclude: ['src/server.js', 'src/logging/**'],
      reportOnFailure: true,
    },
    
    // Test configuration
    globals: true,
    environment: 'node',
    testTimeout: 60000,  // 60s for endgame tests
    
    // File patterns
    include: ['test/**/*.test.js'],
    
    // Reporter
    reporters: ['verbose'],
    
    // Expose gc for memory tests
    pool: 'forks',
    poolOptions: {
      forks: {
        execArgv: ['--expose-gc'],
      },
    },
  },
});