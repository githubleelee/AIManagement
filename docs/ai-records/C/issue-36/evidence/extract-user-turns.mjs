import { readFileSync } from 'node:fs'

const rows = readFileSync(
  'docs/role-c/issue-36/session-export/C-I35-I36-20261022-main01a163ee-01-visible-redacted.jsonl',
  'utf8',
).split('\n').filter(Boolean).map(l => JSON.parse(l))

const users = rows.filter(r => r.role === 'user')
const lines = []
let index = 0
for (const r of users) {
  index += 1
  const text = r.content.filter(p => p.type === 'text').map(p => p.text).join(' ')
  const shanghai = new Date(r.timestamp).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
  lines.push(`${String(index).padStart(2)} | ${shanghai} | ${text.replace(/\s+/g, ' ').slice(0, 300)}`)
}
console.log(lines.join('\n'))
console.log('\n--- assistant turn count:', rows.filter(r => r.role === 'assistant').length)
console.log('--- tool calls by name ---')
const byName = new Map()
for (const r of rows) for (const p of r.content) {
  if (p.type === 'toolCall') byName.set(p.name, (byName.get(p.name) ?? 0) + 1)
}
console.log([...byName].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' '))
