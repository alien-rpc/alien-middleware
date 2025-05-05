import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/router.ts'],
  format: ['esm'],
  dts: true,
})
