/**
 * B 的 AI 公共接入冒烟（真实 HTTP，LOCAL_STUB）
 * 覆盖：PM 生成/列表/处置、幂等重放、MEMBER 只读、敏感故事不可见、VIEWER、outsider、DB 落库。
 */
const { execFileSync, spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const WT = '/home/lee/aim-wt/b-ai-store'
const DB = `/tmp/ai-smoke-${process.pid}.db`
const PORT = 3300 + (process.pid % 300)
const BASE = `http://127.0.0.1:${PORT}`
const DB_URL = `file:${DB}`

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function req(method, url, { token, body } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let json = null
  const text = await res.text()
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, body: json }
}

async function login(account) {
  const r = await req('POST', '/auth/login', { body: { account, password: 'Passw0rd!' } })
  if (r.status !== 200) throw new Error(`login ${account} → ${r.status} ${JSON.stringify(r.body)}`)
  return r.body.token
}

async function main() {
  // 1) 全新库
  for (const f of [DB, DB + '-journal']) if (fs.existsSync(f)) fs.unlinkSync(f)
  const env = { ...process.env, DATABASE_URL: DB_URL, PRISMA_CLIENT_PATH: path.join(WT, 'node_modules/.prisma/client') }
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: WT, env, stdio: 'pipe' })
  execFileSync('npx', ['tsx', 'src/db/seed.ts'], { cwd: WT, env, stdio: 'pipe' })
  check('空库 migrate deploy + seed', true)

  // 2) 起服务
  const server = spawn('npx', ['tsx', 'src/server.ts'], {
    cwd: WT, env: { ...env, PORT: String(PORT), DATABASE_URL: DB_URL }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let serverLog = ''
  server.stdout.on('data', d => { serverLog += d })
  server.stderr.on('data', d => { serverLog += d })
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/health'); if (r.ok) break } catch { /* retry */ }
    await sleep(500)
  }

  try {
    const pm = await login('pm')
    const member = await login('member1')
    const viewer = await login('viewer1')
    const outsider = await login('outsider')
    check('五个演示账号可登录（pm/member1/viewer1/outsider）', true)

    // 3) 建结构：goal → activity → story A（普通）+ story B（敏感）
    const proj = await req('GET', '/projects', { token: pm })
    const projectId = (proj.body.items || proj.body)[0].id
    const goal = await req('POST', `/projects/${projectId}/goals`, { token: pm, body: { name: 'AI 冒烟目标' } })
    const goalId = goal.body.id
    const act = await req('POST', `/goals/${goalId}/activities`, { token: pm, body: { name: 'AI 冒烟活动' } })
    const activityId = act.body.id
    const storyBody = {
      title: '冒烟故事', roleText: '采购员', capabilityText: '提交采购申请',
      valueText: '缩短审批时间', businessValue: 'HIGH', priority: 'P1',
    }
    const sA = await req('POST', `/activities/${activityId}/stories`, { token: pm, body: storyBody })
    const sB = await req('POST', `/activities/${activityId}/stories`, { token: pm, body: { ...storyBody, title: '敏感冒烟故事' } })
    const storyA = sA.body.id, storyB = sB.body.id
    const sens = await req('PUT', `/stories/${storyB}/sensitivity`, { token: pm, body: { isSensitive: true, visibleMemberIds: [] } })
    check('建 goal/activity/2 story + 标记 story B 敏感', sA.status === 201 && sB.status === 201 && sens.status === 200,
      `sA=${sA.status} sB=${sB.status} sens=${sens.status} ${sA.status !== 201 ? JSON.stringify(sA.body).slice(0, 160) : ''}${sens.status !== 200 ? JSON.stringify(sens.body).slice(0, 120) : ''}`)

    const AI = (sid) => `/projects/${projectId}/stories/${sid}/ai-suggestions`

    // 4) PM 生成
    const gen = await req('POST', AI(storyA), { token: pm, body: {} })
    check('PM POST generate → 201 且 status 非终态', gen.status === 201, `${gen.status} status=${gen.body.status} model=${gen.body.model?.name}/${gen.body.model?.version} ${gen.status !== 201 ? JSON.stringify(gen.body).slice(0, 180) : ''}`)
    const sid = gen.body.id
    check('生成记录含输入范围/快照指纹/生成时间', !!gen.body.inputScope && !!gen.body.snapshot?.fingerprint && !!gen.body.generation?.generatedAt,
      `scope=${JSON.stringify(gen.body.inputScope)} fp=${String(gen.body.snapshot?.fingerprint).slice(0, 16)}…`)

    // 5) PM 列表
    const list = await req('GET', AI(storyA), { token: pm })
    check('PM GET list → 200 且含该建议', list.status === 200 && list.body.items.some(x => x.id === sid), `n=${list.body.items?.length}`)

    // 6) PM 处置（ACCEPTED 不填理由 = 允许）
    const dis = await req('POST', `${AI(storyA)}/${sid}/disposition`, { token: pm, body: { decision: 'ACCEPTED', requestId: 'smoke-accept-1' } })
    check('ACCEPTED 不填理由被接受（B 裁定：仅 MODIFIED/REJECTED 必填）', dis.status === 200, `${dis.status}`)
    check('PM ACCEPTED 处置（不填理由）→ 200 且终态', dis.status === 200 && dis.body.status !== 'PENDING', `${dis.status} status=${dis.body.status}`)

    // 7) 幂等：同 requestId 同 digest → REPLAY；不同 requestId 且已终态 → 冲突
    const rid = 'smoke-replay-1'
    const d1 = await req('POST', `${AI(storyA)}/${sid}/disposition`, { token: pm, body: { decision: 'REJECTED', note: '重放测试', requestId: rid } })
    const d2 = await req('POST', `${AI(storyA)}/${sid}/disposition`, { token: pm, body: { decision: 'REJECTED', note: '重放测试', requestId: rid } })
    const d3 = await req('POST', `${AI(storyA)}/${sid}/disposition`, { token: pm, body: { decision: 'REJECTED', note: '另一个请求', requestId: 'smoke-replay-2' } })
    check('已终态建议：同 requestId 重放幂等（同一条结果）', d1.status >= 400 && d2.status >= 400 && JSON.stringify(d1.body) === JSON.stringify(d2.body),
      `first=${d1.status} replay=${d2.status} same=${JSON.stringify(d1.body) === JSON.stringify(d2.body)}`)
    check('已终态建议：不同 requestId → 冲突（唯一最终处置 + CAS）', d3.status === 409, `${d3.status} ${JSON.stringify(d3.body).slice(0, 120)}`)

    // 8) 另一条建议：MODIFIED 缺理由/缺修改后建议 → 422；齐备 → 200
    const gen2 = await req('POST', AI(storyA), { token: pm, body: {} })
    const sid2 = gen2.body.id
    const bad = await req('POST', `${AI(storyA)}/${sid2}/disposition`, { token: pm, body: { decision: 'MODIFIED', requestId: 'smoke-mod-1', modifiedSuggestion: { summary: '拆分', workItems: [{ title: 't', description: 'd', acceptanceCriteria: ['a'], sourceTrace: ['human'] }] } } })
    check('MODIFIED 缺理由 → 422（字段 note）', bad.status === 422 && JSON.stringify(bad.body).includes('note'), `${bad.status} ${JSON.stringify(bad.body).slice(0, 140)}`)
    const goodBody = { decision: 'MODIFIED', note: '需要拆分', requestId: 'smoke-mod-2', modifiedSuggestion: { summary: '拆分', workItems: [{ title: 't', description: 'd', acceptanceCriteria: ['a'], sourceTrace: ['human'] }] } }
    const good = await req('POST', `${AI(storyA)}/${sid2}/disposition`, { token: pm, body: goodBody })
    check('MODIFIED 齐备 → 200 且终态', good.status === 200 && good.body.status !== 'PENDING', `${good.status} status=${good.body.status}`)
    const replay2 = await req('POST', `${AI(storyA)}/${sid2}/disposition`, { token: pm, body: goodBody })
    check('同 requestId 同 digest 重放 → 幂等返回首次结果', replay2.status === 200 && JSON.stringify(replay2.body) === JSON.stringify(good.body), `${replay2.status}`)

    // 9) MEMBER：只读；生成/处置 403
    const mList = await req('GET', AI(storyA), { token: member })
    const mGen = await req('POST', AI(storyA), { token: member, body: {} })
    const mDis = await req('POST', `${AI(storyA)}/${sid2}/disposition`, { token: member, body: { decision: 'ACCEPTED', requestId: 'smoke-member-1' } })
    check('MEMBER GET list → 200（只读）', mList.status === 200, `${mList.status}`)
    check('MEMBER POST generate → 403', mGen.status === 403, `${mGen.status} ${mGen.status !== 403 ? JSON.stringify(mGen.body).slice(0, 140) : ''}`)
    check('MEMBER POST disposition → 403', mDis.status === 403, `${mDis.status}`)

    // 10) 敏感故事：成员读/写均 404（与不存在同一条）
    const mSens = await req('GET', AI(storyB), { token: member })
    const mSensGen = await req('POST', AI(storyB), { token: member, body: {} })
    const ghost = await req('GET', AI('00000000-0000-0000-0000-000000000000'), { token: member })
    check('MEMBER 读敏感故事建议 → 404', mSens.status === 404, `${mSens.status}`)
    check('MEMBER 对敏感故事生成 → 404', mSensGen.status === 404, `${mSensGen.status}`)
    check('敏感故事 404 与不存在故事 404 响应体逐字一致', JSON.stringify(mSens.body) === JSON.stringify(ghost.body), JSON.stringify(mSens.body).slice(0, 100))

    // 11) VIEWER 只读；outsider 404
    const vList = await req('GET', AI(storyA), { token: viewer })
    const vGen = await req('POST', AI(storyA), { token: viewer, body: {} })
    const oList = await req('GET', AI(storyA), { token: outsider })
    check('VIEWER GET list → 200；generate → 403', vList.status === 200 && vGen.status === 403, `${vList.status}/${vGen.status}`)
    check('outsider GET list → 404', oList.status === 404, `${oList.status}`)

    // 12) DB 落库核对
    const dbScript = `
      import { PrismaClient } from '@prisma/client'
      void (async () => {
      const p = new PrismaClient()
      const [s, d, a] = await Promise.all([p.aiSuggestion.count(), p.aiDisposition.count(), p.aiApplication.count()])
      const rows = await p.aiSuggestion.findMany({ select: { id: true, status: true, modelMode: true, generationStatus: true, snapshotFingerprint: true } })
      const dis = await p.aiDisposition.findMany({ select: { suggestionId: true, status: true, reason: true, disposedByUserId: true } })
      const audits = await p.auditLog.count({ where: { action: { contains: 'ai' } } })
      console.log(JSON.stringify({ s, d, a, rows, dis, audits }))
      await p.$disconnect()
      })()
    `
    const out = execFileSync('npx', ['tsx', '-e', dbScript], { cwd: WT, env, stdio: 'pipe' }).toString().trim()
    const dbInfo = JSON.parse(out.split('\n').pop())
    check('DB：AiSuggestion 2 条 / AiDisposition 2 条 / AiApplication 0 条（未应用）',
      dbInfo.s === 2 && dbInfo.d === 2 && dbInfo.a === 0, JSON.stringify({ s: dbInfo.s, d: dbInfo.d, a: dbInfo.a }))
    check('DB：处置行唯一（1:1 子表）且记录处置人/理由', dbInfo.dis.length === 2 && dbInfo.dis.every(x => x.disposedByUserId),
      JSON.stringify(dbInfo.dis.map(x => ({ st: x.status, reason: x.reason }))))
    check('DB：建议记录含模型模式与快照指纹', dbInfo.rows.every(r => r.modelMode && r.snapshotFingerprint), JSON.stringify(dbInfo.rows.map(r => ({ st: r.status, m: r.modelMode }))))
    check('未把建议写进 AuditLog（决策禁止）', dbInfo.audits === 0, `audits=${dbInfo.audits}`)

    // 13) 重启后记录仍在（持久化证明）
    server.kill('SIGTERM'); await sleep(1500)
    const server2 = spawn('npx', ['tsx', 'src/server.ts'], { cwd: WT, env: { ...env, PORT: String(PORT), DATABASE_URL: DB_URL }, stdio: ['ignore', 'pipe', 'pipe'] })
    for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + '/health'); if (r.ok) break } catch {} await sleep(500) }
    const pm2 = await login('pm')
    const list2 = await req('GET', AI(storyA), { token: pm2 })
    check('重启后 PM 仍能看到 2 条建议（真持久化）', list2.status === 200 && list2.body.items.length === 2, `n=${list2.body.items?.length}`)
    server2.kill('SIGTERM')
  } finally {
    server.kill('SIGTERM')
    await sleep(500)
    if (results.some(r => !r.ok)) fs.writeFileSync('/tmp/b-ai-smoke-server.log', serverLog)
  }

  const failed = results.filter(r => !r.ok)
  console.log(`\n==== ${results.length - failed.length}/${results.length} 通过 ====`)
  if (failed.length) { console.log('失败项：', failed.map(f => f.name).join(' | ')); process.exit(1) }
}

main().catch(e => { console.error('FATAL', e); process.exit(2) })
