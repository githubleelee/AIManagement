import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const base = 'docs/role-c/evidence/issue-32-main-merge-20261024'
const reports = {}
for (const name of ['backend-result', 'frontend-result']) {
  const r = JSON.parse(readFileSync(`${base}/${name}.json`, 'utf8'))
  reports[name] = { success: r.success, total: r.numTotalTests, passed: r.numPassedTests,
    failed: r.numFailedTests, todo: r.numTodoTests }
  if (!r.success || r.numFailedTests !== 0) throw new Error('Validation report failed')
}
const expected = JSON.parse(readFileSync('docs/role-c/evidence/issue-32-delivery-20261024/validation-summary.json', 'utf8')).hashes
const changed = Object.entries(expected).filter(([path, digest]) => createHash('sha256').update(readFileSync(path)).digest('hex') !== digest).map(([path]) => path)
if (changed.length) throw new Error(`C source differs from tested delivery: ${changed.join(',')}`)
const summary = { mainBaseline: 'e7bc546571662b2374f7496cb44f621ef2340d83', testedIntegration: '43f1a704e6b2928068be92a8ed9649bae069ea5e',
  capturedAt: new Date().toISOString(), reports, cSourceHashMismatches: changed,
  typechecks: { server: 'exit0', web: 'exit0', serverBuildTypes: 'exit0' }, webBuild: 'exit0',
  browser: { passed: 8, mode: 'synthetic-component-only', finalUS12Acceptance: false },
  fullSuitePassed: false, finalUS12Acceptance: false }
writeFileSync(`${base}/validation-summary.json`, JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary, null, 2))
