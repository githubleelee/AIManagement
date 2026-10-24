/** Live Chromium component verification using synthetic transport, NOT final US12 acceptance.
 * Run from repository root: node src/modules/ai-scheduling/browser-smoke.mjs
 * Requires the already installed Playwright Chromium headless shell, no new dependency.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const evidence = resolve(process.env.SCHEDULING_EVIDENCE_DIR ?? 'docs/role-c/evidence/issue-32-local-completion')
const chromePath = process.env.SCHEDULING_TEST_CHROME ?? join(process.env.LOCALAPPDATA ?? '',
  'ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe')
const profile = await mkdtemp(join(tmpdir(), 'us12-component-'))
const server = await createServer({ configFile: 'web/vite.config.ts',
  server: { host: '127.0.0.1', port: 5198, strictPort: true } })
let chrome, socket
const checks = []
const exceptions = []
try {
  await mkdir(evidence, { recursive: true })
  await server.listen()
  chrome = spawn(chromePath, ['--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] })
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chromium startup timeout')), 20000)
    chrome.once('error', (error) => { clearTimeout(timer); reject(error) })
    let output = ''
    chrome.stderr.on('data', (data) => {
      output += data
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
  })
  const debuggerBase = new URL(endpoint)
  const target = await (await fetch(`http://${debuggerBase.host}/json/new?about:blank`, { method: 'PUT' })).json()
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let sequence = 0
  const pending = new Map()
  const events = new Map()
  const event = (method) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { events.delete(method); reject(new Error(`CDP event timeout: ${method}`)) }, 15000)
    events.set(method, (value) => { clearTimeout(timer); resolve(value) })
  })
  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data)
    if (data.method === 'Runtime.exceptionThrown') exceptions.push(data.params.exceptionDetails.text)
    if (events.has(data.method)) { events.get(data.method)(data.params); events.delete(data.method) }
    const promise = pending.get(data.id)
    if (promise) { pending.delete(data.id); clearTimeout(promise.timer); data.error ? promise.reject(new Error(JSON.stringify(data.error))) : promise.resolve(data.result) }
  })
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description)
    return result.result.value
  }
  const wait = (expression) => evaluate(`(async()=>{for(let i=0;i<100;i++){if(${expression})return true;await new Promise(r=>setTimeout(r,30))}throw new Error('DOM assertion timeout')})()`)
  const click = (text) => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)});if(!b||b.disabled)throw new Error('button unavailable: '+${JSON.stringify(text)});b.click()})()`)
  const fill = (text) => evaluate(`(()=>{const t=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(text)});t.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await call('Runtime.enable')
  await call('Page.enable')
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false })
  const url = 'http://127.0.0.1:5198/src/pages/scheduling/browser.fixture.html'
  const firstLoad = event('Page.loadEventFired')
  await call('Page.navigate', { url })
  await firstLoad
  await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='synthetic-suggestion · PENDING')")
  await click('synthetic-suggestion · PENDING')
  await wait("document.body.textContent.includes('SYNTHETIC-COMPONENT-TASK')")
  checks.push('authorized synthetic list/detail render')
  await click('校验当前日期')
  await wait("document.body.textContent.includes('Synthetic advisory warning')")
  checks.push('sanitized date assessment warnings and workload render')
  await click('采纳')
  await wait("document.body.textContent.includes('重试同一请求')")
  assert.equal(await evaluate('window.schedulingProbe.applicationCount'), 1)
  assert.equal(await evaluate('document.querySelector("textarea").disabled'), true)
  checks.push('lost response after synthetic server commit locks unresolved input')
  await click('重试同一请求')
  await wait("document.body.textContent.includes('正式计划已应用') && !document.body.textContent.includes('重试同一请求')")
  const state = await evaluate('window.schedulingProbe')
  assert.equal(state.requests.length, 2)
  assert.equal(state.requests[0], state.requests[1])
  assert.equal(state.applicationCount, 1)
  checks.push('retry preserves request id and applies once in synthetic transport')
  const applied = await call('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(evidence, 'component-applied.png'), Buffer.from(applied.data, 'base64'))
  const nextLoad = event('Page.loadEventFired')
  await call('Page.reload', { ignoreCache: true })
  await nextLoad
  await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='synthetic-suggestion · PENDING')")
  await evaluate('window.schedulingProbe.sourceStale=true')
  await click('synthetic-suggestion · PENDING')
  await wait("document.body.textContent.includes('来源已变化，禁止采纳')")
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='采纳').disabled"), true)
  await fill('Synthetic stale rejection')
  await wait("[...document.querySelectorAll('button')].find(b=>b.textContent==='拒绝').disabled===false")
  checks.push('stale source blocks adoption but permits rejection with reason')
  const stale = await call('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(evidence, 'component-stale.png'), Buffer.from(stale.data, 'base64'))
  await evaluate('window.schedulingProbe.readDenied=true')
  await click('刷新核对')
  await wait("document.body.textContent.includes('已清除页面数据')")
  assert.equal(await evaluate("document.body.textContent.includes('SYNTHETIC-COMPONENT-TASK')"), false)
  checks.push('HTTP-style 403 clears detail and draft')
  await evaluate("document.querySelector('#revoke-parent').click()")
  await wait("document.body.textContent.includes('当前账号不能访问排期建议')")
  assert.equal(await evaluate("document.querySelector('textarea')===null"), true)
  checks.push('mount authorization revocation unmounts workspace')
  assert.deepEqual(exceptions, [])
  checks.push('no uncaught browser exceptions')
  const result = { kind: 'synthetic-component-only', finalUS12Acceptance: false, checks, passed: checks.length, exceptions }
  await writeFile(join(evidence, 'browser-component-result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  await writeFile(join(evidence, 'browser-component-failure.json'), JSON.stringify({
    kind: 'synthetic-component-only', checks, exceptions, error: error.message,
  }, null, 2) + '\n')
  throw error
} finally {
  socket?.close()
  if (chrome && chrome.exitCode === null) {
    await new Promise((resolve) => { chrome.once('exit', resolve); chrome.kill() })
  }
  await server.close()
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
