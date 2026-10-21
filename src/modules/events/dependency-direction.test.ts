import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('events module dependency direction', () => {
  it('does not import another business module service', () => {
    const directory = dirname(fileURLToPath(import.meta.url))
    const files = ['contracts.ts', 'errors.ts', 'factory.ts', 'in-memory-repository.ts', 'service.ts', 'validation.ts']
    const contents = files.map(file => readFileSync(join(directory, file), 'utf8')).join('\n')
    expect(/from ['"]\.\.\/[^'"]+\/service\.js['"]/.test(contents)).toBe(false)
  })
})
