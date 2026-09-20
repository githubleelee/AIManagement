/**
 * T0.5 自测：测试数据工厂与测试辅助（契约「测试数据工厂」八条签名的验收）
 *
 * 为什么 T0.5 自己也要有测试
 *   T0.5 交付的是**别人测试用的底座**。若它本身没有测试，一旦工厂写错，
 *   症状会以「某个业务模块的测试莫名其妙地红/绿」的形式出现在别人那里，
 *   而没有人会先怀疑夹具 —— 仓库里已经出现过一次「夹具的名字与注释一起在骗人，
 *   让 2 条用例静默失效」的教训（表五序号 51）。
 *
 * 本文件只验证**工厂的行为**（写库结果、推导出的归属、对非法输入的拒绝），
 * 不验证任何业务端点 —— 端点由各模块自己的接口测试负责。
 *
 * 注意：工厂只写库；本文件里唯一走 HTTP 的一处是 `createTestContext` 的连通性冒烟，
 * 用于证明「辅助函数给出的 app 实例确实能响应请求」。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  clearActiveDatabase,
  createTestContext,
  setActiveDatabase,
  type HttpTestContext,
} from './helpers.js'
import {
  makeActivity,
  makeGoal,
  makeMember,
  makeProject,
  makeSensitive,
  makeStory,
  makeTask,
  makeUser,
} from './factories.js'

let ctx: HttpTestContext

// ⚠️ 第二个参数（超时）不可省：`createTestContext()` 内部会经
// `createTempDatabase()` → `execFileSync(prisma migrate deploy)` **起子进程应用迁移**，
// 首轮往往超过 vitest 默认的 10s hook 超时。仓库里走 HTTP 的测试文件都是这个写法。
beforeAll(async () => {
  ctx = await createTestContext()
}, 120_000)

afterAll(async () => {
  await ctx.dispose()
})

beforeEach(async () => {
  await ctx.reset()
})

describe('T0.5 测试辅助', () => {
  it('createTestContext 给出的 app 实例可真发请求（/health 无需登录）', async () => {
    const res = await ctx.asUser(null).get('/health')
    expect(res.status).toBe(200)
  })

  it('登录辅助能为任意用户签发令牌，且令牌可被识别（/auth/me 属 M1，本文件不依赖它）', async () => {
    const user = await makeUser('helper.smoke', '冒烟用户')
    const token = ctx.loginAs(user.id)
    expect(typeof token).toBe('string')
    // 用一条**需要登录**的已交付端点验证令牌被识别：端点 10（非成员 → 404，
    // 但 401 与 404 的区别恰好证明「令牌已被解析出身份」）
    const { projectId } = await makeProject(user.id, '令牌验证项目')
    const res = await ctx.asUser(token).get(`/projects/${projectId}/goals`)
    expect(res.status).toBe(200)
  })

  it('没有激活的库时工厂立刻报错，而不是悄悄写到上一个库', async () => {
    clearActiveDatabase()
    await expect(makeGoal('any-project-id')).rejects.toThrow(/没有激活的测试数据库/)
    // 恢复，避免影响后续用例
    setActiveDatabase(ctx.db)
  })
})

describe('T0.5 makeUser / makeProject / makeMember', () => {
  it('makeUser 返回 UserBrief（含 id/account/displayName），且密码是真哈希', async () => {
    const user = await makeUser('pm.a', '项目经理 A')
    expect(user).toEqual({ id: expect.any(String), account: 'pm.a', displayName: '项目经理 A' })

    const row = await ctx.db.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    })
    // 不做 scrypt 的完整校验（那是 auth 模块的职责），只钉住「不是明文」
    expect(row?.passwordHash).not.toBe('Passw0rd!')
    expect(row?.passwordHash?.startsWith('scrypt$')).toBe(true)
  })

  it('displayName 省略时回落到 account', async () => {
    const user = await makeUser('viewer.a')
    expect(user.displayName).toBe('viewer.a')
  })

  it('makeProject 返回 { projectId, ownerUserId }，并把创建者写成 PM（复刻端点 3 的副作用）', async () => {
    const owner = await makeUser('pm.b')
    const { projectId, ownerUserId } = await makeProject(owner.id, '带成员的项目')
    expect(ownerUserId).toBe(owner.id)

    const members = await ctx.db.projectMember.findMany({
      where: { projectId },
      select: { userId: true, role: true },
    })
    expect(members).toEqual([{ userId: owner.id, role: 'PM' }])
  })

  it('makeMember 按角色加成员，可加多个', async () => {
    const pm = await makeUser('pm.c')
    const member = await makeUser('member.c')
    const viewer = await makeUser('viewer.c')
    const { projectId } = await makeProject(pm.id)

    await makeMember(projectId, member.id)
    await makeMember(projectId, viewer.id, 'VIEWER')

    const rows = await ctx.db.projectMember.findMany({
      where: { projectId },
      orderBy: { userId: 'asc' },
      select: { userId: true, role: true },
    })
    const byUser = new Map(rows.map((r) => [r.userId, r.role]))
    expect(byUser.get(pm.id)).toBe('PM')
    expect(byUser.get(member.id)).toBe('MEMBER') // 默认角色
    expect(byUser.get(viewer.id)).toBe('VIEWER')
  })
})

describe('T0.5 makeGoal / makeActivity（sortOrder 与归属推导）', () => {
  it('makeGoal 的 sortOrder 复刻端点 11 的口径：0,1,2…（不硬编码 0）', async () => {
    const pm = await makeUser('pm.d')
    const { projectId } = await makeProject(pm.id)

    await makeGoal(projectId, '目标一')
    await makeGoal(projectId, '目标二')
    await makeGoal(projectId, '目标三')

    const goals = await ctx.db.businessGoal.findMany({
      where: { projectId },
      orderBy: { sortOrder: 'asc' },
      select: { sortOrder: true, name: true, status: true },
    })
    expect(goals.map((g) => g.sortOrder)).toEqual([0, 1, 2])
    expect(goals.map((g) => g.name)).toEqual(['目标一', '目标二', '目标三'])
    // 状态交给表默认值（决策 I-7：status 默认 'ACTIVE'）
    expect(goals.map((g) => g.status)).toEqual(['ACTIVE', 'ACTIVE', 'ACTIVE'])
  })

  it('显式 sortOrder 会覆盖自动取值（供排序类测试构造初始顺序）', async () => {
    const pm = await makeUser('pm.e')
    const { projectId } = await makeProject(pm.id)
    await makeGoal(projectId, '目标', { sortOrder: 7 })
    const goals = await ctx.db.businessGoal.findMany({
      where: { projectId },
      select: { sortOrder: true },
    })
    expect(goals.map((g) => g.sortOrder)).toEqual([7])
  })

  it('makeActivity 从 goalId 推导 projectId（契约 I-10），sortOrder 按目标内最大值 + 1', async () => {
    const pm = await makeUser('pm.f')
    const { projectId } = await makeProject(pm.id)
    const goalA = await makeGoal(projectId, '目标 A')
    const goalB = await makeGoal(projectId, '目标 B')

    await makeActivity(goalA, '活动 1')
    await makeActivity(goalA, '活动 2')
    await makeActivity(goalB, '活动 3')

    const activities = await ctx.db.userActivity.findMany({
      where: { projectId },
      orderBy: [{ goalId: 'asc' }, { sortOrder: 'asc' }],
      select: { goalId: true, name: true, sortOrder: true, projectId: true },
    })
    // 归属必须由父级推导出来，而不是由调用方传入
    expect(activities.every((a) => a.projectId === projectId)).toBe(true)
    // 每个目标各自的序号从 0 起（不是项目内全局计数）
    const a = activities.filter((x) => x.goalId === goalA).map((x) => x.sortOrder)
    const b = activities.filter((x) => x.goalId === goalB).map((x) => x.sortOrder)
    expect(a).toEqual([0, 1])
    expect(b).toEqual([0])
  })

  it('父级不存在时立刻报错（而不是造出一条无归属的脏数据）', async () => {
    await expect(makeActivity('no-such-goal')).rejects.toThrow(/不存在/)
  })
})

describe('T0.5 makeStory（三段式默认值与表默认值）', () => {
  it('默认值齐备，且 status / isSensitive 走表默认值（DRAFT / false）', async () => {
    const pm = await makeUser('pm.g')
    const { projectId } = await makeProject(pm.id)
    const goalId = await makeGoal(projectId)
    const activityId = await makeActivity(goalId)

    const storyId = await makeStory(activityId)

    const story = await ctx.db.userStory.findUnique({
      where: { id: storyId },
      select: {
        projectId: true,
        activityId: true,
        title: true,
        roleText: true,
        capabilityText: true,
        valueText: true,
        businessValue: true,
        priority: true,
        status: true,
        acceptanceCriteria: true,
        isSensitive: true,
      },
    })
    // projectId 由 activityId 推导
    expect(story?.projectId).toBe(projectId)
    expect(story?.activityId).toBe(activityId)
    // 五个文本字段都不是空串（契约 I-8 端点 19 把它们都列为必填）
    expect(story?.title).toBeTruthy()
    expect(story?.roleText).toBeTruthy()
    expect(story?.capabilityText).toBeTruthy()
    expect(story?.valueText).toBeTruthy()
    expect(story?.businessValue).toBeTruthy()
    expect(story?.priority).toBe('P0')
    // 表默认值
    expect(story?.status).toBe('DRAFT')
    expect(story?.isSensitive).toBe(false)
    expect(story?.acceptanceCriteria).toBeNull()
  })

  it('overrides 逐字段生效（含 status 与 isSensitive）', async () => {
    const pm = await makeUser('pm.h')
    const { projectId } = await makeProject(pm.id)
    const activityId = await makeActivity(await makeGoal(projectId))

    const storyId = await makeStory(activityId, {
      title: '可覆写标题',
      roleText: '项目成员',
      priority: 'P2',
      status: 'PLANNING',
      isSensitive: true,
      acceptanceCriteria: '验收标准文本',
    })

    const story = await ctx.db.userStory.findUnique({
      where: { id: storyId },
      select: { title: true, roleText: true, priority: true, status: true, isSensitive: true, acceptanceCriteria: true },
    })
    expect(story).toEqual({
      title: '可覆写标题',
      roleText: '项目成员',
      priority: 'P2',
      status: 'PLANNING',
      isSensitive: true,
      acceptanceCriteria: '验收标准文本',
    })
  })

  it('父级不存在时立刻报错', async () => {
    await expect(makeStory('no-such-activity')).rejects.toThrow(/不存在/)
  })
})

describe('T0.5 makeTask（负责人 ≠ 验收人）', () => {
  it('正常造出任务，projectId 由 storyId 推导，planStart/planEnd 合法且结束不早于开始', async () => {
    const pm = await makeUser('pm.i')
    const member = await makeUser('member.i')
    const { projectId } = await makeProject(pm.id)
    await makeMember(projectId, member.id)

    const storyId = await makeStory(await makeActivity(await makeGoal(projectId)))
    const taskId = await makeTask(storyId, member.id, pm.id)

    const task = await ctx.db.task.findUnique({
      where: { id: taskId },
      select: { projectId: true, storyId: true, ownerUserId: true, acceptorUserId: true, planStart: true, planEnd: true, status: true, isSensitive: true },
    })
    expect(task?.projectId).toBe(projectId)
    expect(task?.storyId).toBe(storyId)
    expect(task?.ownerUserId).toBe(member.id)
    expect(task?.acceptorUserId).toBe(pm.id)
    expect(task?.planStart).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(task?.planEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect((task?.planEnd ?? '') >= (task?.planStart ?? 'Z')).toBe(true)
    expect(task?.status).toBe('TODO')
    expect(task?.isSensitive).toBe(false)
  })

  it('负责人 = 验收人时**显式抛错**（契约要求夹具内部满足该约束）', async () => {
    const pm = await makeUser('pm.j')
    const other = await makeUser('member.j')
    const { projectId } = await makeProject(pm.id)
    await makeMember(projectId, other.id)
    const storyId = await makeStory(await makeActivity(await makeGoal(projectId)))

    await expect(makeTask(storyId, pm.id, pm.id)).rejects.toThrow(/负责人与验收人不能是同一人/)
    // 失败后库里不应留下脏数据
    const count = await ctx.db.task.count()
    expect(count).toBe(0)
  })

  it('父级不存在时立刻报错', async () => {
    const pm = await makeUser('pm.k')
    const other = await makeUser('member.k')
    await expect(makeTask('no-such-story', pm.id, other.id)).rejects.toThrow(/不存在/)
  })
})

describe('T0.5 makeSensitive（标记 + 白名单）', () => {
  it('把故事标为敏感并写入白名单，projectId 由对象推导', async () => {
    const pm = await makeUser('pm.l')
    const member = await makeUser('member.l')
    const outsider = await makeUser('outsider.l')
    const { projectId } = await makeProject(pm.id)
    await makeMember(projectId, member.id)

    const storyId = await makeStory(await makeActivity(await makeGoal(projectId)))
    await makeSensitive('story', storyId, [member.id])

    const story = await ctx.db.userStory.findUnique({
      where: { id: storyId },
      select: { isSensitive: true },
    })
    expect(story?.isSensitive).toBe(true)

    const vis = await ctx.db.objectVisibility.findMany({
      where: { objectType: 'story', objectId: storyId },
      select: { projectId: true, userId: true, objectType: true },
    })
    expect(vis.map((v) => v.projectId)).toEqual([projectId])
    expect(vis.map((v) => v.userId)).toEqual([member.id])
    expect(vis.map((v) => v.objectType)).toEqual(['story'])
    // outsider 没有被加进白名单
    expect(vis.some((v) => v.userId === outsider.id)).toBe(false)
  })

  it('任务也能标敏感（objectType = task）', async () => {
    const pm = await makeUser('pm.m')
    const member = await makeUser('member.m')
    const { projectId } = await makeProject(pm.id)
    await makeMember(projectId, member.id)
    const storyId = await makeStory(await makeActivity(await makeGoal(projectId)))
    const taskId = await makeTask(storyId, member.id, pm.id)

    await makeSensitive('task', taskId, [member.id])

    const task = await ctx.db.task.findUnique({ where: { id: taskId }, select: { isSensitive: true } })
    expect(task?.isSensitive).toBe(true)
    const vis = await ctx.db.objectVisibility.findMany({
      where: { objectType: 'task', objectId: taskId },
      select: { projectId: true, userId: true },
    })
    expect(vis).toEqual([{ projectId, userId: member.id }])
  })

  it('空白名单合法：对象敏感、但却除 PM 外无人可见（T2.6 用例需要这种数据）', async () => {
    const pm = await makeUser('pm.n')
    const { projectId } = await makeProject(pm.id)
    const storyId = await makeStory(await makeActivity(await makeGoal(projectId)))

    await makeSensitive('story', storyId, [])

    const story = await ctx.db.userStory.findUnique({ where: { id: storyId }, select: { isSensitive: true } })
    expect(story?.isSensitive).toBe(true)
    const count = await ctx.db.objectVisibility.count({ where: { objectId: storyId } })
    expect(count).toBe(0)
  })

  it('对象不存在时立刻报错', async () => {
    await expect(makeSensitive('story', 'no-such-story', [])).rejects.toThrow(/不存在/)
    await expect(makeSensitive('task', 'no-such-task', [])).rejects.toThrow(/不存在/)
  })
})
