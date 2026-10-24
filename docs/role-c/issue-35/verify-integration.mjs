import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(process.argv[2] || 'playwright-core')
const formal = process.argv.includes('--formal')
const evidence = path.resolve(`docs/role-c/issue-35/evidence/${formal ? 'formal' : 'picker'}`)
await mkdir(evidence, { recursive: true })
const server = fork(path.resolve('docs/role-c/issue-35/integration-server.ts'), formal ? ['--formal'] : [], {
  execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
})
let serverErrors = ''
server.stderr.on('data', value => { serverErrors += value.toString() })
const checks = [], requests = [], pageErrors = [], requestFailures = []
let browser, page
try {
  const fixture = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Test server startup timeout: ${serverErrors}`)), 45000)
    server.on('message', value => { if (value.type === 'ready') { clearTimeout(timer); resolve(value) } })
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Test server exited ${code}: ${serverErrors}`)) })
  })
  browser = await chromium.launch({ headless: true, executablePath: process.argv[3], args: ['--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  page = await context.newPage()
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('requestfailed', request => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/')) requestFailures.push({ method: request.method(), path: url.pathname, error: request.failure()?.errorText })
  })
  page.on('response', response => {
    const req = response.request()
    const url = new URL(req.url())
    if (url.pathname.startsWith('/api/')) requests.push({ method: req.method(), path: url.pathname, status: response.status(), hasAuthorization: !!req.headers().authorization })
  })
  const entry = projectId => formal ? `${fixture.url}/projects/${encodeURIComponent(projectId)}/uml`
    : `${fixture.url}/src/pages/uml/integration.html?projectId=${encodeURIComponent(projectId)}`
  const url = entry(fixture.projectId)
  await page.goto(url)
  await page.evaluate(token => localStorage.setItem('aim.token', token), fixture.pmToken)
  await page.goto(url)
  await page.getByText('可见图共 0 张', { exact: true }).waitFor()
  async function check(name, action) { await action(); checks.push({ name, passed: true }); console.log(`PASS ${name}`) }
  const currentId = () => page.evaluate(() => new URLSearchParams(location.search).get('diagram'))
  const candidate = (label, id) => page.getByRole('checkbox', { name: new RegExp(`^选择${label}：.*（${id}）$`) })
  const saved = async () => page.evaluate(async () => {
    const id = new URLSearchParams(location.search).get('diagram')
    const api = await import('/src/pages/uml/api.ts')
    return api.getUml(id)
  })
  let firstId
  if (formal) await check('real ProjectLayout navigation exposes the production UML route', async () => {
    await page.getByRole('navigation', { name: '项目导航', exact: true }).getByRole('link', { name: /UML 图/ }).click()
    assert.equal(new URL(page.url()).pathname, `/projects/${fixture.projectId}/uml`)
  })
  await check('PM creates sequence and all four refs through real API, fresh server ids, correct persisted seq', async () => {
    await page.getByRole('button', { name: '新建时序图', exact: true }).click()
    await page.getByLabel('图标题', { exact: true }).fill('真实保存时序图')
    for (const [label, key] of [['业务目标', 'goalId'], ['用户活动', 'activityId'], ['用户故事', 'storyId'], ['任务', 'taskId']]) {
      await candidate(label, fixture[key]).check()
      assert.equal(await page.getByLabel(`${label} ID`, { exact: true }).inputValue(), fixture[key])
    }
    assert.equal(await page.getByRole('checkbox', { name: new RegExp(fixture.foreignGoalId) }).count(), 0)
    await page.getByRole('button', { name: '添加生命线', exact: true }).click()
    await page.getByRole('button', { name: '添加生命线', exact: true }).click()
    await page.getByLabel('生命线 1', { exact: true }).fill('浏览器')
    await page.getByLabel('生命线 2', { exact: true }).fill('临时服务器')
    await page.getByRole('button', { name: '添加消息', exact: true }).click()
    await page.getByLabel('消息 1 内容', { exact: true }).fill('真实 HTTP 保存')
    await page.getByRole('button', { name: '创建并保存全部', exact: true }).click()
    await page.getByRole('heading', { name: '编辑图：真实保存时序图', exact: true }).waitFor()
    firstId = await currentId()
    assert(firstId)
    const doc = await saved()
    assert.equal(doc.kind, 'SEQUENCE'); assert.equal(doc.edges[0].seq, 1)
    assert.equal(doc.taskRefs[0].id, fixture.taskId)
    assert.equal(doc.goalRefs[0].id, fixture.goalId)
    assert.equal(doc.activityRefs[0].id, fixture.activityId)
    assert.equal(doc.storyRefs[0].id, fixture.storyId)
    const taskLink = page.getByRole('link', { name: '任务：合成任务', exact: true })
    assert.equal(await taskLink.getAttribute('href'), `/projects/${fixture.projectId}/requirements/${fixture.storyId}#task-${fixture.taskId}`)
    // URL correctness only: B's target row patch is not mounted, no AC4 jump claimed.
  })
  await check('refresh restores actual server document and editable content', async () => {
    await page.reload()
    await page.getByRole('heading', { name: '编辑图：真实保存时序图', exact: true }).waitFor()
    assert.equal(await page.getByLabel('消息 1 内容', { exact: true }).inputValue(), '真实 HTTP 保存')
    assert.equal(await page.getByLabel('生命线 1', { exact: true }).inputValue(), '浏览器')
    await page.screenshot({ path: path.join(evidence, 'integration-sequence.png'), fullPage: true })
  })
  await check('picker search and selection edit only the draft, survive offline retry, and preserve unknown IDs', async () => {
    await candidate('任务', fixture.taskId).waitFor()
    await page.getByLabel('搜索业务目标', { exact: true }).fill('不存在的候选名称')
    await page.getByRole('region', { name: '业务目标候选', exact: true }).getByText('没有匹配的候选', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('业务目标 ID', { exact: true }).inputValue(), fixture.goalId)
    await page.getByLabel('搜索业务目标', { exact: true }).fill('')
    await candidate('任务', fixture.taskId).uncheck()
    assert.equal(await page.getByLabel('任务 ID', { exact: true }).inputValue(), '')
    assert.equal((await saved()).taskRefs[0].id, fixture.taskId)
    await page.getByLabel('任务 ID', { exact: true }).fill(`${fixture.taskId}, missing-draft-id`)
    assert(await candidate('任务', fixture.taskId).isChecked())
    await page.getByRole('button', { name: '移除任务 ID missing-draft-id', exact: true }).waitFor()
    await context.setOffline(true)
    try {
      await page.getByRole('button', { name: '刷新关联候选', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: '关联候选加载失败' }).waitFor()
      assert.equal(await page.getByRole('checkbox').count(), 0)
      assert.equal(await page.getByLabel('任务 ID', { exact: true }).inputValue(), `${fixture.taskId}, missing-draft-id`)
    } finally { await context.setOffline(false) }
    await page.getByRole('button', { name: '刷新关联候选', exact: true }).click()
    await candidate('任务', fixture.taskId).waitFor()
    await page.getByRole('button', { name: '移除任务 ID missing-draft-id', exact: true }).click()
    assert.equal(await page.getByLabel('任务 ID', { exact: true }).inputValue(), fixture.taskId)
    assert.equal((await saved()).taskRefs[0].id, fixture.taskId)
  })
  await check('picker enforces the 50-selection boundary without discarding an existing draft', async () => {
    await page.getByLabel('业务目标 ID', { exact: true }).fill(fixture.extraGoalIds.slice(0, 50).join('\n'))
    assert(await candidate('业务目标', fixture.goalId).isDisabled())
    assert(!(await candidate('业务目标', fixture.extraGoalIds[0]).isDisabled()))
    await candidate('业务目标', fixture.extraGoalIds[0]).uncheck()
    await candidate('业务目标', fixture.goalId).check()
    assert.equal((await page.getByLabel('业务目标 ID', { exact: true }).inputValue()).split('\n').length, 50)
    await page.getByLabel('业务目标 ID', { exact: true }).fill(fixture.extraGoalIds.join('\n'))
    await page.getByRole('alert').filter({ hasText: '业务目标超过 50 个' }).waitFor()
    assert.equal((await saved()).goalRefs.length, 1)
    await page.getByLabel('业务目标 ID', { exact: true }).fill(fixture.goalId)
    await page.setViewportSize({ width: 390, height: 844 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    await page.screenshot({ path: path.join(evidence, 'picker-mobile.png'), fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 })
  })
  await check('metadata save preserves unsubmitted content draft; content save preserves other metadata draft', async () => {
    await page.getByLabel('消息 1 内容', { exact: true }).fill('尚未提交的图内容')
    await page.getByLabel('图标题', { exact: true }).fill('元数据已保存')
    await page.getByRole('button', { name: '保存基本信息与关联', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '基本信息与关联已保存' }).waitFor()
    assert.equal(await page.getByLabel('消息 1 内容', { exact: true }).inputValue(), '尚未提交的图内容')
    assert.equal((await saved()).edges[0].label, '真实 HTTP 保存')
    await page.getByLabel('图标题', { exact: true }).fill('未保存标题')
    await page.getByRole('button', { name: '保存图内容', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '图内容已保存' }).waitFor()
    assert.equal((await saved()).edges[0].label, '尚未提交的图内容')
    assert.equal((await saved()).title, '元数据已保存')
    assert.equal(await page.getByLabel('图标题', { exact: true }).inputValue(), '未保存标题')
    await candidate('任务', fixture.taskId).uncheck()
    await page.getByRole('button', { name: '保存图内容', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '图内容已保存' }).waitFor()
    assert.equal(await page.getByLabel('任务 ID', { exact: true }).inputValue(), '')
    assert.equal((await saved()).taskRefs[0].id, fixture.taskId)
    await candidate('任务', fixture.taskId).check()
  })
  await check('invalid association returns real 422 without replacing draft or saved metadata', async () => {
    await page.getByLabel('任务 ID', { exact: true }).fill('missing-synthetic-task')
    await page.getByRole('button', { name: '保存基本信息与关联', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'CROSS_PROJECT_REF' }).waitFor()
    assert.equal(await page.getByLabel('任务 ID', { exact: true }).inputValue(), 'missing-synthetic-task')
    assert.equal((await saved()).taskRefs[0].id, fixture.taskId)
    assert.equal((await saved()).title, '元数据已保存')
  })
  await check('picker removals and additions persist only after metadata save and survive refresh', async () => {
    await page.getByLabel('任务 ID', { exact: true }).fill(fixture.taskId)
    await page.getByLabel('图标题', { exact: true }).fill('元数据已保存')
    await candidate('任务', fixture.taskId).uncheck()
    await candidate('用户活动', fixture.activityId).uncheck()
    assert.equal((await saved()).taskRefs[0].id, fixture.taskId)
    await page.getByRole('button', { name: '保存基本信息与关联', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '基本信息与关联已保存' }).waitFor()
    const without = await saved()
    assert.deepEqual(without.taskRefs, []); assert.deepEqual(without.activityRefs, [])
    assert.equal(without.edges[0].label, '尚未提交的图内容')
    await candidate('任务', fixture.taskId).check()
    await candidate('用户活动', fixture.activityId).check()
    await page.getByRole('button', { name: '保存基本信息与关联', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '基本信息与关联已保存' }).waitFor()
    const restored = await saved()
    assert.equal(restored.taskRefs[0].id, fixture.taskId)
    assert.equal(restored.activityRefs[0].id, fixture.activityId)
    await page.reload()
    await page.getByRole('heading', { name: '编辑图：元数据已保存', exact: true }).waitFor()
    for (const [label, key] of [['业务目标', 'goalId'], ['用户活动', 'activityId'], ['用户故事', 'storyId'], ['任务', 'taskId']]) {
      await candidate(label, fixture[key]).waitFor()
      assert(await candidate(label, fixture[key]).isChecked())
    }
    await page.screenshot({ path: path.join(evidence, 'picker-desktop.png'), fullPage: true })
  })
  await check('wire adapters preserve reverse associations, custom labels, null labels and both directed association tuples', async () => {
    const result = await page.evaluate(async projectId => {
      const api = await import('/src/pages/uml/api.ts')
      const v = await api.createUml(projectId, { title: '映射测试用例图', kind: 'USECASE', nodes: [
        { id: 'a', name: '角色', nodeType: 'ACTOR' }, { id: 'u', name: '用例', nodeType: 'USECASE' },
      ], edges: [
        { edgeType: 'ASSOCIATION', sourceNodeId: 'u', targetNodeId: 'a', label: '保留反向标签' },
        { edgeType: 'ASSOCIATION', sourceNodeId: 'a', targetNodeId: 'u', label: null },
      ] })
      const editor = api.fromWire(v), wire = api.toWire(editor)
      const fresh = await api.saveUmlContent(v.id, editor)
      return { original: v, editor, wire, fresh }
    }, fixture.projectId)
    assert.equal(result.editor.relations.length, 2)
    for (let i = 0; i < 2; i++) {
      assert.equal(result.wire.edges[i].sourceNodeId, result.original.edges[i].sourceNodeId)
      assert.equal(result.wire.edges[i].targetNodeId, result.original.edges[i].targetNodeId)
      assert.equal(result.wire.edges[i].label, result.original.edges[i].label)
    }
    assert.deepEqual(result.fresh.edges.map(e => e.label).sort(), [null, '保留反向标签'].sort())
    const nullMessage = await page.evaluate(async id => {
      const api = await import('/src/pages/uml/api.ts'), v = await api.getUml(id)
      const input = { nodes: v.nodes, edges: v.edges.map(e => ({ ...e, label: null })) }
      await fetch(`/api/uml-diagrams/${encodeURIComponent(id)}/content`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('aim.token')}` }, body: JSON.stringify(input) }).then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json() })
      const loaded = await api.getUml(id), doc = api.fromWire(loaded)
      return api.saveUmlContent(id, doc)
    }, firstId)
    assert.equal(nullMessage.edges[0].label, null)
  })
  await check('ordinary VIEWER reads persisted graph and refs without edit or create controls', async () => {
    await page.evaluate(token => localStorage.setItem('aim.token', token), fixture.viewerToken)
    await page.reload()
    await page.getByRole('heading', { name: '编辑图：元数据已保存', exact: true }).waitFor()
    assert.equal(await page.getByRole('img', { name: '时序图预览', exact: true }).count(), 1)
    assert(await page.getByLabel('图标题', { exact: true }).isDisabled())
    assert.equal(await page.getByRole('button', { name: '保存图内容', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '新建时序图', exact: true }).count(), 0)
    assert.equal(await page.getByRole('region', { name: '关联对象选择器', exact: true }).count(), 0)
    assert.equal(await page.getByRole('link', { name: '任务：合成任务', exact: true }).count(), 1)
    assert.equal((await saved()).id, firstId)
    await page.screenshot({ path: path.join(evidence, 'integration-viewer-readonly.png'), fullPage: true })
    await page.evaluate(token => localStorage.setItem('aim.token', token), fixture.pmToken)
    await page.reload()
    await page.getByRole('heading', { name: '编辑图：元数据已保存', exact: true }).waitFor()
    await page.getByLabel('图标题', { exact: true }).fill('必须清除的草稿')
  })
  await check('late sensitivity through the real setter hides the diagram even from whitelist VIEWER after unlink and clears drafts', async () => {
    await page.evaluate(async ({ id, taskId, viewerId }) => {
      const api = await import('/src/pages/uml/api.ts')
      const response = await fetch(`/api/tasks/${taskId}/sensitivity`, { method: 'PUT', headers: {
        'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('aim.token')}`,
      }, body: JSON.stringify({ isSensitive: true, visibleMemberIds: [viewerId] }) })
      await response.text()
      if (response.status !== 200) throw new Error(`Real sensitivity setter failed: ${response.status}`)
      // The originally ordinary task was already linked; B's transaction must propagate the guard.
      await api.patchUml(id, { taskIds: [] })
    }, { id: firstId, taskId: fixture.taskId, viewerId: fixture.viewerId })
    await page.evaluate(token => localStorage.setItem('aim.token', token), fixture.viewerToken)
    const deniedStatus = await page.evaluate(async id => {
      const response = await fetch(`/api/uml-diagrams/${id}`, { headers: { Authorization: `Bearer ${localStorage.getItem('aim.token')}` } })
      await response.text()
      return response.status
    }, firstId)
    assert.equal(deniedStatus, 404, 'Restricted diagram must be hidden by the actual API before focus revalidation')
    const revalidation = page.waitForResponse(response => new URL(response.url()).pathname === `/api/uml-diagrams/${firstId}` && response.request().method() === 'GET')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    assert.equal((await revalidation).status(), 404)
    await page.getByRole('alert').filter({ hasText: '图不存在' }).waitFor()
    assert.equal(await page.getByLabel('图标题', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('region', { name: '关联对象选择器', exact: true }).count(), 0)
    assert.equal(await page.getByText('合成敏感任务', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('img', { name: '时序图预览', exact: true }).count(), 0)
    assert.equal(await page.getByRole('link', { name: '任务：合成任务', exact: true }).count(), 0)
    await page.reload()
    await page.getByRole('alert').filter({ hasText: '图不存在' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '新建时序图', exact: true }).count(), 0)
  })
  await check('PM deletes via confirmed actual DELETE, then document is absent after refresh', async () => {
    await page.evaluate(token => localStorage.setItem('aim.token', token), fixture.pmToken)
    await page.reload()
    await page.getByRole('heading', { name: '编辑图：元数据已保存', exact: true }).waitFor()
    await page.getByRole('button', { name: '删除此图', exact: true }).click()
    await page.getByRole('button', { name: '确认删除', exact: true }).click()
    await page.getByText('可见图共 1 张', { exact: true }).waitFor()
    assert.equal(await currentId(), null)
    await page.reload()
    await page.getByText('可见图共 1 张', { exact: true }).waitFor()
    const status = await page.evaluate(async id => {
      const r = await fetch(`/api/uml-diagrams/${id}`, { headers: { Authorization: `Bearer ${localStorage.getItem('aim.token')}` } }); await r.text(); return r.status
    }, firstId)
    assert.equal(status, 404)
  })
  await check('PM edits use-case relations/labels through the production component and restores SVG after real save/refresh', async () => {
    await page.getByRole('button', { name: '新建用例图', exact: true }).click()
    await page.getByLabel('图标题', { exact: true }).fill('真实保存用例图')
    await page.getByRole('button', { name: '添加参与者', exact: true }).click()
    await page.getByRole('button', { name: '添加用例', exact: true }).click()
    await page.getByRole('button', { name: '添加用例', exact: true }).click()
    await page.getByRole('button', { name: '添加关系', exact: true }).click()
    await page.getByLabel('关系 1 说明', { exact: true }).fill('关联说明')
    await page.getByRole('button', { name: '添加关系', exact: true }).click()
    await page.getByLabel('关系 2 类型', { exact: true }).selectOption('INCLUDE')
    await page.getByLabel('关系 2 说明', { exact: true }).fill('包含校验')
    await page.getByRole('button', { name: '创建并保存全部', exact: true }).click()
    await page.getByRole('heading', { name: '编辑图：真实保存用例图', exact: true }).waitFor()
    await page.reload()
    await page.getByRole('heading', { name: '编辑图：真实保存用例图', exact: true }).waitFor()
    assert.equal((await saved()).edges.length, 2)
    assert.deepEqual((await saved()).edges.map(e => e.label).sort(), ['关联说明', '包含校验'].sort())
    assert.equal(await page.getByRole('img', { name: '用例图预览', exact: true }).count(), 1)
    await page.screenshot({ path: path.join(evidence, 'integration-use-case.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    await page.setViewportSize({ width: 1440, height: 1000 })
  })
  await check('a real empty project shows all four empty picker states without borrowing other project candidates', async () => {
    const before = page.url()
    await page.goto(entry(fixture.emptyProjectId))
    await page.getByText('可见图共 0 张', { exact: true }).waitFor()
    await page.getByRole('button', { name: '新建用例图', exact: true }).click()
    for (const label of ['业务目标', '用户活动', '用户故事', '任务']) {
      await page.getByText(`暂无可选${label}`, { exact: true }).waitFor()
    }
    assert.equal(await page.getByRole('checkbox').count(), 0)
    await page.goto(before)
    await page.getByRole('heading', { name: '编辑图：真实保存用例图', exact: true }).waitFor()
  })
  if (formal) await check('saved task link reaches and focuses the visible row through actual routing, refresh, hash changes and history', async () => {
    const diagram = await page.evaluate(async ({ projectId, taskId }) => {
      const api = await import('/src/pages/uml/api.ts')
      return api.createUml(projectId, { title: '正式目标行验收', kind: 'USECASE', taskIds: [taskId], nodes: [], edges: [] })
    }, { projectId: fixture.projectId, taskId: fixture.taskId })
    await page.goto(`${entry(fixture.projectId)}?diagram=${diagram.id}`)
    await page.getByRole('link', { name: '任务：合成任务', exact: true }).click()
    const rowId = `task-${fixture.taskId}`
    await page.locator(`[id="${rowId}"]`).waitFor()
    await page.waitForFunction(id => document.activeElement?.id === id, rowId)
    await page.reload()
    await page.waitForFunction(id => document.activeElement?.id === id, rowId)
    const before = requests.length
    await page.evaluate(() => { location.hash = '#task-%ZZ' })
    await page.evaluate(() => { location.hash = '#task-unknown-synthetic-id' })
    await page.evaluate(() => { location.hash = '' })
    await page.evaluate(taskId => { location.hash = `#task-${encodeURIComponent(taskId)}` }, fixture.restrictedTaskId)
    await page.waitForFunction(id => document.activeElement?.id === id, `task-${fixture.restrictedTaskId}`)
    await page.goBack()
    await page.evaluate(taskId => { location.hash = `#task-${encodeURIComponent(taskId)}` }, fixture.taskId)
    await page.waitForFunction(id => document.activeElement?.id === id, rowId)
    await page.goBack()
    await page.goForward()
    await page.waitForFunction(id => document.activeElement?.id === id, rowId)
    assert(!requests.slice(before).some(request => request.path.includes('unknown-synthetic-id')))
    await page.screenshot({ path: path.join(evidence, 'formal-task-anchor.png'), fullPage: true })
  })
  assert.equal(pageErrors.length, 0, JSON.stringify(pageErrors))
  assert(requests.filter(r => r.method !== 'GET').every(r => r.hasAuthorization))
  await writeFile(path.join(evidence, 'integration-browser-results.json'), JSON.stringify({ checks, requests, pageErrors,
    limitations: [formal ? 'Synthetic isolated migrated DB; production app routes and ProjectLayout used, no test UML registration' : 'Synthetic isolated migrated DB and explicit test registration, not production mounting', 'Association-time and later-target-sensitivity guards integrated; unknown unlinked history and formal mounting/task anchor are not accepted by these component checks', formal ? 'Actual visible task anchor exercised; unknown unlinked diagram history remains outside this fixture' : 'Task href only, target anchor not exercised', 'No real project data or credentials archived'] }, null, 2))
  console.log(`PASS ${checks.length} real-API browser checks; no full-ticket acceptance claimed`)
} catch (error) {
  const alerts = page ? await page.getByRole('alert').allTextContents().catch(() => []) : []
  const diagnostics = { error: String(error), checks, alerts, requests, requestFailures, pageErrors }
  await writeFile(path.join(evidence, 'integration-failure.json'), JSON.stringify(diagnostics, null, 2))
  console.error(JSON.stringify({ alerts, recentRequests: requests.slice(-12), requestFailures, pageErrors }))
  if (page) await page.screenshot({ path: path.join(evidence, 'integration-failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally {
  if (browser) await browser.close()
  if (server.connected) server.send('close')
}
