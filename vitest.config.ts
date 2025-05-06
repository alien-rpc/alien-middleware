import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    isolate: false,
    typecheck: {
      enabled: true,
    },
    coverage: {
      thresholds: { 100: true },
    },
  },
})
