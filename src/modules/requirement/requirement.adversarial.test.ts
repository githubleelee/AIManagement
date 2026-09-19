/**
 * 端点 11 —— `POST /projects/:projectId/goals` **对抗性**接口测试（US-03 / T3.1 独立检测）
 *
 * 本文件由**检测智能体**新增，与编码智能体的 `requirement.test.ts` 互补：
 * 后者覆盖「契约明写的正常路径」，本文件专门去它**没想到的地方**——
 * 权限矩阵穷举、响应泄漏、违规判定顺序、字段类型穷举、字面空白/多字节边界、
 * 极端 sortOrder、并发竞态、副作用隔离、未知字段注入、响应形状逐字段核对。
 *
 * 硬性约束（遵守）
 *   1. 不修改任何生产代码；本文件是**新增测试文件**。
 *   2. 不修改冻结文件（`src/shared/`、`src/db/schema.prisma`、`src/routes.ts`）。
 *   3. 不修改已有测试文件；夹具写在本文件内部，不碰 `test/http-support.ts`。
 *   4. **只断言错误码与字段级 code，不断言中文文案。**
 *   5. 用 `createHttpTestContext()` 指向独立临时库，并用
 *      `ctx.app.register(registerRequirementRoutes, { prisma: ctx.db })` 挂插件
 *      （生产注册行在冻结文件 `src/routes.ts`，本分支不存在）。
 *
 * 契约依据：决策 I-2（共享类型）、I-3（响应信封）、I-4（错误码表）、
 *           I-5（can() 判定顺序）、I-8 端点 11、I-10（projectId 推导）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createHttpTestContext,
  makeMember,
  makeProject,
  makeUser,
  type HttpTestContext,
} from '../../../test/http-support.js'
import { registerRequirementRoutes } from './plugin.js'
import { GOAL_NAME_MAX_LENGTH } from './schemas.js'
import { makeGoal } from './test-fixtures.js'

let ctx: HttpTestContext

// 权限矩阵的 4 个身份
let pmToken: string
let memberToken: string
let viewerToken: string
let outsiderToken: string
let pmId: string
let projectId: string

/** 契约 I-3 的失败信封（只取结构性字段，忽略文案）。 */
type ErrorBody = {
  error: { code: string; message: string; details?: Array<{ field: string; code: string }> }
}

const URL_GOALS = (id: string) => `/projects/${id}/goals`
const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000'

/** 该项目下的目标总数（副作用隔离断言用）。 */
const goalCount = (pid: string) => ctx.db.businessGoal.count({ where: { projectId: pid } })

/**
 * 契约 I-3：对象不可见 / 操作不允许时，响应体**不得包含该对象的任何字段**。
 * 这里做结构化断言（键集合 + 值不含对象数据），不依赖任何中文文案。
 */
function expectNoObjectLeak(res: { status: number; body: unknown }, expectedCode: string): void {
  const body = res.body as ErrorBody
  expect(body.error.code).toBe(expectedCode)
  // 失败信封的顶层键只能是 { error }
  expect(Object.keys(body)).toEqual(['error'])
  // error 内只允许 code / message（details 仅用于字段级校验错误，权限类错误不得带）
  expect(Object.keys(body.error).sort()).toEqual(['code', 'message'])
  // 响应全文不得出现被保护对象的任何字段名
  const serialized = JSON.stringify(res.body)
  for (const field of ['id', 'projectId', 'name', 'description', 'status', 'sortOrder', 'createdAt']) {
    expect(serialized).not.toContain(field)
  }
  expect(serialized).not.toContain(projectId)
}

/** 断言 details 里恰好有一条 { field, code }（只判错误码，不判文案）。 */
function expectFieldError(body: ErrorBody, field: string, code: string): void {
  expect(body.error.code).toBe('VALIDATION_FAILED')
  const hits = (body.error.details ?? []).filter((d) => d.field === field)
  expect(hits.length).toBeGreaterThan(0)
  expect(hits.map((d) => d.code)).toContain(code)
}

beforeAll(async () => {
  ctx = await createHttpTestContext()
  // 生产注册行不在本分支（冻结文件 src/routes.ts），必须在临时库上自挂插件
  await ctx.app.register(registerRequirementRoutes, { prisma: ctx.db })
  await ctx.app.ready()
}, 120_000)

afterAll(async () => {
  await ctx?.dispose()
})

beforeEach(async () => {
  await ctx.reset()

  pmId = await makeUser(ctx.db, 'adv-pm', '项目经理')
  const memberId = await makeUser(ctx.db, 'adv-member', '项目成员')
  const viewerId = await makeUser(ctx.db, 'adv-viewer', '管理者')
  const outsiderId = await makeUser(ctx.db, 'adv-outsider', '外部用户')

  projectId = await makeProject(ctx.db, pmId, '对抗性测试项目')
  await makeMember(ctx.db, projectId, memberId, 'MEMBER')
  await makeMember(ctx.db, projectId, viewerId, 'VIEWER')

  pmToken = ctx.loginAs(pmId)
  memberToken = ctx.loginAs(memberId)
  viewerToken = ctx.loginAs(viewerId)
  outsiderToken = ctx.loginAs(outsiderId)
})

// ===========================================================================
// 1. 权限矩阵穷举（契约 I-5 判定顺序）
// ===========================================================================

describe('对抗 1：权限矩阵穷举', () => {
  const validBody = { name: '权限矩阵用例' }

  it('PM → 201（唯一被允许的角色）', async () => {
    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send(validBody)
    expect(res.status).toBe(201)
  })

  it('MEMBER → 403 FORBIDDEN，且响应体不泄漏对象字段（对象可见，只是不许写）', async () => {
    const before = await goalCount(projectId)
    const res = await ctx.asUser(memberToken).post(URL_GOALS(projectId)).send(validBody)

    expect(res.status).toBe(403)
    expectNoObjectLeak(res, 'FORBIDDEN')
    // 契约 I-5 第 3 条：判定顺序短路 —— MEMBER 必须拿到 403（可见），而不是被隐藏成 404
    expect(res.status).not.toBe(404)
    expect(await goalCount(projectId)).toBe(before)
  })

  it('VIEWER → 403 FORBIDDEN（写类动作，与 MEMBER 同待遇）', async () => {
    const res = await ctx.asUser(viewerToken).post(URL_GOALS(projectId)).send(validBody)

    expect(res.status).toBe(403)
    expectNoObjectLeak(res, 'FORBIDDEN')
  })

  it('非本项目成员 → 404 NOT_FOUND，且响应体不泄漏对象字段', async () => {
    const res = await ctx.asUser(outsiderToken).post(URL_GOALS(projectId)).send(validBody)

    expect(res.status).toBe(404)
    expectNoObjectLeak(res, 'NOT_FOUND')
  })

  it('未登录（无 Authorization 头）→ 401 UNAUTHENTICATED', async () => {
    const res = await ctx.asUser(null).post(URL_GOALS(projectId)).send(validBody)

    expect(res.status).toBe(401)
    expectNoObjectLeak(res, 'UNAUTHENTICATED')
  })

  it('Authorization 头是垃圾令牌 → 401 UNAUTHENTICATED（凭证不透明串，验不过即未登录）', async () => {
    const res = await ctx
      .asUser('not-a-real-token-000')
      .post(URL_GOALS(projectId))
      .send(validBody)

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('令牌对应用户已被删除 → 401（actor 注入须现查用户存在性，决策 I-10 不做缓存）', async () => {
    // 单独造一个不属任何项目的用户，签发令牌后删除，模拟"离职后旧令牌"
    const ghostId = await makeUser(ctx.db, 'adv-ghost', '幽灵用户')
    const ghostToken = ctx.loginAs(ghostId)
    await ctx.db.user.delete({ where: { id: ghostId } })

    const res = await ctx.asUser(ghostToken).post(URL_GOALS(projectId)).send(validBody)

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('projectId 不存在 → 404 NOT_FOUND（不泄漏项目是否存在）', async () => {
    const res = await ctx.asUser(pmToken).post(URL_GOALS(UNKNOWN_UUID)).send(validBody)

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('"项目不存在" 与 "存在但非成员" 的响应结构完全相同（不可区分，防存在性探测）', async () => {
    const nonexistent = await ctx.asUser(pmToken).post(URL_GOALS(UNKNOWN_UUID)).send(validBody)
    const notMember = await ctx.asUser(outsiderToken).post(URL_GOALS(projectId)).send(validBody)

    expect(nonexistent.status).toBe(notMember.status)
    expect(nonexistent.body.error.code).toBe(notMember.body.error.code)
    expect(Object.keys(nonexistent.body.error).sort()).toEqual(
      Object.keys(notMember.body.error).sort(),
    )
  })

  it('非成员对**不存在**的项目 → 仍是 404（不因叠加两种失败而变成其它码）', async () => {
    const res = await ctx.asUser(outsiderToken).post(URL_GOALS(UNKNOWN_UUID)).send(validBody)

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('PM 被降级为 VIEWER 后立即失去写权限（权限即时生效，无需重新登录）', async () => {
    const before = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '降级前' })
    expect(before.status).toBe(201)

    // 仅改库中角色，令牌不变
    await ctx.db.projectMember.update({
      where: { projectId_userId: { projectId, userId: pmId } },
      data: { role: 'VIEWER' },
    })

    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '降级后' })
    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('被移出项目的成员立即变成 404（成员关系实时读取，不做进程内缓存）', async () => {
    const first = await ctx.asUser(memberToken).post(URL_GOALS(projectId)).send({ name: 'x' })
    expect(first.status).toBe(403)

    await ctx.db.projectMember.delete({
      where: { projectId_userId: { projectId, userId: (await ctx.db.user.findUniqueOrThrow({ where: { account: 'adv-member' }, select: { id: true } })).id } },
    })

    const res = await ctx.asUser(memberToken).post(URL_GOALS(projectId)).send({ name: 'x' })
    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })
})

// ===========================================================================
// 2. 判定顺序：鉴权 → 权限 → 校验（不得越序）
// ===========================================================================

describe('对抗 2：判定顺序与信息泄漏', () => {
  it('未登录 + 非法 body → 401（不能先回 422 泄漏校验细节）', async () => {
    const res = await ctx.asUser(null).post(URL_GOALS(projectId)).send({})
    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('未登录 + 非法 JSON → 400 BAD_REQUEST（解析层先于 preHandler，见 C 类疑点）', async () => {
    // 实测：Fastify 的 content-type 解析器在路由 preHandler 之前就抛错，
    // 因此非法 JSON 一律 400，与是否登录无关。契约 I-4 明确把
    // 「请求体语法非法」归 400 BAD_REQUEST，故此处不算违规，仅记录顺序。
    const res = await ctx
      .asUser(null)
      .post(URL_GOALS(projectId))
      .set('content-type', 'application/json')
      .send('{"name": ')

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('BAD_REQUEST')
  })

  it('MEMBER + 非法 body → 403（越权先于校验，不泄漏字段规则）', async () => {
    const res = await ctx.asUser(memberToken).post(URL_GOALS(projectId)).send({})
    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('非成员 + 非法 body → 404（不泄漏字段规则，也不承认项目存在）', async () => {
    const res = await ctx.asUser(outsiderToken).post(URL_GOALS(projectId)).send({})
    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('项目不存在 + 非法 JSON → 400 BAD_REQUEST（解析层先于 handler）', async () => {
    const res = await ctx
      .asUser(pmToken)
      .post(URL_GOALS(UNKNOWN_UUID))
      .set('content-type', 'application/json')
      .send('{"name": ')

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('BAD_REQUEST')
  })

  it('不存在的方法（GET /projects/:id/goals）→ 404 NOT_FOUND（本任务只交付 POST）', async () => {
    const res = await ctx.asUser(pmToken).get(URL_GOALS(projectId))
    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })
})

// ===========================================================================
// 3. name 边界：字面空白、多字节、控制字符
// ===========================================================================

describe('对抗 3：name 的字面空白与多字节边界', () => {
  const blankCases: Array<[string, string]> = [
    ['半角空格', '     '],
    ['制表符', '\t\t'],
    ['换行符', '\n'],
    ['换行+回车+制表符混合', ' \r\n\t '],
    ['不换行空格 NBSP U+00A0', '\u00A0\u00A0'],
    ['全角空格 U+3000', '\u3000\u3000'],
    ['字节序标记 U+FEFF', '\uFEFF'],
    ['多种 Unicode 空白混合', '\t\u00A0\u3000 \n'],
  ]

  for (const [label, value] of blankCases) {
    it(`name 为${label} → 422，name: REQUIRED（决策 I-4：REQUIRED 含纯空白）`, async () => {
      const before = await goalCount(projectId)
      const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: value })

      expect(res.status).toBe(422)
      expectFieldError(res.body as ErrorBody, 'name', 'REQUIRED')
      expect(await goalCount(projectId)).toBe(before)
    })
  }

  it('name 只含零宽空格 U+200B → 记录实测（trim() 不视其为空白，属契约未定义）', async () => {
    // U+200B 在 Unicode 里是 Cf（格式字符）而非 WhiteSpace，ECMAScript 的
    // String.prototype.trim 不会去掉它，因此 '  ' 这类"隐形名称"能通过校验。
    // 契约 I-4 只写「纯空白」，未定义「不可见字符」是否算空白 → 记为契约空白，
    // 此处固化当前行为，避免将来静默变化。
    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '\u200B\u200B' })
    expect([201, 422]).toContain(res.status)
    if (res.status === 201) {
      expect(res.body.name).toBe('\u200B\u200B')
    }
  })

  it('name 两端为 Unicode 空白、中间有内容 → 201，且落库为 trim 后的内容', async () => {
    const res = await ctx
      .asUser(pmToken)
      .post(URL_GOALS(projectId))
      .send({ name: '\u3000\u00A0真实名称\u3000' })

    expect(res.status).toBe(201)
    expect(res.body.name).toBe('真实名称')
  })

  it('长度按「字符」而非「字节」计算：50 个汉字（150 字节）→ 201', async () => {
    const name = '目'.repeat(GOAL_NAME_MAX_LENGTH)
    expect(Buffer.byteLength(name, 'utf8')).toBeGreaterThan(GOAL_NAME_MAX_LENGTH)

    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name })
    expect(res.status).toBe(201)
    expect(res.body.name).toBe(name)
  })

  it('50 个汉字 + 1 → 422 TOO_LONG', async () => {
    const res = await ctx
      .asUser(pmToken)
      .post(URL_GOALS(projectId))
      .send({ name: '目'.repeat(GOAL_NAME_MAX_LENGTH + 1) })

    expect(res.status).toBe(422)
    expectFieldError(res.body as ErrorBody, 'name', 'TOO_LONG')
  })

  it('多字节 emoji 恰好上限（25 个 emoji，JS length=50）→ 201', async () => {
    const name = '😀'.repeat(GOAL_NAME_MAX_LENGTH / 2)
    expect(name.length).toBe(GOAL_NAME_MAX_LENGTH)

    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name })
    expect(res.status).toBe(201)
  })

  it('多字节 emoji 上限 + 1（26 个 emoji，JS length=52）→ 422 TOO_LONG（口径为 UTF-16 长度）', async () => {
    const name = '😀'.repeat(GOAL_NAME_MAX_LENGTH / 2 + 1)
    expect(name.length).toBeGreaterThan(GOAL_NAME_MAX_LENGTH)

    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name })
    expect(res.status).toBe(422)
    expectFieldError(res.body as ErrorBody, 'name', 'TOO_LONG')
  })

  it('name 为换行符包裹的内容 → 201，且换行被 trim 掉（不会写入孤立换行）', async () => {
    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '\n名称\n' })

    expect(res.status).toBe(201)
    expect(res.body.name).toBe('名称')
  })

  it('极长 name（10000 字符）→ 422 TOO_LONG，不产生 500', async () => {
    const res = await ctx
      .asUser(pmToken)
      .post(URL_GOALS(projectId))
      .send({ name: 'x'.repeat(10_000) })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_FAILED')
  })
})

// ===========================================================================
// 4. name / description 的类型穷举（Zod 形状层）
// ===========================================================================

describe('对抗 4：字段类型穷举', () => {
  const badNames: Array<[string, unknown]> = [
    ['undefined', undefined],
    ['null', null],
    ['数字', 123],
    ['布尔 true', true],
    ['布尔 false', false],
    ['数组', ['a']],
    ['对象', { nested: 1 }],
  ]

  for (const [label, value] of badNames) {
    it(`name 为 ${label} → 422，details 定位到 name`, async () => {
      const res = await ctx
        .asUser(pmToken)
        .post(URL_GOALS(projectId))
        .send({ name: value } as Record<string, unknown>)

      expect(res.status).toBe(422)
      const body = res.body as ErrorBody
      expect(body.error.code).toBe('VALIDATION_FAILED')
      // 契约 I-4 的字段级错误码只允许出现在 details[].code
      expect(body.error.details?.map((d) => d.field)).toContain('name')
      expect(['REQUIRED', 'INVALID_VALUE']).toContain(
        body.error.details?.find((d) => d.field === 'name')?.code,
      )
    })
  }

  const badDescriptions: Array<[string, unknown]> = [
    ['数字', 123],
    ['布尔', true],
    ['数组', ['x']],
    ['对象', { a: 1 }],
  ]

  for (const [label, value] of badDescriptions) {
    it(`description 为 ${label} → 422，details 定位到 description`, async () => {
      const res = await ctx
        .asUser(pmToken)
        .post(URL_GOALS(projectId))
        .send({ name: '合法名称', description: value })

      expect(res.status).toBe(422)
      const body = res.body as ErrorBody
      expect(body.error.details?.map((d) => d.field)).toContain('description')
    })
  }

  it('description = null → 422（契约 I-8 端点 11 的请求形状是 description?: string，null 不在其中）', async () => {
    const res = await ctx
      .asUser(pmToken)
      .post(URL_GOALS(projectId))
      .send({ name: '合法名称', description: null })

    // 若实现接受 null，会返回 201 且 description 为 null —— 与省略字段不可区分
    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details?.map((d) => d.field)).toContain('description')
  })

  it('description = 空串 → 201，且响应为 "" 而非 null（省略与空串必须可区分）', async () => {
    const res = await ctx
      .asUser(pmToken)
      .post(URL_GOALS(projectId))
      .send({ name: '合法名称', description: '' })

    expect(res.status).toBe(201)
    expect(res.body.description).toBe('')
    // 落库确认不是被转成了 null
    const row = await ctx.db.businessGoal.findUniqueOrThrow({
      where: { id: res.body.id },
      select: { description: true },
    })
    expect(row.description).toBe('')
  })

  it('description 极长（20000 字符）→ 契约未规定上限，但不得 500 或静默截断', async () => {
    const long = 'd'.repeat(20_000)
    const res = await ctx
      .asUser(pmToken)
      .post(URL_GOALS(projectId))
      .send({ name: '长描述', description: long })

    // 记录实际行为：无论 201 还是 422，都不能是 5xx、也不能写入被截断的内容
    expect([201, 422]).toContain(res.status)
    if (res.status === 201) {
      const row = await ctx.db.businessGoal.findUniqueOrThrow({
        where: { id: res.body.id },
        select: { description: true },
      })
      expect(row.description).toBe(long)
    }
  })

  it('整个请求体是数组 → 422（不是对象即形状非法）', async () => {
    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send([{ name: 'a' }])
    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_FAILED')
  })

  it('请求体为空对象 → 422，name: REQUIRED', async () => {
    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({})
    expect(res.status).toBe(422)
    expectFieldError(res.body as ErrorBody, 'name', 'REQUIRED')
  })
})

// ===========================================================================
// 5. projectId 推导（决策 I-10）与未知字段注入
// ===========================================================================

describe('对抗 5：projectId 推导与未知字段注入', () => {
  it('请求体塞入其它项目的 projectId/id/createdAt/status/sortOrder → 全部被丢弃，归属以 URL 为准', async () => {
    const otherPmId = await makeUser(ctx.db, 'adv-other-pm', '别的 PM')
    const otherProjectId = await makeProject(ctx.db, otherPmId, '另一个项目')
    const otherGoalId = await makeGoal(ctx.db, otherProjectId, '别的目标', { sortOrder: 41 })
    const otherGoal = await ctx.db.businessGoal.findUniqueOrThrow({
      where: { id: otherGoalId },
      select: { id: true, projectId: true },
    })
    void otherGoal

    const injected = {
      name: '注入用例',
      projectId: otherProjectId,
      id: otherGoalId,
      createdAt: '1999-01-01T00:00:00.000Z',
      status: 'DONE',
      sortOrder: 999,
    }
    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send(injected)

    expect(res.status).toBe(201)
    // 响应归属 = URL 项目
    expect(res.body.projectId).toBe(projectId)
    expect(res.body.id).not.toBe(otherGoalId)
    // 注入的 status / sortOrder 不得生效
    expect(res.body.status).toBe('ACTIVE')
    expect(res.body.sortOrder).toBe(0)
    // 响应里不得回显 createdAt（契约 I-2 的 BusinessGoal 无该字段）
    expect(res.body).not.toHaveProperty('createdAt')

    // 反向核对数据库：行确实落在 URL 的项目，且另一项目未被牵连
    const row = await ctx.db.businessGoal.findUniqueOrThrow({
      where: { id: res.body.id },
      select: { projectId: true, status: true, sortOrder: true },
    })
    expect(row.projectId).toBe(projectId)
    expect(row.status).toBe('ACTIVE')
    expect(row.sortOrder).toBe(0)
    expect(await goalCount(otherProjectId)).toBe(1)
  })

  it('带未知顶层字段（foo / __proto__ / constructor）→ 201，未知字段不落库也不回显', async () => {
    const res = await ctx
      .asUser(pmToken)
      .post(URL_GOALS(projectId))
      .send({ name: '未知字段', foo: 'bar', extra: { deep: 1 }, isSensitive: true })

    expect(res.status).toBe(201)
    expect(Object.keys(res.body).sort()).toEqual(
      ['description', 'id', 'name', 'projectId', 'sortOrder', 'status'].sort(),
    )
    const row = await ctx.db.businessGoal.findUniqueOrThrow({
      where: { id: res.body.id },
      select: { projectId: true, name: true },
    })
    expect(row.projectId).toBe(projectId)
  })

  it('URL 项目已有大 sortOrder 时，注入体里的小 sortOrder 不得影响计算结果', async () => {
    await makeGoal(ctx.db, projectId, '既有目标', { sortOrder: 100 })

    const res = await ctx
      .asUser(pmToken)
      .post(URL_GOALS(projectId))
      .send({ name: '新目标', sortOrder: 0 })

    expect(res.status).toBe(201)
    expect(res.body.sortOrder).toBe(101)
  })

  it('projectId 为含特殊字符的路径段 → 404，不产生 500', async () => {
    for (const pid of ['../../etc/passwd', '%00', 'null', 'undefined', 'true']) {
      const res = await ctx.asUser(pmToken).post(URL_GOALS(pid)).send({ name: 'a' })
      expect(res.status).toBe(404)
      expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
    }
  })

  it('projectId 长度 ≤ 100 → 404 NOT_FOUND（走统一错误信封）', async () => {
    for (const n of [36, 99, 100]) {
      const res = await ctx.asUser(pmToken).post(URL_GOALS('x'.repeat(n))).send({ name: 'a' })
      expect(res.status).toBe(404)
      expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
    }
    expect(await ctx.db.businessGoal.count()).toBe(0)
  })

  it('projectId 长度 ≥ 101 → 414 且响应体**不是** ErrorResponse 信封（契约 I-3 违规，见 B2）', async () => {
    // 实测：Fastify 默认 maxParamLength = 100，超限时由**路由层**直接返回
    // `{"error":"Bad Request","code":"FST_ERR_MAX_PARAM_LENGTH","statusCode":414}`，
    // 完全绕过 app.setErrorHandler —— 契约 I-3 要求失败响应固定为
    // `{ error: { code, message } }`，此处 `error` 是字符串、`code` 在顶层。
    const res = await ctx.asUser(pmToken).post(URL_GOALS('x'.repeat(101))).send({ name: 'a' })

    expect(res.status).toBe(414)
    // 契约 I-3 的形状必须满足：body.error 是对象且含 code
    const body = res.body as { error?: unknown; code?: unknown }
    expect(typeof body.error).not.toBe('object')
    expect(body.code).toBe('FST_ERR_MAX_PARAM_LENGTH')

    // 反向断言：若哪天被修好成统一信封，本用例会失败并提醒更新
    expect(Object.prototype.hasOwnProperty.call(res.body, 'statusCode')).toBe(true)
    expect(await ctx.db.businessGoal.count()).toBe(0)
  })
})

// ===========================================================================
// 6. sortOrder 对抗场景
// ===========================================================================

describe('对抗 6：sortOrder 的对抗场景', () => {
  it('已有目标被人为设成大值 → 新建取「最大值 + 1」而非「行数」', async () => {
    await makeGoal(ctx.db, projectId, '被改过的目标', { sortOrder: 77 })
    expect(await goalCount(projectId)).toBe(1)

    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '新目标' })

    expect(res.status).toBe(201)
    // 若实现误用 count()，此处会是 1
    expect(res.body.sortOrder).toBe(78)
  })

  it('稀疏序号（0 与 500）→ 下一条为 501', async () => {
    await makeGoal(ctx.db, projectId, 'A', { sortOrder: 0 })
    await makeGoal(ctx.db, projectId, 'B', { sortOrder: 500 })

    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: 'C' })
    expect(res.body.sortOrder).toBe(501)
  })

  it('删除中间目标后新建仍取最大值 + 1（不填补空洞）', async () => {
    const a = await makeGoal(ctx.db, projectId, 'A', { sortOrder: 0 })
    await makeGoal(ctx.db, projectId, 'B', { sortOrder: 1 })
    await makeGoal(ctx.db, projectId, 'C', { sortOrder: 2 })
    await ctx.db.businessGoal.delete({ where: { id: a } })

    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: 'D' })
    expect(res.body.sortOrder).toBe(3)
  })

  it('两个项目交叉创建：序号各自独立，互不影响', async () => {
    const otherPmId = await makeUser(ctx.db, 'adv-pm-2', '第二个 PM')
    const otherProjectId = await makeProject(ctx.db, otherPmId, '第二项目')
    const otherToken = ctx.loginAs(otherPmId)

    // 本项目先来 2 条
    const p1: number[] = []
    for (const n of ['P1-1', 'P1-2']) {
      const r = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: n })
      p1.push(r.body.sortOrder)
    }
    // 另一项目来 3 条
    const p2: number[] = []
    for (const n of ['P2-1', 'P2-2', 'P2-3']) {
      const r = await ctx.asUser(otherToken).post(URL_GOALS(otherProjectId)).send({ name: n })
      p2.push(r.body.sortOrder)
    }
    // 本项目再来 1 条 —— 必须是 2，而不是被另一个项目的 0/1/2 抬高
    const back = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: 'P1-3' })

    expect(p1).toEqual([0, 1])
    expect(p2).toEqual([0, 1, 2])
    expect(back.body.sortOrder).toBe(2)
  })

  it('已有目标的 sortOrder 为负数 → 下一条为最大值 + 1（不假设非负）', async () => {
    await makeGoal(ctx.db, projectId, '负号目标', { sortOrder: -5 })
    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '正号目标' })
    expect(res.body.sortOrder).toBe(-4)
  })

  it('串行创建 8 条 → 序号为 0..7 且互不重复', async () => {
    const orders: number[] = []
    for (let i = 0; i < 8; i += 1) {
      const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: `g${i}` })
      expect(res.status).toBe(201)
      orders.push(res.body.sortOrder)
    }
    expect(orders).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('并发创建 5 条 → 序号必须唯一（契约 I-8：sortOrder = 当前项目内最大值 + 1）', async () => {
    // 「读最大值 → 写入」若未放在同一事务内，并发请求会算出相同的值。
    // 断言消息里带上实测序列，失败时即是可复现证据。
    const results = await Promise.all(
      Array.from({ length: 5 }, (_unused, i) =>
        ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: `并发-${i}` }),
      ),
    )

    for (const res of results) expect(res.status).toBe(201)
    const orders = results.map((r) => r.body.sortOrder as number)

    expect(orders.every((o) => Number.isInteger(o))).toBe(true)
    expect(
      new Set(orders).size,
      `实测 sortOrder 序列 = [${orders.join(', ')}]；重复即说明存在读-改-写竞态`,
    ).toBe(orders.length)
  })

  it('并发创建后数据库内序号也与响应一致且唯一', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_unused, i) =>
        ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: `并发B-${i}` }),
      ),
    )
    const rows = await ctx.db.businessGoal.findMany({
      where: { projectId },
      select: { sortOrder: true },
    })
    expect(rows).toHaveLength(4)
    const orders = rows.map((r) => r.sortOrder).sort((a, b) => a - b)
    expect(
      new Set(orders).size,
      `库内实测 sortOrder 集合 = [${orders.join(', ')}]`,
    ).toBe(rows.length)
    // 响应与库中集合一致
    expect(orders).toEqual(results.map((r) => r.body.sortOrder as number).sort((a, b) => a - b))
  })

  it('并发 8 条 → 落库行数为 8，且序号集合必须是 0..7（竞态的最强证据）', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_unused, i) =>
        ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: `并发C-${i}` }),
      ),
    )
    for (const res of results) expect(res.status).toBe(201)

    const rows = await ctx.db.businessGoal.findMany({
      where: { projectId },
      select: { sortOrder: true },
    })
    expect(rows).toHaveLength(8)
    const orders = rows.map((r) => r.sortOrder).sort((a, b) => a - b)
    // 8 条目标若各自独占序号，集合必然恰好是 [0..7]；出现重复则必有空洞
    expect(orders, `库内实测 = [${orders.join(', ')}]`).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('并发创建 3 条，其中 2 条 name 非法 → 只有 1 条落库，序号不跳号', async () => {
    const before = await goalCount(projectId)
    const results = await Promise.all([
      ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '合法' }),
      ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '   ' }),
      ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: 'x'.repeat(500) }),
    ])

    expect(results.map((r) => r.status).sort()).toEqual([201, 422, 422])
    expect(await goalCount(projectId)).toBe(before + 1)
  })
})

// ===========================================================================
// 7. 响应形状逐字段核对（契约 I-2）
// ===========================================================================

describe('对抗 7：响应形状', () => {
  it('键集合必须精确等于 BusinessGoal 的 6 个字段（多给字段也是契约违规）', async () => {
    const res = await ctx
      .asUser(pmToken)
      .post(URL_GOALS(projectId))
      .send({ name: '形状核对', description: '描述' })

    expect(res.status).toBe(201)
    expect(Object.keys(res.body).sort()).toEqual(
      ['description', 'id', 'name', 'projectId', 'sortOrder', 'status'].sort(),
    )
    // 契约 I-2 的 BusinessGoal **没有** createdAt
    expect(res.body).not.toHaveProperty('createdAt')
    expect(res.body).not.toHaveProperty('activities')
    expect(res.body).not.toHaveProperty('updatedAt')
  })

  it('字段类型逐个断言：id/projectId/name 为 string，description 为 string|null，sortOrder 为 integer', async () => {
    const withDesc = await ctx
      .asUser(pmToken)
      .post(URL_GOALS(projectId))
      .send({ name: '有描述', description: 'D' })
    const noDesc = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '无描述' })

    for (const res of [withDesc, noDesc]) {
      expect(typeof res.body.id).toBe('string')
      expect(typeof res.body.projectId).toBe('string')
      expect(typeof res.body.name).toBe('string')
      expect(Number.isInteger(res.body.sortOrder)).toBe(true)
      expect(typeof res.body.status).toBe('string')
    }
    expect(typeof withDesc.body.description).toBe('string')
    expect(noDesc.body.description).toBeNull()
  })

  it('description 缺省时必须是 null 而非 undefined（JSON 序列化后键必须存在）', async () => {
    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '无描述' })

    expect(res.status).toBe(201)
    expect(Object.prototype.hasOwnProperty.call(res.body, 'description')).toBe(true)
    expect(res.body.description).toBeNull()
    // 序列化字符串里不能出现 undefined 字样
    expect(JSON.stringify(res.body)).not.toContain('undefined')
  })

  it('响应 id 是可直接用于后续请求的 uuid，且落库可查', async () => {
    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: 'uuid 检查' })

    expect(res.body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    const row = await ctx.db.businessGoal.findUnique({ where: { id: res.body.id } })
    expect(row).not.toBeNull()
  })

  it('status 只可能是 ACTIVE/DONE 两者之一，且首建必为 ACTIVE', async () => {
    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '状态' })
    expect(['ACTIVE', 'DONE']).toContain(res.body.status)
    expect(res.body.status).toBe('ACTIVE')
  })

  it('201 响应不得带 Location 之外的意外头/字段；body 即资源本身（契约 I-3 不套壳）', async () => {
    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '信封' })
    expect(res.status).toBe(201)
    // 契约 I-3：单个资源响应体即资源本身，不得包在 { data: ... } 或 { item: ... } 里
    expect(res.body).not.toHaveProperty('data')
    expect(res.body).not.toHaveProperty('item')
  })
})

// ===========================================================================
// 8. 副作用隔离
// ===========================================================================

describe('对抗 8：副作用隔离（失败的请求必须什么都没发生）', () => {
  it('401 / 403 / 404 / 422 四类失败后，目标表行数一律不变', async () => {
    const before = await goalCount(projectId)

    await ctx.asUser(null).post(URL_GOALS(projectId)).send({ name: 'x' }) // 401
    await ctx.asUser(memberToken).post(URL_GOALS(projectId)).send({ name: 'x' }) // 403
    await ctx.asUser(outsiderToken).post(URL_GOALS(projectId)).send({ name: 'x' }) // 404
    await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '  ' }) // 422
    await ctx.asUser(pmToken).post(URL_GOALS(UNKNOWN_UUID)).send({ name: 'x' }) // 404

    expect(await goalCount(projectId)).toBe(before)
  })

  it('全部失败请求之后，第一次成功创建仍必须拿到 sortOrder = 0（失败不占用序号）', async () => {
    await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '   ' })
    await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: 'a'.repeat(999) })
    await ctx.asUser(memberToken).post(URL_GOALS(projectId)).send({ name: 'x' })

    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '第一次成功' })
    expect(res.status).toBe(201)
    expect(res.body.sortOrder).toBe(0)
  })

  it('422 不得触发对其它项目的写入（跨项目副作用）', async () => {
    const otherPmId = await makeUser(ctx.db, 'adv-pm-3', '第三个 PM')
    const otherProjectId = await makeProject(ctx.db, otherPmId, '第三项目')

    await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '' })

    expect(await goalCount(projectId)).toBe(0)
    expect(await goalCount(otherProjectId)).toBe(0)
    expect(await ctx.db.businessGoal.count()).toBe(0)
  })

  it('403 不得触发写入，且不得在项目内留下任何痕迹', async () => {
    await ctx.asUser(viewerToken).post(URL_GOALS(projectId)).send({ name: 'VIEWER 写入' })
    expect(await ctx.db.businessGoal.count()).toBe(0)
  })

  it('不存在的项目路径被拒绝后，不得创建任何目标（外键与前置检查都要求如此）', async () => {
    await ctx.asUser(pmToken).post(URL_GOALS(UNKNOWN_UUID)).send({ name: '幽灵项目' })
    expect(await ctx.db.businessGoal.count()).toBe(0)
  })
})

// ===========================================================================
// 9. 幂等 / 重复请求语义
// ===========================================================================

describe('对抗 9：重复请求与并发安全', () => {
  it('同名目标允许重复创建，各得独立 id 与递增 sortOrder（契约未规定 name 唯一）', async () => {
    const a = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '重名' })
    const b = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '重名' })

    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    expect(a.body.id).not.toBe(b.body.id)
    expect([a.body.sortOrder, b.body.sortOrder]).toEqual([0, 1])
  })

  it('完全相同的请求体重复 3 次 → 3 行，序号 0/1/2（POST 非幂等，符合契约）', async () => {
    const results = []
    for (let i = 0; i < 3; i += 1) {
      results.push(await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '重复', description: 'd' }))
    }
    expect(results.map((r) => r.status)).toEqual([201, 201, 201])
    expect(results.map((r) => r.body.sortOrder)).toEqual([0, 1, 2])
    expect(await goalCount(projectId)).toBe(3)
  })
})
