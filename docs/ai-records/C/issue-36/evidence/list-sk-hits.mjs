import { readFileSync } from 'node:fs'

for (const file of process.argv.slice(2)) {
  const blob = readFileSync(file, 'utf8')
  const hits = [...new Set(blob.match(/sk-[A-Za-z0-9_-]{20,}/g) ?? [])]
  console.log(`--- ${file} ---`)
  for (const h of hits) console.log(`  len=${h.length} value=${h}`)
  if (!hits.length) console.log('  (none)')
}
