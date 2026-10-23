/**
 * #36 任务附件 —— DB 仓储 + 权限适配器 + HTTP 链路测试（ROLE-B 单写）
 *
 * 覆盖：
 *   ① 上传 / 列表 / 下载 / 删除 happy path（含 `Content-Disposition: attachment`）；
 *   ② 扩展名 + MIME 联合校验与 10MB 上限；
 *   ③ 敏感任务隔离：MEMBER 读 / 写 / 下载 → 404 且与不可见任务响应体逐字一致；PM 正常；
 *   ⑥（部分）列表只返回 ACTIVE（DELETING / CLEANUP_FAILED 对用户不可见）。
 *
 * 说明：本文件用真实生产装配（`createTestContext` → `buildApp` → `registerRoutes`）走 HTTP，
 * 因此同时验证了 `src/app.ts` 的依赖注入与 `src/routes.ts` 的路由注册。
 */
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, type HttpTestContext } from '../../test/helpers.js'
import {
  makeActivity,
  makeGoal,
  makeMember,
  makeProject,
  makeSensitive,
  makeStory,
  makeTask,
  makeUser,
} from '../../test/factories.js'

const UPLOAD_ROOT = resolve(process.cwd(), 'var/uploads')

let ctx: HttpTestContext

beforeAll(async () => {
  ctx = await createTestContext()
}, 120_000)

afterAll(async () => {
  await ctx.dispose()
  // 生产装配的 LocalAttachmentStorage 落项目根 var/uploads/（已 gitignore）；
  // 清掉本文件产生的实体文件，避免污染工作区。
  rmSync(UPLOAD_ROOT, { recursive: true, force: true })
})

beforeEach(async () => {
  await ctx.reset()
})

type Seed = {
  pm: { id: string }
  member: { id: string }
  viewer: { id: string }
  outsider: { id: string }
  projectId: string
  taskId: string
}

/** 造一个含 PM / MEMBER / VIEWER / outsider 的项目与任务（默认成员是任务负责人）。 */
async function seedTask(): Promise<Seed> {
  const pm = await makeUser('attach.pm', '项目经理')
  const member = await makeUser('attach.member', '项目成员')
  const viewer = await makeUser('attach.viewer', '只读成员')
  const outsider = await makeUser('attach.outsider', '外部用户')
  const { projectId } = await makeProject(pm.id)
  await makeMember(projectId, member.id, 'MEMBER')
  await makeMember(projectId, viewer.id, 'VIEWER')
  const goal = await makeGoal(projectId)
  const activity = await makeActivity(goal)
  const story = await makeStory(activity)
  const taskId = await makeTask(story, member.id, pm.id)
  return { pm, member, viewer, outsider, projectId, taskId }
}

function upload(
  token: string,
  taskId: string,
  fileName = '验收材料.pdf',
  mimeType = 'application/pdf',
  content: Buffer = Buffer.from('%PDF-demo'),
) {
  return ctx
    .asUser(token)
    .post(`/tasks/${taskId}/attachments`)
    .set('Content-Type', mimeType)
    .set('X-File-Name', encodeURIComponent(fileName))
    .send(content)
}

describe('① 上传 / 列表 / 下载 / 删除 happy path', () => {
  it('member（任务负责人）可上传；列表只暴露视图字段；下载带 Content-Disposition；删除清理实体文件', async () => {
    const seed = await seedTask()
    const token = ctx.loginAs(seed.member.id)

    const created = await upload(token, seed.taskId)
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      taskId: seed.taskId,
      projectId: seed.projectId,
      originalName: '验收材料.pdf',
      extension: 'pdf',
      mimeType: 'application/pdf',
      sizeBytes: 9,
      state: 'ACTIVE',
    })
    // API 视图绝不返回存储键 / 清理细节
    expect(created.body).not.toHaveProperty('storageKey')
    expect(created.body).not.toHaveProperty('cleanupAttempts')
    expect(created.body).not.toHaveProperty('cleanupError')

    const list = await ctx.asUser(token).get(`/tasks/${seed.taskId}/attachments`)
    expect(list.status).toBe(200)
    expect(list.body).toMatchObject({ total: 1 })
    expect(list.body.items).toHaveLength(1)

    const downloaded = await ctx.asUser(token).get(`/attachments/${created.body.id}/download`)
    expect(downloaded.status).toBe(200)
    expect(downloaded.headers['content-type']).toContain('application/pdf')
    expect(downloaded.headers['content-disposition']).toContain('attachment')
    expect(Buffer.from(downloaded.body).toString()).toBe('%PDF-demo')

    // 删除前记录真实磁盘路径，删除后断言文件已消失
    const row = await ctx.db.attachment.findUnique({ where: { id: created.body.id } })
    expect(row?.storagePath).toBeTruthy()
    const physical = resolve(UPLOAD_ROOT, row!.storagePath)
    expect(existsSync(physical)).toBe(true)

    const deleted = await ctx.asUser(token).delete(`/attachments/${created.body.id}`)
    expect(deleted.status).toBe(204)
    expect(existsSync(physical)).toBe(false)
    expect(await ctx.db.attachment.count()).toBe(0)

    const empty = await ctx.asUser(token).get(`/tasks/${seed.taskId}/attachments`)
    expect(empty.body).toMatchObject({ total: 0 })
  })

  it('PM 也可上传 / 下载；VIEWER 可列表和下载但上传 / 删除 403', async () => {
    const seed = await seedTask()
    const created = await upload(ctx.loginAs(seed.pm.id), seed.taskId)
    expect(created.status).toBe(201)

    const viewer = ctx.loginAs(seed.viewer.id)
    expect((await ctx.asUser(viewer).get(`/tasks/${seed.taskId}/attachments`)).status).toBe(200)
    expect((await ctx.asUser(viewer).get(`/attachments/${created.body.id}/download`)).status).toBe(200)
    expect((await upload(viewer, seed.taskId)).status).toBe(403)
    expect((await ctx.asUser(viewer).delete(`/attachments/${created.body.id}`)).status).toBe(403)
  })

  it('outsider 列表 → 404', async () => {
    const seed = await seedTask()
    const response = await ctx.asUser(ctx.loginAs(seed.outsider.id)).get(`/tasks/${seed.taskId}/attachments`)
    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('NOT_FOUND')
  })

  it('未登录 → 401', async () => {
    const seed = await seedTask()
    const response = await ctx
      .asUser(null)
      .post(`/tasks/${seed.taskId}/attachments`)
      .set('Content-Type', 'application/pdf')
      .set('X-File-Name', 'a.pdf')
      .send(Buffer.from('x'))
    expect(response.status).toBe(401)
  })
})

describe('② 扩展名 + MIME 联合校验与 10MB 上限', () => {
  it('扩展名与 MIME 不匹配 → 422 字段级错误', async () => {
    const seed = await seedTask()
    const response = await upload(ctx.loginAs(seed.member.id), seed.taskId, 'fake.pdf', 'image/png')
    expect(response.status).toBe(422)
    expect(response.body.error.details).toEqual([{ field: 'mimeType', code: 'INVALID_VALUE' }])
  })

  it('非白名单扩展名 → 422，且不落库、不写盘', async () => {
    const seed = await seedTask()
    // 白名单 MIME + 非白名单扩展名：解析器放行，服务端扩展名白名单拒绝
    const response = await upload(
      ctx.loginAs(seed.member.id),
      seed.taskId,
      'evil.svg',
      'application/pdf',
      Buffer.from('<svg/>'),
    )
    expect(response.status).toBe(422)
    expect(await ctx.db.attachment.count()).toBe(0)
  })

  it('非白名单 MIME → 415（传输层拒绝未支持的 Content-Type，不落库）', async () => {
    const seed = await seedTask()
    const response = await upload(
      ctx.loginAs(seed.member.id),
      seed.taskId,
      'evil.svg',
      'image/svg+xml',
      Buffer.from('<svg/>'),
    )
    expect(response.status).toBe(415)
    expect(await ctx.db.attachment.count()).toBe(0)
  })

  it('恰好 10,000,000 B 允许；超过 1 字节 → 413/422 且不落库', async () => {
    const seed = await seedTask()
    const token = ctx.loginAs(seed.member.id)

    const atLimit = await upload(token, seed.taskId, 'limit.zip', 'application/zip', Buffer.alloc(10_000_000))
    expect(atLimit.status).toBe(201)
    expect(atLimit.body.sizeBytes).toBe(10_000_000)

    const overByOne = await upload(
      token,
      seed.taskId,
      'over.zip',
      'application/zip',
      Buffer.alloc(10_000_001),
    )
    expect([413, 422]).toContain(overByOne.status)
    // 只有恰好等于上限的那一条落库
    expect(await ctx.db.attachment.count()).toBe(1)
  })
})

describe('③ 敏感任务隔离（查询层判定，404 与不可见逐字一致）', () => {
  it('敏感任务：MEMBER 读 / 写 / 下载 → 404，且响应体与「跨项目不可见」逐字一致；PM 正常', async () => {
    const seed = await seedTask()
    await makeSensitive('task', seed.taskId, []) // 除 PM 外无人可见

    // PM 先放入一个附件作为下载目标
    const created = await upload(ctx.loginAs(seed.pm.id), seed.taskId)
    expect(created.status).toBe(201)

    // 另一个项目（member 不是其成员）里的附件，用作「任务不可见」的对照
    const otherPm = await makeUser('attach.other.pm', '别的 PM')
    const other = await makeProject(otherPm.id, '另一个项目')
    const otherGoal = await makeGoal(other.projectId)
    const otherActivity = await makeActivity(otherGoal)
    const otherStory = await makeStory(otherActivity)
    const otherTask = await makeTask(
      otherStory,
      otherPm.id,
      (await makeUser('attach.other.acceptor', '别的验收人')).id,
    )
    const otherCreated = await upload(ctx.loginAs(otherPm.id), otherTask, 'other.pdf')
    expect(otherCreated.status).toBe(201)

    const member = ctx.loginAs(seed.member.id)

    // 列表：敏感任务 vs 不存在的任务（同为 authorize 404）
    const sensitiveList = await ctx.asUser(member).get(`/tasks/${seed.taskId}/attachments`)
    const missingTaskList = await ctx.asUser(member).get(`/tasks/does-not-exist/attachments`)
    expect(sensitiveList.status).toBe(404)
    expect(missingTaskList.status).toBe(404)
    expect(sensitiveList.body).toEqual(missingTaskList.body)

    // 上传：敏感任务 vs 不存在的任务
    const sensitiveUpload = await upload(member, seed.taskId)
    const missingTaskUpload = await upload(member, 'does-not-exist')
    expect(sensitiveUpload.status).toBe(404)
    expect(missingTaskUpload.status).toBe(404)
    expect(sensitiveUpload.body).toEqual(missingTaskUpload.body)

    // 下载：真实附件（敏感任务）vs 真实附件（跨项目不可见任务）——同一条 authorize 404
    const sensitiveDownload = await ctx.asUser(member).get(`/attachments/${created.body.id}/download`)
    const invisibleDownload = await ctx.asUser(member).get(`/attachments/${otherCreated.body.id}/download`)
    expect(sensitiveDownload.status).toBe(404)
    expect(invisibleDownload.status).toBe(404)
    expect(sensitiveDownload.body).toEqual(invisibleDownload.body)

    // 不存在的附件 id 也是同码同信封的 404（仅 message 文案不同，见报告偏差说明）
    const absent = await ctx.asUser(member).get('/attachments/00000000-0000-4000-8000-000000000000/download')
    expect(absent.status).toBe(404)
    expect(absent.body.error.code).toBe('NOT_FOUND')

    // PM 正常读 / 写 / 下载
    const pm = ctx.loginAs(seed.pm.id)
    expect((await ctx.asUser(pm).get(`/tasks/${seed.taskId}/attachments`)).body).toMatchObject({ total: 1 })
    expect((await ctx.asUser(pm).get(`/attachments/${created.body.id}/download`)).status).toBe(200)
    expect((await upload(pm, seed.taskId, 'second.pdf')).status).toBe(201)
  })
})

describe('⑥ 列表只返回 ACTIVE（DELETING / CLEANUP_FAILED 对用户不可见）', () => {
  it('仓储查询层用 state 过滤，非 ACTIVE 行不出现在列表', async () => {
    const seed = await seedTask()
    const created = await upload(ctx.loginAs(seed.member.id), seed.taskId)
    expect(created.status).toBe(201)

    const row = await ctx.db.attachment.findUnique({ where: { id: created.body.id } })
    await ctx.db.attachment.update({
      where: { id: created.body.id },
      data: { state: 'CLEANUP_FAILED', cleanupLastError: 'FILE_DELETE_FAILED' },
    })

    const token = ctx.loginAs(seed.member.id)
    const list = await ctx.asUser(token).get(`/tasks/${seed.taskId}/attachments`)
    expect(list.body).toMatchObject({ total: 0 })
    // 物理文件仍在（仅状态改变），但用户不可见
    expect(existsSync(resolve(UPLOAD_ROOT, row!.storagePath))).toBe(true)
  })
})
