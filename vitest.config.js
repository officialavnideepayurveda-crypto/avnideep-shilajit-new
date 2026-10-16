import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.js'],
    // These suites boot full product pages (2000+ lines of HTML plus their app
    // bundle) in jsdom and drive the checkout. Under parallel execution a single
    // such test routinely takes 1-4s, which brushed vitest's 5s default and made
    // the suite fail intermittently (~1 run in 4) with a timeout rather than a
    // real assertion failure. Only the wall-clock budget is raised here — every
    // assertion is untouched.
    testTimeout: 20000,
    server: {
      deps: {
        inline: ['@cloudflare/workers-types'],
      },
    },
  },
});
