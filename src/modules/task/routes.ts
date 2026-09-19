/**
 * M5 任务模块 —— 端点 24 / 25（T5-01 行走骨架）
 *
 * 权威来源：`docs/sprint1-spec-interface-contract.md` 决策 I-8 端点 24、25。
 *
 * T5-01 做**形状校验**（Zod）：必填、标题长度上限、日期格式 YYYY-MM-DD；
 * T5-02 在形状校验之后调用 `./rules.js` 的 `assertTaskAssignment`，落地成员归属、
 * 成员数 ≥ 2、验收人 ≠ 负责人、结束 ≥ 开始等业务规则（契约决策 I-2b 的职责边界）。
 * 该函数是创建（端点 25）与编辑（端点 28，T5-03）共用的单一入口，入参为「合并后的最终值」。
 *
 * 依赖：Actor 注入 / can() / visibilityScope() 暂由 `./_t0-stubs.js` 提供；
 * T0-04、T0-05 合入后改这里的 import 指向 src/auth 与 src/modules/authz 即可。
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AppError } from '../../shared/errors.js'
import { dateSchema, toFieldErrors } from '../../shared/validation.js'
import type { TaskStatus, TaskView, UserBrief } from '../../shared/types.js'
import { prisma } from '../../db/client.js'
import { can, requireActorUserId, visibilityScope } from './_t0-stubs.js'
import { assertTaskAssignment } from './rules.js'

/**
 * 任务标题长度上限。
 *
 * 契约端点 25 只声明 `title: REQUIRED | TOO_LONG`，未冻结具体数字。
 * 这里作为形状校验的一部分取 200；若团队后续统一长度标准，只改此常量。
 */
export const TASK_TITLE_MAX_LENGTH = 200

/** 创建任务的请求体 schema（只做单字段形状校验，契约决策 I-2b 的职责边界）。 */
const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(TASK_TITLE_MAX_LENGTH),
  description: z.string().optional(),
  ownerUserId: z.string().min(1),
  acceptorUserId: z.string().min(1),
  planStart: dateSchema,
  planEnd: dateSchema,
})

type UserRow = { id: string; account: string; displayName: string }

type TaskRow = {
  id: string
  projectId: string
  storyId: string
  title: string
  description: string | null
  ownerUserId: string
  acceptorUserId: string
  planStart: string
  planEnd: string
  status: string
  isSensitive: boolean
  createdAt: Date
}

/** 与「对象不存在」完全一致的 404，响应体不含对象任何字段（契约 I-3）。 */
function notFound(): AppError {
  return new AppError(404, 'NOT_FOUND', '资源不存在')
}

/** 对象可见但操作不允许：403。 */
function forbidden(): AppError {
  return new AppError(403, 'FORBIDDEN', '没有权限执行该操作')
}

/** 把 can() 的拒绝结果原样翻译成 AppError，调用方不自行判断 403/404（契约 I-5 约束 2）。 */
function denied(decision: { status: 403 | 404; code: 'FORBIDDEN' | 'NOT_FOUND' }): AppError {
  return decision.code === 'NOT_FOUND' ? notFound() : forbidden()
}

/** DB 的枚举列是 String，读取时收窄为 TaskStatus；未知值兜底 TODO（不会发生）。 */
function toTaskStatus(value: string): TaskStatus {
  return value === 'TODO' || value === 'DOING' || value === 'DONE' ? value : 'TODO'
}

function toUserBrief(user: UserRow): UserBrief {
  return { id: user.id, account: user.account, displayName: user.displayName }
}

/** 组装 TaskView：内嵌 owner / acceptor 的 UserBrief，createdAt 转 ISO 8601 UTC。 */
async function loadTaskView(task: TaskRow): Promise<TaskView> {
  const users = await prisma.user.findMany({
    where: { id: { in: [task.ownerUserId, task.acceptorUserId] } },
    select: { id: true, account: true, displayName: true },
  })
  const byId = new Map(users.map((user) => [user.id, user]))
  const owner = byId.get(task.ownerUserId)
  const acceptor = byId.get(task.acceptorUserId)
  if (!owner || !acceptor) {
    // 外键保证存在；走到这里说明数据被外部破坏，交统一错误处理器转 500。
    throw new Error('任务负责人或验收人不存在')
  }

  return {
    id: task.id,
    projectId: task.projectId,
    storyId: task.storyId,
    title: task.title,
    description: task.description,
    ownerUserId: task.ownerUserId,
    acceptorUserId: task.acceptorUserId,
    planStart: task.planStart,
    planEnd: task.planEnd,
    status: toTaskStatus(task.status),
    isSensitive: task.isSensitive,
    createdAt: task.createdAt.toISOString(),
    owner: toUserBrief(owner),
    acceptor: toUserBrief(acceptor),
  }
}

/** 任务模块路由插件。由 src/routes.ts 集中注册（本工单不修改该冻结文件）。 */
export async function taskRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // 端点 24：GET /stories/:storyId/tasks —— 权限 project.read
  // -------------------------------------------------------------------------
  app.get('/stories/:storyId/tasks', async (request, reply) => {
    const actorUserId = requireActorUserId(request)
    const { storyId } = request.params as { storyId: string }

    const story = await prisma.userStory.findUnique({
      where: { id: storyId },
      select: { id: true, projectId: true },
    })
    if (!story) {
      throw notFound()
    }

    const decision = await can(actorUserId, 'project.read', {
      kind: 'story',
      projectId: story.projectId,
      objectId: story.id,
    })
    if (!decision.allow) {
      throw denied(decision)
    }

    // 可见性过滤：PM 返回 all（等价于不过滤），其余按可见 id 子集过滤。
    const scope = await visibilityScope(actorUserId, story.projectId, 'task')
    const tasks = await prisma.task.findMany({
      where:
        scope.mode === 'all'
          ? { storyId: story.id }
          : { storyId: story.id, id: { in: scope.ids } },
      // 排序：planStart 升序，相同则 createdAt 升序（契约端点 24）
      orderBy: [{ planStart: 'asc' }, { createdAt: 'asc' }],
    })

    const items = await Promise.all(tasks.map((task) => loadTaskView(task)))
    return reply.status(200).send({ items })
  })

  // -------------------------------------------------------------------------
  // 端点 25：POST /stories/:storyId/tasks —— 权限 task.write
  // -------------------------------------------------------------------------
  app.post('/stories/:storyId/tasks', async (request, reply) => {
    const actorUserId = requireActorUserId(request)
    const { storyId } = request.params as { storyId: string }

    const story = await prisma.userStory.findUnique({
      where: { id: storyId },
      select: { id: true, projectId: true },
    })
    if (!story) {
      throw notFound()
    }

    const decision = await can(actorUserId, 'task.write', {
      kind: 'story',
      projectId: story.projectId,
      objectId: story.id,
    })
    if (!decision.allow) {
      throw denied(decision)
    }

    // 第一步：只做形状校验（Zod 负责单字段形状，契约决策 I-2b）。
    const parsed = createTaskSchema.safeParse(request.body)
    if (!parsed.success) {
      throw new AppError(
        422,
        'VALIDATION_FAILED',
        '字段校验失败',
        toFieldErrors(parsed.error.issues),
      )
    }

    const body = parsed.data

    // 第二步：业务规则（跳字段比较 / 查库）。创建时形状校验已保证各字段存在，
    // 「合并后的最终值」即请求体本身；T5-03 的 PATCH 只需先合并再调用同一函数。
    await assertTaskAssignment(prisma, story.projectId, {
      ownerUserId: body.ownerUserId,
      acceptorUserId: body.acceptorUserId,
      planStart: body.planStart,
      planEnd: body.planEnd,
    })

    const task = await prisma.task.create({
      data: {
        // projectId 从 storyId 所属故事推导，不接受请求体传入（契约决策 I-10）
        projectId: story.projectId,
        storyId: story.id,
        title: body.title,
        description: body.description ?? null,
        ownerUserId: body.ownerUserId,
        acceptorUserId: body.acceptorUserId,
        planStart: body.planStart,
        planEnd: body.planEnd,
        // status 默认 TODO、isSensitive 默认 false，由 schema 默认值保证，
        // 请求体无法覆盖这两个字段（契约决策 I-10 的敏感字段写入路径）。
      },
    })

    const view = await loadTaskView(task)
    return reply.status(201).send(view)
  })
}
