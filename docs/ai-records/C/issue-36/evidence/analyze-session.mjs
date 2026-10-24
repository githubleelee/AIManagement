import { readFileSync, writeFileSync } from 'node:fs'

const file = process.env.PI_SESSION_FILE
const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)

const types = new Map()
const roles = new Map()
let first = null
let last = null
for (const line of lines) {
  let e
  try { e = JSON.parse(line) } catch { continue }
  if (!first && e.timestamp) first = e.timestamp
  if (e.timestamp) last = e.timestamp
  types.set(e.type, (types.get(e.type) ?? 0) + 1)
  if (e.type === 'message' && e.message?.role) {
    roles.set(e.message.role, (roles.get(e.message.role) ?? 0) + 1)
  }
}
const report = {
  file,
  lines: lines.length,
  range: { first, last },
  types: [...types].sort((a, b) => b[1] - a[1]),
  roles: [...roles],
}
writeFileSync('docs/role-c/issue-36/session-export/session-shape.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))

for (const want of ['user', 'assistant']) {
  for (const line of lines) {
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (e.type === 'message' && e.message?.role === want) {
      const clipped = JSON.parse(JSON.stringify(e))
      if (Array.isArray(clipped.message?.content)) {
        for (const part of clipped.message.content) {
          if (part?.type === 'text' && typeof part.text === 'string') part.text = `${part.text.slice(0, 240)}…`
          if (part?.type === 'toolCall') part.args = '<omitted>'
        }
      }
      console.log(`--- shape ${want} ---`)
      console.log(JSON.stringify(clipped).slice(0, 700))
      break
    }
  }
}
