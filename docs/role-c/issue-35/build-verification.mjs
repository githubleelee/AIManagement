// Build both C-owned verification entries, including the not-yet-production-mounted UML page.
import { build } from 'vite'
import path from 'node:path'
await build({ configFile: 'web/vite.config.ts', build: {
  outDir: path.resolve('dist/uml-verification'), emptyOutDir: true,
  rollupOptions: { input: {
    integration: path.resolve('web/src/pages/uml/integration.html'),
    editor: path.resolve('web/src/pages/uml/preview.html'),
  } },
} })
