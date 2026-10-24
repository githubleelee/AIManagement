/** Explicit authorized #32 delivery only. Credentials stay in process memory, never logs/files.
 * --check verifies identity only; --post requires the current C HEAD already pushed.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

async function main() {
  const git = process.platform === 'win32' ? 'D:/Git/cmd/git.exe' : 'git'
  const env = { ...process.env, GCM_INTERACTIVE: 'Never', GIT_TERMINAL_PROMPT: '0' }
  const credential = spawnSync(git, ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', env,
  })
  if (credential.status !== 0) throw new Error('Credential lookup failed; no credential output')
  const values = Object.fromEntries(credential.stdout.trim().split(/\r?\n/).map((line) => {
    const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]
  }))
  if (!values.password) throw new Error('No credential; stopped')
  const headers = { Authorization: `Bearer ${values.password}`, 'User-Agent': 'role-c-authorized-interface-delivery',
    Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }
  const base = 'https://api.github.com/repos/githubleelee/AIManagement'
  const get = async (url) => {
    const response = await fetch(url, { headers })
    if (!response.ok) throw new Error(`GitHub read HTTP ${response.status}`)
    return response.json()
  }
  const user = await get('https://api.github.com/user')
  if (user.login !== 'brucelyce-ux') throw new Error('Authenticated account changed; stopped')
  const repository = await get(base)
  if (!repository.permissions?.push) throw new Error('Repository push permission missing')
  console.log(JSON.stringify({ account: user.login, push: true }))
  if (process.argv.includes('--check')) return
  if (!process.argv.includes('--post')) throw new Error('Specify --check or --post')
  const output = (args) => {
    const result = spawnSync(git, args, { encoding: 'utf8', env })
    if (result.status !== 0) throw new Error('Git delivery metadata read failed')
    return result.stdout.trim()
  }
  const branch = output(['branch', '--show-current'])
  if (branch !== 'feat/US12-scheduling-core') throw new Error('Unexpected branch; stopped')
  const head = output(['rev-parse', 'HEAD'])
  const remote = await get(`${base}/commits/${encodeURIComponent(branch)}`)
  if (remote.sha !== head) throw new Error('Local HEAD has not been pushed; stopped before comment')
  const template = readFileSync('docs/role-c/issue-32-interface-delivery-comment.md', 'utf8')
  const body = template.replaceAll('{{C_HEAD_SHORT}}', head.slice(0, 7)).replaceAll('{{C_HEAD}}', head)
  const marker = '<!-- role-c-us12-public-interface-delivery-20261024-v1 -->'
  const comments = await get(`${base}/issues/32/comments?per_page=100`)
  if (comments.length >= 100) throw new Error('Pagination required; stopped before comment')
  let comment = comments.find((item) => item.body?.includes(marker))
  let created = false
  if (!comment) {
    const response = await fetch(`${base}/issues/32/comments`, { method: 'POST', headers, body: JSON.stringify({ body }) })
    if (!response.ok) throw new Error(`GitHub POST HTTP ${response.status}; inspect remote before retry`)
    comment = await response.json(); created = true
  }
  const verified = await get(comment.url)
  if (verified.body.trim() !== body.trim()) throw new Error('Existing remote body differs; do not repost')
  const receipt = { account: user.login, branch, head, created, id: verified.id, url: verified.html_url,
    createdAt: verified.created_at, verified: true, bodySha256: createHash('sha256').update(body).digest('hex') }
  writeFileSync('docs/role-c/evidence/issue-32-delivery-20261024/interface-delivery-publish-receipt.json', JSON.stringify(receipt, null, 2) + '\n')
  console.log(JSON.stringify(receipt, null, 2))
}
main().catch((error) => { console.error(error.message); process.exitCode = 1 })
