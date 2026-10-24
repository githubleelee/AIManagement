import { defineConfig } from 'vitest/config'

/** C-local test configuration; does not modify the shared runner or app skeleton. */
export default defineConfig({
  test: { environment: 'node', include: ['web/src/pages/scheduling/**/*.test.ts'] },
})
