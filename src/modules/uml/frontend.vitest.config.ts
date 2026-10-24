import { defineConfig } from 'vitest/config'
export default defineConfig({ test: {
  environment: 'node', include: ['web/src/pages/uml/api.roundtrip.test.ts'], reporters: ['default'],
} })
