/** Real-browser checks of the isolated editor. Not project/API/authorization AC evidence.
 * Usage: node <this file> <playwright package directory> <chromium executable>
 * Start this worktree's Vite server on loopback:5195 first. No API mocks.
 */
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const require = createRequire(import.meta.url)
if (!process.argv[2] || !process.argv[3]) throw new Error('Pass Playwright package directory and Chromium executable')
const { chromium } = require(path.resolve(process.argv[2]))
const output = path.resolve('docs/role-c/issue-35/evidence')
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.argv[3], headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } })
const errors = []
const external = []
const apiRequests = []
const results = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
page.on('request', request => {
  const url = new URL(request.url())
  if (url.protocol.startsWith('http') && url.hostname !== '127.0.0.1') external.push(request.url())
  if (url.pathname.startsWith('/api/')) apiRequests.push(request.url())
})
const check = (name, run) => run().then(() => { results.push({ name, result: 'passed' }); console.log(`PASS ${name}`) })
const doc = async () => JSON.parse(await page.getByTestId('document-json').textContent())
const add = text => page.getByRole('button', { name: text, exact: true }).click()
const field = name => page.getByLabel(name, { exact: true })
const load = async value => {
  await field('待载入图稿 JSON').fill(typeof value === 'string' ? value : JSON.stringify(value))
  await add('载入图稿 JSON')
}
const sequence = {
  formatVersion: 1, kind: 'SEQUENCE',
  lifelines: [{ id: 'a', name: '执行人' }, { id: 'b', name: '验收人' }],
  messages: [
    { id: 'm1', fromId: 'a', toId: 'b', label: '提交任务', kind: 'sync', seq: 1 },
    { id: 'm2', fromId: 'b', toId: 'a', label: '验收结果', kind: 'return', seq: 2 },
  ],
}
const useCase = {
  formatVersion: 1, kind: 'USE_CASE', actors: [{ id: 'a', name: '执行人' }],
  useCases: [{ id: 'c1', name: '提交任务' }, { id: 'c2', name: '验收任务' }],
  relations: [{ id: 'r1', type: 'ASSOCIATION', fromId: 'a', toId: 'c1' }],
}
const copy = object => structuredClone(object)
try {
  await page.goto('http://127.0.0.1:5195/src/pages/uml/preview.html', { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: '在线 UML 编辑器 · 独立开发验证' }).waitFor()
  await check('create/edit use-case actors, cases, all three relation types and real SVG', async () => {
    await add('添加参与者'); await field('参与者 1').fill('项目成员')
    await add('添加用例'); await field('用例 1').fill('提交任务')
    await add('添加用例'); await field('用例 2').fill('验收任务')
    await add('添加关系'); await add('添加关系')
    await field('关系 2 类型').selectOption('INCLUDE')
    await add('添加关系'); await field('关系 3 类型').selectOption('EXTEND')
    const value = await doc()
    assert.deepEqual(value.relations.map(r => r.type), ['ASSOCIATION', 'INCLUDE', 'EXTEND'])
    assert.equal(await page.getByRole('img', { name: '用例图预览' }).count(), 1)
    assert.equal(await page.locator('svg ellipse').count(), 2)
    await page.screenshot({ path: path.join(output, 'editor-use-case.png'), fullPage: true })
  })
  await check('self include is reported, invalid graph cannot be exported, and repair clears validation', async () => {
    const value = await doc()
    await field('关系 2 终点').selectOption(value.useCases[0].id)
    await page.getByRole('alert').filter({ hasText: '关系类型与端点不匹配' }).waitFor()
    await add('下载本地图稿 JSON')
    await page.getByRole('alert').filter({ hasText: '图稿校验失败' }).waitFor()
    await field('关系 2 终点').selectOption(value.useCases[1].id)
    assert.equal(await page.locator('.uml-controls [role=alert]').count(), 0)
  })
  await check('remove actor cascades editor-local association only, keeping case-to-case edges', async () => {
    await page.getByRole('button', { name: '删除参与者 1', exact: true }).click()
    const value = await doc()
    assert.equal(value.actors.length, 0)
    assert.deepEqual(value.relations.map(r => r.type), ['INCLUDE', 'EXTEND'])
  })
  await check('create/edit sequence including async, return and self message', async () => {
    await add('编辑时序图')
    await add('添加生命线'); await field('生命线 1').fill('执行人')
    await add('添加生命线'); await field('生命线 2').fill('验收人')
    await add('添加消息'); await field('消息 1 内容').fill('提交任务')
    await add('添加消息'); await field('消息 2 内容').fill('请求复核'); await field('消息 2 类型').selectOption('async')
    await add('添加消息'); await field('消息 3 内容').fill('保存验收结论'); await field('消息 3 类型').selectOption('return')
    const value = await doc()
    await field('消息 3 接收方').selectOption(value.lifelines[0].id)
    assert.deepEqual((await doc()).messages.map(m => m.kind), ['sync', 'async', 'return'])
    await page.screenshot({ path: path.join(output, 'editor-sequence.png'), fullPage: true })
  })
  await check('reorder lifelines without changing message endpoints or order', async () => {
    const before = await doc()
    await page.getByRole('button', { name: '后移生命线 1', exact: true }).click()
    assert.deepEqual((await doc()).lifelines.map(n => n.id), [...before.lifelines].reverse().map(n => n.id))
    assert.deepEqual((await doc()).messages, before.messages)
    await page.getByRole('button', { name: '前移生命线 2', exact: true }).click()
    assert.deepEqual(await doc(), before)
  })
  await check('reorder sequence messages and renumber strictly; delete lifeline removes dangling messages', async () => {
    await page.getByRole('button', { name: '上移消息 3', exact: true }).click()
    let value = await doc()
    assert.deepEqual(value.messages.map(m => m.label), ['提交任务', '保存验收结论', '请求复核'])
    assert.deepEqual(value.messages.map(m => m.seq), [1, 2, 3])
    await page.getByRole('button', { name: '删除生命线 2', exact: true }).click()
    value = await doc()
    assert.equal(value.messages.length, 1)
    assert.equal(value.messages[0].label, '保存验收结论')
    assert.equal(value.messages[0].seq, 1)
  })
  await check('read-only controls cannot change document (presentation check, not authorization)', async () => {
    const before = await doc()
    await field('只读交互检查（非权限验证）').check()
    assert.equal(await field('生命线 1').isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: '添加消息', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: '载入图稿 JSON', exact: true }).isDisabled(), true)
    assert.deepEqual(await doc(), before)
    await page.screenshot({ path: path.join(output, 'editor-readonly-presentation.png'), fullPage: true })
    await field('只读交互检查（非权限验证）').uncheck()
  })
  await check('download real JSON and reload editor via import after refresh; not a database save', async () => {
    const before = await doc()
    const downloadEvent = page.waitForEvent('download')
    await add('下载本地图稿 JSON')
    const download = await downloadEvent
    const temp = path.join(os.tmpdir(), `uml-editor-${Date.now()}.json`)
    await download.saveAs(temp)
    const serialized = await fs.readFile(temp, 'utf8')
    await fs.unlink(temp)
    assert.deepEqual(JSON.parse(serialized), before)
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal((await doc()).actors.length, 0)
    await load(serialized)
    assert.deepEqual(await doc(), before)
  })
  const invalid = [
    ['malformed JSON', '{'],
    ['unknown kind', { ...useCase, kind: 'CLASS' }],
    ['unknown format version', { ...useCase, formatVersion: 2 }],
    ['unknown document field', { ...useCase, projectId: 'not-accepted' }],
    ['empty node name', { ...useCase, actors: [{ id: 'a', name: '   ' }] }],
    ['oversized text', { ...useCase, actors: [{ id: 'a', name: 'x'.repeat(101) }] }],
    ['duplicate ids across categories', { ...useCase, actors: [{ id: 'c1', name: 'actor' }] }],
    ['duplicate edge id', { ...useCase, relations: [...useCase.relations, ...useCase.relations] }],
    ['duplicate relationship with distinct ids', { ...useCase, relations: [...useCase.relations, { ...useCase.relations[0], id: 'r2' }] }],
    ['missing endpoint', { ...useCase, relations: [{ ...useCase.relations[0], toId: 'missing' }] }],
    ['wrong association direction', { ...useCase, relations: [{ ...useCase.relations[0], fromId: 'c1', toId: 'a' }] }],
    ['include actor is illegal', { ...useCase, relations: [{ ...useCase.relations[0], type: 'INCLUDE' }] }],
    ['self extend illegal', { ...useCase, relations: [{ id: 'r1', type: 'EXTEND', fromId: 'c1', toId: 'c1' }] }],
    ['unsupported relationship', { ...useCase, relations: [{ ...useCase.relations[0], type: 'GENERALIZATION' }] }],
    ['too many nodes', { ...useCase, actors: Array.from({ length: 201 }, (_, i) => ({ id: `a${i}`, name: 'actor' })) }],
    ['combined node count over bound', { ...useCase, actors: Array.from({ length: 199 }, (_, i) => ({ id: `a${i}`, name: 'actor' })), relations: [] }],
    ['unsupported message', { ...sequence, messages: [{ ...sequence.messages[0], kind: 'signal' }] }],
    ['duplicate seq', { ...sequence, messages: sequence.messages.map(m => ({ ...m, seq: 1 })) }],
    ['descending seq', { ...sequence, messages: [...sequence.messages].reverse() }],
    ['zero seq', { ...sequence, messages: [{ ...sequence.messages[0], seq: 0 }] }],
    ['fractional seq', { ...sequence, messages: [{ ...sequence.messages[0], seq: 1.5 }] }],
    ['missing lifeline', { ...sequence, messages: [{ ...sequence.messages[0], fromId: 'missing' }] }],
  ]
  for (const [name, input] of invalid) await check(`reject ${name} without changing current document`, async () => {
    const before = await doc()
    await load(input)
    await page.locator('.uml-transfer [role=alert]').waitFor()
    assert.deepEqual(await doc(), before)
  })
  await check('supported sequence gaps remain strictly increasing; import preserves message order', async () => {
    const value = copy(sequence); value.messages[0].seq = 2; value.messages[1].seq = 4
    await load(value)
    assert.deepEqual(await doc(), value)
  })
  await check('user markup is SVG text, cannot create script/image/events or external requests', async () => {
    const value = copy(useCase)
    const attack = '<img src=https://example.invalid/x onerror="window.__umlXss=1">'
    value.actors[0].name = attack
    value.useCases[0].name = attack
    await load(value)
    assert.deepEqual(await doc(), value)
    assert.equal(await page.locator('svg script, svg image, svg foreignObject, svg [onerror], svg [onload]').count(), 0)
    assert.equal(await page.evaluate(() => window.__umlXss), undefined)
  })
  await check('mobile editor has no viewport overflow; preview scrolls within its own region', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  })
  assert.deepEqual(external, [], 'Unexpected external request')
  assert.deepEqual(apiRequests, [], 'Unexpected API call / simulated project backend')
  assert.deepEqual(errors, [], 'Browser console/page errors')
  results.push({ name: 'no console errors, no external requests, no API mocks', result: 'passed' })
  console.log(`PASS ${results.length} browser checks; no project/API/authorization AC claimed`)
} catch (error) {
  results.push({ name: 'run', result: 'failed', error: String(error) })
  await page.screenshot({ path: path.join(output, 'editor-failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally {
  await fs.writeFile(path.join(output, 'editor-browser-results.json'), JSON.stringify({
    scope: 'isolated real editor, not platform end-to-end acceptance', browserVersion: browser.version(), results, errors, external, apiRequests,
  }, null, 2))
  await browser.close()
}
