import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAuthorization } from './permissions.js'
import type { Action } from '../../shared/types.js'
import { createHttpTestContext, makeMember, makeProject, makeUser, type HttpTestContext } from '../../../test/http-support.js'

let ctx: HttpTestContext
let pm: string, allowed: string, blocked: string, viewer: string, outsider: string
let projectId: string, storyId: string, taskId: string

beforeAll(async () => {
  ctx = await createHttpTestContext()
  await ctx.app.ready()
}, 120_000)
afterAll(async () => { await ctx?.dispose() })
beforeEach(async () => {
  await ctx.reset()
  pm = await makeUser(ctx.db, 'pm')
  allowed = await makeUser(ctx.db, 'allowed')
  blocked = await makeUser(ctx.db, 'blocked')
  viewer = await makeUser(ctx.db, 'viewer')
  outsider = await makeUser(ctx.db, 'outsider')
  projectId = await makeProject(ctx.db, pm)
  await makeMember(ctx.db, projectId, allowed)
  await makeMember(ctx.db, projectId, blocked)
  await makeMember(ctx.db, projectId, viewer, 'VIEWER')
  const goal = await ctx.db.businessGoal.create({ data: { projectId, name: '目标', sortOrder: 0 } })
  const activity = await ctx.db.userActivity.create({ data: { projectId, goalId: goal.id, name: '活动', sortOrder: 0 } })
  const story = await ctx.db.userStory.create({ data: {
    projectId, activityId: activity.id, title: '秘密故事', roleText: 'r', capabilityText: 'c',
    valueText: 'v', businessValue: 'b', priority: 'P0',
  } })
  storyId = story.id
  taskId = (await ctx.db.task.create({ data: {
    projectId, storyId, title: '秘密任务', ownerUserId: allowed, acceptorUserId: pm,
    planStart: '2026-09-20', planEnd: '2026-09-21',
  } })).id
}, 120_000)

describe('T2：真实 HTTP 敏感设置与可见性', () => {
  it('仅 PM 可以设置；未登录 401，非成员 404，成员 403 且不落审计', async () => {
    const url = `/stories/${storyId}/sensitivity`
    const body = { isSensitive: true, visibleMemberIds: [allowed] }
    expect((await ctx.asUser(null).put(url).send(body)).status).toBe(401)
    expect((await ctx.asUser(ctx.loginAs(outsider)).put(url).send(body)).status).toBe(404)
    expect((await ctx.asUser(ctx.loginAs(blocked)).put(url).send(body)).status).toBe(403)
    expect(await ctx.db.auditLog.count()).toBe(0)
  })

  it('故事白名单全量覆盖，旧凭证下一次请求立即失效，404 不泄漏标题', async () => {
    const pmToken = ctx.loginAs(pm)
    const allowedToken = ctx.loginAs(allowed)
    const url = `/stories/${storyId}/sensitivity`
    const body = { isSensitive: true, visibleMemberIds: [allowed] }
    const first = await ctx.asUser(pmToken).put(url).send(body)
    expect(first.status).toBe(200)
    expect(first.body).toEqual({ objectType: 'story', objectId: storyId, ...body })
    expect((await ctx.asUser(allowedToken).get(`/stories/${storyId}`)).status).toBe(200)
    const hidden = await ctx.asUser(ctx.loginAs(blocked)).get(`/stories/${storyId}`)
    const missing = await ctx.asUser(ctx.loginAs(blocked)).get('/stories/does-not-exist')
    expect(hidden.status).toBe(404)
    expect(hidden.body).toEqual(missing.body)
    expect(JSON.stringify(hidden.body)).not.toContain('秘密故事')

    const replaced = await ctx.asUser(pmToken).put(url).send({ isSensitive: true, visibleMemberIds: [viewer] })
    expect(replaced.body.visibleMemberIds).toEqual([viewer])
    expect((await ctx.asUser(allowedToken).get(`/stories/${storyId}`)).status).toBe(404)
    expect((await ctx.asUser(ctx.loginAs(viewer)).get(`/stories/${storyId}`)).status).toBe(200)
  })

  it('可见范围过滤在数据库查询层生效，恢复非敏感时保留旧名单', async () => {
    const url = `/stories/${storyId}/sensitivity`
    const pmToken = ctx.loginAs(pm)
    await ctx.asUser(pmToken).put(url).send({ isSensitive: true, visibleMemberIds: [allowed] })
    const { visibilityScope } = createAuthorization(ctx.db)
    const scope = await visibilityScope(blocked, projectId, 'story')
    expect(scope).toEqual({ mode: 'subset', ids: [] })
    const tree = await ctx.asUser(ctx.loginAs(blocked)).get(`/projects/${projectId}/goals`)
    expect(tree.status).toBe(200)
    expect(JSON.stringify(tree.body)).not.toContain('秘密故事')

    const reopened = await ctx.asUser(pmToken).put(url).send({ isSensitive: false, visibleMemberIds: [outsider] })
    expect(reopened.status).toBe(200)
    expect(reopened.body.visibleMemberIds).toEqual([allowed])
    expect((await ctx.asUser(ctx.loginAs(blocked)).get(`/stories/${storyId}`)).status).toBe(200)
    expect(await ctx.db.objectVisibility.count({ where: { objectId: storyId } })).toBe(1)
    expect((await visibilityScope(blocked, projectId, 'story')).mode).toBe('subset')
  })

  it('任务敏感设置可用；非项目成员名单被拒且事务无副作用', async () => {
    const url = `/tasks/${taskId}/sensitivity`
    const token = ctx.loginAs(pm)
    const invalid = await ctx.asUser(token).put(url).send({ isSensitive: true, visibleMemberIds: [outsider] })
    expect(invalid.status).toBe(422)
    expect(invalid.body.error.details).toContainEqual({ field: 'visibleMemberIds', code: 'NOT_PROJECT_MEMBER' })
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })).isSensitive).toBe(false)
    expect(await ctx.db.auditLog.count()).toBe(0)

    const good = await ctx.asUser(token).put(url).send({ isSensitive: true, visibleMemberIds: [allowed, allowed] })
    expect(good.status).toBe(200)
    expect(good.body.visibleMemberIds).toEqual([allowed])
    const { can, visibilityScope } = createAuthorization(ctx.db)
    expect(await can(allowed, 'project.read', { kind: 'task', projectId, objectId: taskId })).toEqual({ allow: true })
    expect(await can(blocked, 'project.read', { kind: 'task', projectId, objectId: taskId }))
      .toEqual({ allow: false, status: 404, code: 'NOT_FOUND' })
    expect(await visibilityScope(blocked, projectId, 'task')).toEqual({ mode: 'subset', ids: [] })
  })

  it('审计保存前后对象、操作人与时间；改权限的用户下一次请求直接按库判定', async () => {
    await ctx.asUser(ctx.loginAs(pm)).put(`/stories/${storyId}/sensitivity`)
      .send({ isSensitive: true, visibleMemberIds: [allowed] })
    const log = await ctx.db.auditLog.findFirstOrThrow()
    expect(log.actorUserId).toBe(pm)
    expect(log.action).toBe('sensitivity.update')
    expect(JSON.parse(log.before!)).toMatchObject({ isSensitive: false, visibleMemberIds: [] })
    expect(JSON.parse(log.after!)).toMatchObject({ isSensitive: true, visibleMemberIds: [allowed] })
    expect(log.createdAt).toBeInstanceOf(Date)
    await ctx.db.projectMember.delete({ where: { projectId_userId: { projectId, userId: allowed } } })
    expect((await ctx.asUser(ctx.loginAs(allowed)).get(`/stories/${storyId}`)).status).toBe(404)
  })

  it('角色变更与成员移除都在同一事务写入审计', async () => {
    const token = ctx.loginAs(pm)
    const changed = await ctx.asUser(token)
      .patch(`/projects/${projectId}/members/${blocked}`)
      .send({ role: 'VIEWER' })
    expect(changed.status).toBe(200)

    const roleLog = await ctx.db.auditLog.findFirstOrThrow({
      where: { action: 'member.role.update', objectId: blocked },
    })
    expect(roleLog.actorUserId).toBe(pm)
    expect(JSON.parse(roleLog.before!)).toEqual({ role: 'MEMBER' })
    expect(JSON.parse(roleLog.after!)).toEqual({ role: 'VIEWER' })

    const removed = await ctx.asUser(token)
      .delete(`/projects/${projectId}/members/${viewer}`)
    expect(removed.status).toBe(204)

    const removalLog = await ctx.db.auditLog.findFirstOrThrow({
      where: { action: 'member.remove', objectId: viewer },
    })
    expect(removalLog.actorUserId).toBe(pm)
    expect(JSON.parse(removalLog.before!)).toEqual({ role: 'VIEWER' })
    expect(removalLog.after).toBeNull()
  })

  it('三角色 × 五动作 × 敏感状态：仅 PM 可写，未授权敏感对象先返回 404', async () => {
    const actions: Action[] = ['project.read', 'project.manage_members', 'requirement.write', 'task.write', 'sensitivity.manage']
    const { can } = createAuthorization(ctx.db)
    for (const sensitive of [false, true]) {
      await ctx.db.userStory.update({ where: { id: storyId }, data: { isSensitive: sensitive } })
      for (const [id, role] of [[pm, 'PM'], [allowed, 'MEMBER'], [viewer, 'VIEWER']] as const) {
        for (const action of actions) {
          const decision = await can(id, action, { kind: 'story', projectId, objectId: storyId })
          if (role === 'PM') expect(decision).toEqual({ allow: true })
          else if (sensitive) expect(decision).toEqual({ allow: false, status: 404, code: 'NOT_FOUND' })
          else if (action === 'project.read') expect(decision).toEqual({ allow: true })
          else expect(decision).toEqual({ allow: false, status: 403, code: 'FORBIDDEN' })
        }
      }
    }
  })

  it('无效请求无写入；不存在对象与外部人员不可区分', async () => {
    const url = `/stories/${storyId}/sensitivity`
    const pmToken = ctx.loginAs(pm)
    const invalid = await ctx.asUser(pmToken).put(url).send({ isSensitive: 'yes', visibleMemberIds: [] })
    expect(invalid.status).toBe(422)
    expect(await ctx.db.auditLog.count()).toBe(0)
    const outsiderToken = ctx.loginAs(outsider)
    const body = { isSensitive: true, visibleMemberIds: [] }
    const hidden = await ctx.asUser(outsiderToken).put(url).send(body)
    const absent = await ctx.asUser(outsiderToken).put('/stories/absent/sensitivity').send(body)
    expect(hidden.status).toBe(404)
    expect(hidden.body).toEqual(absent.body)
  })
})
