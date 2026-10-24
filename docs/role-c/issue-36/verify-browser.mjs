import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright-core')
const evidence = path.resolve('docs/role-c/issue-36/evidence')
await mkdir(evidence, { recursive: true })
const server = fork(path.resolve('docs/role-c/issue-36/integration-server.ts'), [], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
let errors = '', browser, page
const checks = [], requests = [], pageErrors = []
server.stderr.on('data', value => { errors += value.toString() })
const pdf = Buffer.from('%PDF-1.4\nC actual browser binary fixture\n')
try {
  const fixture = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Startup timeout: ${errors}`)), 45000)
    server.on('message', value => { if (value.type === 'ready') { clearTimeout(timer); resolve(value) } })
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Fixture exit ${code}: ${errors}`)) })
  })
  browser = await chromium.launch({ headless: true, executablePath: process.argv[3], args: ['--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
  page = await context.newPage()
  page.on('pageerror', value => pageErrors.push(value.message))
  page.on('response', response => { const url = new URL(response.url()); if (url.pathname.startsWith('/api/')) requests.push({ path: url.pathname, method: response.request().method(), status: response.status() }) })
  const url = `${fixture.url}/projects/${fixture.projectId}/requirements/${fixture.storyId}`
  await page.goto(fixture.url)
  async function login(who) {
    await page.evaluate(token => localStorage.setItem('aim.token', token), fixture.tokens[who])
    await page.goto(url)
  }
  async function open(title) {
    await page.getByRole('button', { name: `任务附件：${title}`, exact: true }).click()
    await page.getByRole('region', { name: '任务附件', exact: true }).waitFor()
  }
  const panel = () => page.getByRole('region', { name: '任务附件', exact: true })
  async function upload(name) {
    await panel().locator('input[type=file]').setInputFiles({ name, mimeType: 'application/pdf', buffer: pdf })
    await panel().getByText(name, { exact: true }).waitFor()
  }
  async function check(name, run) { await run(); checks.push({ name, passed: true }); console.log(`PASS ${name}`) }
  await check('MEMBER owner opens actual TaskSection and uploads through the real service', async () => {
    await login('owner'); await open('合成附件任务'); await panel().getByText('暂无附件', { exact: true }).waitFor()
    await upload('真实任务附件.pdf')
    await page.screenshot({ path: path.join(evidence, 'formal-owner-upload.png'), fullPage: true })
  })
  await check('actual download event preserves binary content and filename', async () => {
    const download = page.waitForEvent('download')
    await panel().getByRole('button', { name: '下载', exact: true }).click()
    const result = await download
    assert.equal(result.suggestedFilename(), '真实任务附件.pdf')
    assert.deepEqual(await readFile(await result.path()), pdf)
  })
  await check('single attachment DELETE removes the visible item; reupload remains possible', async () => {
    await panel().getByRole('button', { name: '删除', exact: true }).click()
    await panel().getByText('暂无附件', { exact: true }).waitFor()
    await upload('任务删除清理.pdf')
  })
  await check('VIEWER and non-owner MEMBER see real read-only attachments, never upload/delete controls', async () => {
    for (const who of ['viewer', 'other']) {
      await login(who); await open('合成附件任务'); await panel().getByText('任务删除清理.pdf', { exact: true }).waitFor()
      assert.equal(await panel().getByRole('button', { name: '上传附件', exact: true }).count(), 0)
      assert.equal(await panel().getByRole('button', { name: '删除', exact: true }).count(), 0)
    }
    await page.screenshot({ path: path.join(evidence, 'formal-readonly.png'), fullPage: true })
  })
  await check('PM deletes via real task confirmation; row, attachment metadata and physical file disappear', async () => {
    await login('pm'); await open('合成附件任务')
    await panel().getByText('任务删除清理.pdf', { exact: true }).waitFor()
    const row = page.getByRole('row').filter({ has: page.getByText('合成附件任务', { exact: true }) })
    await row.getByRole('button', { name: '删除', exact: true }).click()
    await page.getByRole('button', { name: '确认删除', exact: true }).click()
    await page.getByRole('button', { name: '任务附件：合成附件任务', exact: true }).waitFor({ state: 'detached' })
    const inspection = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Inspection IPC timeout')), 5000)
      const listener = value => { if (value.type === 'inspection') { clearTimeout(timer); server.off('message', listener); resolve(value) } }
      server.on('message', listener); server.send({ type: 'inspect' })
    })
    assert.equal(inspection.taskExists, false); assert.deepEqual(inspection.attachments, []); assert.equal(inspection.files, 0)
    await writeFile(path.join(evidence, 'formal-delete-state.json'), JSON.stringify(inspection, null, 2))
  })
  await check('switching between real tasks unmounts the previous attachment panel', async () => {
    await login('pm'); await open('第二附件任务'); await upload('第二任务材料.pdf')
    await open('VIEWER负责人任务'); await upload('第三任务材料.pdf')
    assert.equal(await panel().getByText('第二任务材料.pdf', { exact: true }).count(), 0)
    await open('第二附件任务'); await panel().getByText('第二任务材料.pdf', { exact: true }).waitFor()
    assert.equal(await panel().getByText('第三任务材料.pdf', { exact: true }).count(), 0)
  })
  await check('VIEWER assigned as owner still gets no attachment write controls', async () => {
    await login('viewer'); await open('VIEWER负责人任务')
    await panel().getByText('第三任务材料.pdf', { exact: true }).waitFor()
    assert.equal(await panel().getByRole('button', { name: '上传附件', exact: true }).count(), 0)
    assert.equal(await panel().getByRole('button', { name: '删除', exact: true }).count(), 0)
  })
  await check('real sensitivity revocation plus focus clears filenames; reopening reauthorizes and stays hidden', async () => {
    await open('第二附件任务'); await panel().getByText('第二任务材料.pdf', { exact: true }).waitFor()
    const status = await page.evaluate(async ({ taskId, token }) => {
      const response = await fetch(`/api/tasks/${taskId}/sensitivity`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ isSensitive: true, visibleMemberIds: [] }) })
      await response.text(); return response.status
    }, { taskId: fixture.secondTaskId, token: fixture.tokens.pm })
    assert.equal(status, 200)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    assert.equal(await page.getByText('第二任务材料.pdf', { exact: true }).count(), 0)
    await page.getByRole('button', { name: '任务附件：第二附件任务', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '任务不可见或权限已变化' }).waitFor()
    assert.equal(await page.getByRole('region', { name: '任务附件', exact: true }).count(), 0)
    await page.screenshot({ path: path.join(evidence, 'formal-revoked.png'), fullPage: true })
  })
  await check('outsider production project route hides task and attachment UI', async () => {
    await login('outsider'); await page.getByText('项目不存在或无权访问', { exact: true }).waitFor()
    assert.equal(await page.getByRole('region', { name: '任务附件', exact: true }).count(), 0)
    assert.equal(await page.getByText('第三任务材料.pdf', { exact: true }).count(), 0)
  })
  assert.deepEqual(pageErrors, [])
  await writeFile(path.join(evidence, 'formal-browser-results.json'), JSON.stringify({ checks, requests, pageErrors,
    scope: 'Actual production TaskSection/routes, isolated migrated SQLite and mkdtemp disk. No API mocks or manual cleanup invocation.' }, null, 2))
  console.log(`PASS ${checks.length} formal attachment browser checks`)
} catch (error) {
  await writeFile(path.join(evidence, 'formal-browser-failure.json'), JSON.stringify({ error: String(error), checks, requests, pageErrors }, null, 2))
  if (page) await page.screenshot({ path: path.join(evidence, 'formal-failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally {
  if (browser) await browser.close()
  if (server.connected) server.send('close')
}
