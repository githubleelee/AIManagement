/** B 的域内事件生产 HTTP 证据：里程碑 + 故事状态（真实服务 + 真实 DB 行） */
const { execFileSync, spawn } = require('node:child_process')
const path = require('node:path'); const fs = require('node:fs')
const WT = '/home/lee/aim-wt/b-domain-events'
const DB = `/tmp/dom-events-${process.pid}.db`; const PORT = 3600 + (process.pid % 300)
const BASE = `http://127.0.0.1:${PORT}`; const DB_URL = `file:${DB}`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const out = []
const log = (ok, name, detail) => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); console.log(out[out.length - 1]) }

async function req(method, url, { token, body } = {}) {
  const res = await fetch(BASE + url, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j = null; try { j = JSON.parse(t) } catch { j = t }
  return { status: res.status, body: j }
}
async function login(a) { for (let i = 0; i < 10; i++) { const r = await req('POST', '/auth/login', { body: { account: a, password: 'Passw0rd!' } }); if (r.status === 200) return r.body.token; await sleep(1000) } throw new Error('login ' + a) }

function dbJson(script) {
  return JSON.parse(execFileSync('npx', ['tsx', '-e', script], { cwd: WT, env: { ...process.env, DATABASE_URL: DB_URL }, stdio: 'pipe' }).toString().trim().split('\n').pop())
}

async function main() {
  for (const f of [DB, DB + '-journal']) if (fs.existsSync(f)) fs.unlinkSync(f)
  const env = { ...process.env, DATABASE_URL: DB_URL }
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: WT, env, stdio: 'pipe' })
  execFileSync('npx', ['tsx', 'src/db/seed.ts'], { cwd: WT, env, stdio: 'pipe' })
  const server = spawn('npx', ['tsx', 'src/server.ts'], { cwd: WT, env: { ...env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] })
  let slog = ''; server.stdout.on('data', d => slog += d); server.stderr.on('data', d => slog += d)
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/health')).ok) break } catch {} await sleep(500) }

  try {
    const pm = await login('pm')
    const projects = await req('GET', '/projects', { token: pm })
    const projectId = (projects.body.items || projects.body)[0].id
    const goalId = (await req('POST', `/projects/${projectId}/goals`, { token: pm, body: { name: '事件证据目标' } })).body.id
    const activityId = (await req('POST', `/goals/${goalId}/activities`, { token: pm, body: { name: '事件证据活动' } })).body.id
    const story = (await req('POST', `/activities/${activityId}/stories`, { token: pm, body: { title: '事件证据故事', roleText: 'r', capabilityText: 'c', valueText: 'v', businessValue: 'HIGH', priority: 'P1' } })).body

    const countEvents = () => dbJson(`import { PrismaClient } from '@prisma/client'; void (async () => { const p = new PrismaClient(); console.log(JSON.stringify({ n: await p.domainEvent.count() })); await p.$disconnect() })()`).n

    // 1) 里程碑创建 → 恰好一条 gantt.milestone.created
    const before = await countEvents()
    const ms = await req('POST', `/projects/${projectId}/milestones`, { token: pm, body: { name: 'M1 事件证据', dueDate: '2026-11-30' } })
    const ev1 = dbJson(`import { PrismaClient } from '@prisma/client'; void (async () => { const p = new PrismaClient(); const e = await p.domainEvent.findMany({ orderBy: { storedAt: 'asc' } }); console.log(JSON.stringify(e.map(x => ({ name: x.eventName, obj: x.objectType + ':' + x.objectId, sensitive: x.sensitive, payload: x.payload, actor: x.actorUserId, key: x.idempotencyKey })))) ; await p.$disconnect() })()`)
    log(ms.status === 201 && ev1.length === before + 1 && ev1[ev1.length - 1].name === 'gantt.milestone.created',
      'PM 建里程碑 → 恰好一条 gantt.milestone.created', `${ms.status} n=${ev1.length} last=${JSON.stringify(ev1[ev1.length - 1])}`)
    const created = ev1[ev1.length - 1]
    log(created.obj === `milestone:${ms.body.id}` && created.sensitive === false && created.payload.name === 'M1 事件证据' && created.actor && created.key === `gantt.milestone.created:${ms.body.id}`,
      '里程碑事件：object / 非敏感载荷 / actor / 确定性幂等键正确', JSON.stringify(created))

    // 2) 故事状态变更 → 恰好一条 requirement.story.status-changed，载荷只含状态
    const n2 = await countEvents()
    const patch = await req('PATCH', `/stories/${story.id}`, { token: pm, body: { status: 'PLANNING' } })
    const ev2 = dbJson(`import { PrismaClient } from '@prisma/client'; void (async () => { const p = new PrismaClient(); const e = await p.domainEvent.findFirst({ where: { eventName: 'requirement.story.status-changed' }, orderBy: { storedAt: 'desc' } }); console.log(JSON.stringify(e && { obj: e.objectType + ':' + e.objectId, sensitive: e.sensitive, payload: e.payload, key: e.idempotencyKey })) ; await p.$disconnect() })()`)
    log(patch.status === 200 && (await countEvents()) === n2 + 1 && ev2 && ev2.payload.from === 'DRAFT' && ev2.payload.to === 'PLANNING',
      'PM 改故事状态 → 恰好一条事件且载荷只含 {from,to}', `${patch.status} ${JSON.stringify(ev2)}`)

    // 3) 同值 PATCH → 不新增事件
    const n3 = await countEvents()
    await req('PATCH', `/stories/${story.id}`, { token: pm, body: { status: 'PLANNING' } })
    log((await countEvents()) === n3, '同值 PATCH（状态未变）→ 不新增事件', `n=${await countEvents()}`)

    // 4) 敏感故事状态变更 → 敏感事件，载荷只有 references
    await req('PUT', `/stories/${story.id}/sensitivity`, { token: pm, body: { isSensitive: true, visibleMemberIds: [] } })
    const n4 = await countEvents()
    await req('PATCH', `/stories/${story.id}`, { token: pm, body: { status: 'DONE' } })
    const ev4 = dbJson(`import { PrismaClient } from '@prisma/client'; void (async () => { const p = new PrismaClient(); const e = await p.domainEvent.findFirst({ where: { eventName: 'requirement.story.status-changed' }, orderBy: { storedAt: 'desc' } }); console.log(JSON.stringify(e && { sensitive: e.sensitive, payload: e.payload, keys: Object.keys(e.payload) })) ; await p.$disconnect() })()`)
    log((await countEvents()) === n4 + 1 && ev4.sensitive === true && ev4.keys.length === 1 && ev4.keys[0] === 'references' && ev4.payload.references[0].objectType === 'story',
      '敏感故事状态变更 → 敏感事件（载荷只有 references）', JSON.stringify(ev4))

    // 5) 审计行仍在（before/after 留在 AuditLog，不在事件载荷）
    const audit = dbJson(`import { PrismaClient } from '@prisma/client'; void (async () => { const p = new PrismaClient(); const rows = await p.auditLog.findMany({ where: { action: 'story.status' }, select: { before: true, after: true } }); console.log(JSON.stringify(rows)) ; await p.$disconnect() })()`)
    log(audit.length >= 2 && JSON.stringify(audit).includes('PLANNING'), '状态变更审计行仍在（before/after 留在 AuditLog）', `rows=${audit.length}`)
  } finally {
    server.kill('SIGTERM'); await sleep(800)
    fs.writeFileSync('/tmp/dom-events-server.log', slog)
  }
  const failed = out.filter(l => l.startsWith('FAIL'))
  console.log(`\n==== ${out.length - failed.length}/${out.length} 通过 ====`)
  if (failed.length) process.exit(1)
  process.exit(0)
}
main().catch(e => { console.error('FATAL', e); try { console.error(fs.readFileSync('/tmp/dom-events-server.log', 'utf8').split('\n').slice(-15).join('\n')) } catch {} process.exit(2) })
