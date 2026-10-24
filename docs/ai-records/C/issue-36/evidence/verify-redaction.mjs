/**
 * 脱敏校验：读取同目录上游的导出文件，逐项检查是否残留本机身份或凭据形态。
 * 路径相对本脚本，便于归档后复跑。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const file = join(here, '..', 'raw', 'C-I35-I36-20261022-main01a163ee-01-visible-redacted.jsonl')
const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))

const needles = {
  localUser: '陆禹畅',
  demoPassword: 'Test@12345',
  environmentObject: '"environment"',
  envSnapshotMarker: 'redactedEnvironmentVariables',
}
let failed = false
for (const [name, needle] of Object.entries(needles)) {
  const hits = rows.filter(r => JSON.stringify(r).includes(needle))
  console.log(`${name} => ${hits.length}`)
  if (hits.length) {
    failed = true
    for (const hit of hits.slice(0, 3)) {
      const blob = JSON.stringify(hit)
      const at = blob.indexOf(needle)
      console.log('  role=', hit.role, 'id=', hit.id, 'ts=', hit.timestamp)
      console.log('  ctx=', blob.slice(Math.max(0, at - 100), at + 140).replace(/\s+/g, ' '))
    }
  }
}

// 高熵长串只做提示，不判失败：仓库里存在 UUID、文件名、runner label。
const long = [...new Set(rows.flatMap(r => JSON.stringify(r).match(/[A-Za-z0-9_\-]{40,}/g) ?? []))]
console.log('long-strings >=40 chars:', long.length)
console.log('verdict:', failed ? 'FAILED — 需继续脱敏' : 'PASSED — 未发现本机身份/凭据残留')
