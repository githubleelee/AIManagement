/** 通用脱敏复核：检查任意导出 jsonl 是否残留本机身份/凭据形态。 */
import { readFileSync } from 'node:fs'

const targets = process.argv.slice(2)
if (!targets.length) throw new Error('usage: check-any-export.mjs <file.jsonl> [...]')

const needles = {
  localUser: '陆禹畅',
  demoPassword: 'Test@12345',
  envSnapshot: 'redactedEnvironmentVariables',
  bearerToken: /Bearer\s+[A-Za-z0-9._-]{12,}/,
  ghToken: /gh[pousr]_[A-Za-z0-9]{16,}/,
  // 真 OpenAI 风格 key 为 `sk-` + 32 位以上无连字符的高熵串；
  // 本仓库的 runner 标签如 `sk-attachment-lifecycle` 含连字符且更短，不应误报。
  openaiKey: /sk-[A-Za-z0-9]{32,}/,
}

let failed = false
for (const file of targets) {
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean)
  const blob = rows.join('\n')
  console.log(`--- ${file} (${rows.length} rows) ---`)
  for (const [name, needle] of Object.entries(needles)) {
    const hits = typeof needle === 'string'
      ? (blob.split(needle).length - 1)
      : (blob.match(new RegExp(needle.source, 'g')) ?? []).length
    if (hits) {
      failed = true
      console.log(`  ${name}: ${hits} HIT`)
    }
  }
  const redactedCount = (blob.match(/\[LOCAL_USER\]/g) ?? []).length
  console.log(`  [LOCAL_USER] 替换次数: ${redactedCount}`)
}
console.log('verdict:', failed ? 'FAILED' : 'PASSED')
