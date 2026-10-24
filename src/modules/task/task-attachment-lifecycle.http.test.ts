import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest'
import { mkdtemp, rm, rename, mkdir, rmdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHttpTestContext, setActiveDatabase, type HttpTestContext } from '../../../test/helpers.js'
import { makeUser, makeProject, makeMember, makeGoal, makeActivity, makeStory, makeTask } from '../../../test/factories.js'
let ctx: HttpTestContext, root: string
let pm: string, owner: string, viewer: string, other: string, projectId: string, taskId: string
const pdf = Buffer.from('%PDF-1.4\nC isolated task cleanup fixture\n')
// ★ 钩子超时显式放宽：`createHttpTestContext` 要建临时库并应用全部迁移，
//   在机器负载较高时会超过 vitest 默认的 10s `hookTimeout`，表现为
//   `Hook timed out in 10000ms` 且整个套件被 skip（用例本身没跑）。
//   本文件是真实 DB + 真实磁盘的集成测试，钩子耗时属预期，故显式给足时间。
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'c-attachment-http-'))
  ctx = await createHttpTestContext({ uploadRoot: root }); setActiveDatabase(ctx.db)
  await ctx.app.ready()
}, 120_000)
afterAll(async () => { await ctx?.dispose(); if (root) await rm(root, { recursive: true, force: true }) }, 120_000)
beforeEach(async () => {
  await ctx.reset()
  pm = (await makeUser('attach-pm@example.invalid')).id
  owner = (await makeUser('attach-owner@example.invalid')).id
  viewer = (await makeUser('attach-viewer@example.invalid')).id
  other = (await makeUser('attach-other@example.invalid')).id
  projectId = (await makeProject(pm)).projectId
  await makeMember(projectId, owner, 'MEMBER'); await makeMember(projectId, viewer, 'VIEWER'); await makeMember(projectId, other, 'MEMBER')
  const story = await makeStory(await makeActivity(await makeGoal(projectId)))
  taskId = await makeTask(story, owner, pm)
})
const client = (actor: string) => ctx.asUser(ctx.loginAs(actor))
async function upload() {
  const res = await client(owner).post(`/tasks/${taskId}/attachments`).set('Content-Type', 'application/pdf')
    .set('X-File-Name', encodeURIComponent('合成附件.pdf')).send(pdf)
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  const row = await ctx.db.attachment.findUniqueOrThrow({ where: { id: res.body.id } })
  return { id: row.id, path: join(root, row.storagePath) }
}
describe('real task DELETE consumes the injected attachment lifecycle', () => {
  it('real upload then task DELETE removes task, attachment row and actual file after commit', async () => {
    const file = await upload(); expect(existsSync(file.path)).toBe(true)
    const res = await client(pm).delete(`/tasks/${taskId}`)
    expect(res.status).toBe(204)
    expect(await ctx.db.task.findUnique({ where: { id: taskId } })).toBeNull()
    expect(await ctx.db.attachment.findUnique({ where: { id: file.id } })).toBeNull()
    expect(existsSync(file.path)).toBe(false)
    const gone = await client(owner).get(`/attachments/${file.id}/download`)
    const missing = await client(owner).get('/attachments/missing/download')
    expect(gone.status).toBe(404); expect(gone.body).toEqual(missing.body)
  })
  it('a real database deletion failure rolls back the attachment mark and visibility cleanup, without deleting files', async () => {
    const file = await upload()
    await ctx.db.objectVisibility.create({ data: { projectId, objectType: 'task', objectId: taskId, userId: owner } })
    await ctx.db.$executeRawUnsafe('CREATE TRIGGER c_block_task_delete BEFORE DELETE ON "Task" BEGIN SELECT RAISE(ABORT, \'C rollback probe\'); END')
    try {
      expect((await client(pm).delete(`/tasks/${taskId}`)).status).toBe(500)
      expect(await ctx.db.task.findUnique({ where: { id: taskId } })).not.toBeNull()
      expect(await ctx.db.attachment.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({ state: 'ACTIVE', taskId, cleanupAttempts: 0 })
      expect(await ctx.db.objectVisibility.count({ where: { objectId: taskId } })).toBe(1)
      expect(existsSync(file.path)).toBe(true)
    } finally { await ctx.db.$executeRawUnsafe('DROP TRIGGER c_block_task_delete') }
  })
  it('real file deletion failure keeps retry state; the actual 30s background loop recovers without a manual cleanup call', async () => {
    const file = await upload(), held = `${file.path}.held`
    await rename(file.path, held); await mkdir(file.path)
    expect((await client(pm).delete(`/tasks/${taskId}`)).status).toBe(204)
    expect(await ctx.db.task.findUnique({ where: { id: taskId } })).toBeNull()
    expect(await ctx.db.attachment.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({ state: 'CLEANUP_FAILED', taskId: null, cleanupAttempts: 1 })
    await rmdir(file.path); await rename(held, file.path)
    // This waits for the existing production interval, not a test-invoked lifecycle.run().
    await new Promise(resolve => setTimeout(resolve, 31_000))
    expect(await ctx.db.attachment.findUnique({ where: { id: file.id } })).toBeNull()
    expect(existsSync(file.path)).toBe(false)
  }, 40_000)
  it.each(['owner', 'viewer', 'other'] as const)('%s cannot delete a task or trigger cleanup', async identity => {
    const file = await upload(), actor = { owner, viewer, other }[identity]
    expect((await client(actor).delete(`/tasks/${taskId}`)).status).toBe(403)
    expect(await ctx.db.attachment.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({ state: 'ACTIVE', taskId })
    expect(existsSync(file.path)).toBe(true)
  })
  it('sensitive revocation hides download and list with the exact unknown-object envelope', async () => {
    const file = await upload()
    expect((await client(pm).put(`/tasks/${taskId}/sensitivity`).send({ isSensitive: true, visibleMemberIds: [] })).status).toBe(200)
    for (const actor of [viewer, other]) {
      const hidden = await client(actor).get(`/attachments/${file.id}/download`)
      const missing = await client(actor).get('/attachments/missing/download')
      expect(hidden.status).toBe(404); expect(hidden.body).toEqual(missing.body)
      expect((await client(actor).get(`/tasks/${taskId}/attachments`)).status).toBe(404)
    }
    expect(existsSync(file.path)).toBe(true)
  })
})
