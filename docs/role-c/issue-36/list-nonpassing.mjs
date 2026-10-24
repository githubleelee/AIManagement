import { readFileSync } from 'node:fs'

const j = JSON.parse(readFileSync('docs/role-c/issue-36/evidence/full-suite-results.json', 'utf8'))
console.log('=== 非 passed 的用例 ===')
for (const t of j.testResults) {
  for (const a of t.assertionResults) {
    if (a.status !== 'passed') {
      console.log(`${a.status} | ${t.name.split(/[\\/]/).pop()} | ${a.fullName}`)
    }
  }
}
console.log('')
console.log('=== 主配置覆盖的文件数（不含 web） ===')
console.log(j.testResults.length)
const web = j.testResults.filter(t => /[\\/]web[\\/]/.test(t.name))
console.log('其中 web/ 下的文件数:', web.length)
