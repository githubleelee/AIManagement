import { readFile, writeFile } from 'node:fs/promises'
const base = 'docs/role-c/issue-36/evidence/'
const results = []
for (const file of ['attachment-regression-results.json', 'uml-joint-http-results.json']) {
  const value = JSON.parse(await readFile(base + file, 'utf8'))
  results.push({ file, success: value.success, total: value.numTotalTests, passed: value.numPassedTests,
    failed: value.numFailedTests, todo: value.numTodoTests, totalSuites: value.numTotalTestSuites,
    failedSuites: value.numFailedTestSuites, runtimeErrors: value.numRuntimeErrorTestSuites,
    completedFiles: value.testResults.map(test => ({ name: test.name, assertions: test.assertionResults.length, status: test.status })),
    reportedAssertions: value.testResults.reduce((total, test) => total + test.assertionResults.length, 0),
    unfinishedAssertions: value.testResults.flatMap(test => test.assertionResults.filter(item => item.status !== 'passed').map(item => ({ file: test.name, title: item.fullName, status: item.status }))),
    unhandledErrors: value.unhandledErrors ?? null,
    incomplete: value.testResults.filter(test => test.status !== 'passed').map(test => ({ name: test.name, status: test.status,
      message: test.message, assertions: test.assertionResults.filter(item => item.status !== 'passed')
        .map(item => ({ title: item.fullName, status: item.status, failureMessages: item.failureMessages })) })),
  })
}
await writeFile(base + 'result-summary.json', JSON.stringify(results, null, 2))
console.log(JSON.stringify(results, null, 2))
