import { readFileSync } from 'node:fs'

const base = 'docs/role-c/issue-36/evidence/'
const server = JSON.parse(readFileSync(base + 'full-suite-results.json', 'utf8'))
const web = JSON.parse(readFileSync(base + 'full-web-results.json', 'utf8'))

const summarize = (label, j) => ({
  label,
  files: j.testResults.length,
  total: j.numTotalTests,
  passed: j.numPassedTests,
  failed: j.numFailedTests,
  pending: j.numPendingTests,
  todo: j.numTodoTests,
  failedSuites: j.numFailedTestSuites,
  runtimeErrorSuites: j.numRuntimeErrorTestSuites ?? 0,
  unhandledErrors: (j.unhandledErrors ?? []).length,
})

const parts = [summarize('主配置（test/** + src/**）', server), summarize('web/** 补跑', web)]
for (const p of parts) console.log(JSON.stringify(p))

const totals = parts.reduce((acc, p) => ({
  files: acc.files + p.files,
  total: acc.total + p.total,
  passed: acc.passed + p.passed,
  failed: acc.failed + p.failed,
  pending: acc.pending + p.pending,
  todo: acc.todo + p.todo,
}), { files: 0, total: 0, passed: 0, failed: 0, pending: 0, todo: 0 })
console.log('COMBINED ' + JSON.stringify(totals))
console.log('')
console.log('=== web 文件明细 ===')
for (const t of web.testResults) {
  console.log(`  ${t.name.split(/[\\/]/).pop()}: ${t.assertionResults.length} tests, ${t.status}`)
}
console.log('')
console.log('=== 主配置未通过明细 ===')
for (const t of server.testResults) {
  for (const a of t.assertionResults) {
    if (a.status !== 'passed') console.log(`  ${a.status} | ${t.name.split(/[\\/]/).pop()} | ${a.fullName.slice(0, 110)}`)
  }
}
