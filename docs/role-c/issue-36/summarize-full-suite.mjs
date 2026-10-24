import { readFileSync } from 'node:fs'

const file = 'docs/role-c/issue-36/evidence/full-suite-results.json'
const j = JSON.parse(readFileSync(file, 'utf8'))
console.log('numTotalTestSuites', j.numTotalTestSuites)
console.log('numPassedTestSuites', j.numPassedTestSuites)
console.log('numFailedTestSuites', j.numFailedTestSuites)
console.log('numTotalTests', j.numTotalTests)
console.log('numPassedTests', j.numPassedTests)
console.log('numFailedTests', j.numFailedTests)
console.log('numPendingTests', j.numPendingTests)
console.log('numTodoTests', j.numTodoTests)
console.log('reportedAssertions', j.testResults.reduce((n, t) => n + t.assertionResults.length, 0))
console.log('success', j.success)
console.log('')

const bad = j.testResults.filter(t => t.status !== 'passed')
console.log('=== 未完全通过的文件 ===')
for (const t of bad) {
  console.log(`\n[${t.status}] ${t.name}`)
  console.log(`  message: ${(t.message ?? '').split('\n').slice(0, 3).join(' | ')}`)
  for (const a of t.assertionResults.filter(x => x.status !== 'passed')) {
    console.log(`  - (${a.status}) ${a.fullName}`)
    for (const m of (a.failureMessages ?? []).slice(0, 2)) {
      console.log(`      ${m.split('\n').slice(0, 4).join('\n      ')}`)
    }
  }
}
