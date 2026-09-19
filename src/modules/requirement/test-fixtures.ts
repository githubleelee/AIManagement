/**
 * 需求层级模块 —— 测试夹具（M4 / US-03）
 *
 * 为什么本文件存在
 *   契约「Testing Decisions → 测试数据工厂」规定 T0.5 应交付 `test/factories.ts`，
 *   但截至 T3.1 开工时该文件**尚不存在**：仓库只有 `test/http-support.ts`，
 *   且只提供 `makeUser` / `makeProject` / `makeMember` 三个函数
 *   （`makeGoal` / `makeActivity` / `makeStory` / `makeSensitive` 均缺）。
 *
 *   因此本文件在**本模块目录内**自建所需夹具，直接写库、不经 HTTP：
 *   - 不触碰任何共享或冻结文件（`test/` 与 `src/shared/` 均未改动）；
 *   - 与前序测试用例的写法一致（`test/t0-gap-fix.test.ts` 亦为「测试文件自行造数」）。
 *   待 T0.5 的 `test/factories.ts` 落地后，本文件可整体替换为对它的引用。
 *   该缺口已记入表五，留 Sprint 回顾处理。
 *
 * 设计原则（与契约一致）
 *   工厂直接插入数据库，**复用表默认值**（如 `UserStory.status` 默认 `DRAFT`、
 *   `isSensitive` 默认 `false`），这样夹具与端点写入路径的口径天然一致：
 *   若哪天默认值被改动，夹具不必同步修改也不会说谎。
 */
import type { HttpTestContext } from '../../../test/http-support.js'

/** 夹具函数统一接收的数据库句柄。 */
type Db = HttpTestContext['db']

// ---------------------------------------------------------------------------
// sortOrder 的取值口径
//
// ⚠️ 为什么必须要个助手而不能硬编码 0：
//   `BusinessGoal.sortOrder` 与 `UserActivity.sortOrder` 在数据模型里是**必填**字段
//   （`sortOrder Int`，无 `@default`，见决策 I-7）。因此 Prisma 生成的
//   `...UncheckedCreateInput` 把 `sortOrder: number` 声明为**必填**，夹具不能省略它。
//
//   若这里硬编码 `0`，则造第二条目标时就会出现「两条目标 sortOrder 都是 0」的非法
//   中间状态；T3.3 的排序测试（端点 14 全量替换为下标 0..n-1）与 T3.1 的
//   「最大值 + 1」测试都会因此失去可信度。
//   所以助手**复刻端点的口径**：项目内（活动则是目标内）最大值 + 1，空集合视作 -1。
//   这也让夹具与端点写入路径对同一概念只有一处定义之外的第二种表达，便于交叉验证。
// ---------------------------------------------------------------------------

/** 取该项目内下一个可用的目标 sortOrder（= 现有最大值 + 1）。 */
export async function nextGoalSortOrderInDb(db: Db, projectId: string): Promise<number> {
  const aggregate = await db.businessGoal.aggregate({
    where: { projectId },
    _max: { sortOrder: true },
  })
  const currentMax = aggregate._max.sortOrder
  return (currentMax === null ? -1 : currentMax) + 1
}

/** 取该目标下下一个可用的活动 sortOrder（= 该目标内现有最大值 + 1）。 */
export async function nextActivitySortOrderInDb(db: Db, goalId: string): Promise<number> {
  const aggregate = await db.userActivity.aggregate({
    where: { goalId },
    _max: { sortOrder: true },
  })
  const currentMax = aggregate._max.sortOrder
  return (currentMax === null ? -1 : currentMax) + 1
}

/** 造一个业务目标，返回其 id。`sortOrder` 省略时取项目内下一个序号。 */
export async function makeGoal(
  db: Db,
  projectId: string,
  name = '测试目标',
  options: { description?: string | null; sortOrder?: number } = {},
): Promise<string> {
  const goal = await db.businessGoal.create({
    data: {
      projectId,
      name,
      description: options.description ?? null,
      sortOrder: options.sortOrder ?? (await nextGoalSortOrderInDb(db, projectId)),
    },
    select: { id: true },
  })
  return goal.id
}

/** 造一个用户活动，返回其 id。`projectId` 由调用方给出（端点 15 会从 goalId 推导）。 */
export async function makeActivity(
  db: Db,
  projectId: string,
  goalId: string,
  name = '测试活动',
  options: { description?: string | null; sortOrder?: number } = {},
): Promise<string> {
  const activity = await db.userActivity.create({
    data: {
      projectId,
      goalId,
      name,
      description: options.description ?? null,
      sortOrder: options.sortOrder ?? (await nextActivitySortOrderInDb(db, goalId)),
    },
    select: { id: true },
  })
  return activity.id
}

/** 造一条用户故事，返回其 id。三段式字段与业务价值、优先级给默认值，便于覆写。 */
export async function makeStory(
  db: Db,
  projectId: string,
  activityId: string,
  overrides: {
    title?: string
    roleText?: string
    capabilityText?: string
    valueText?: string
    businessValue?: string
    priority?: 'P0' | 'P1' | 'P2'
    status?: 'DRAFT' | 'PLANNING' | 'DONE'
    acceptanceCriteria?: string | null
    isSensitive?: boolean
  } = {},
): Promise<string> {
  const story = await db.userStory.create({
    data: {
      projectId,
      activityId,
      title: overrides.title ?? '测试故事',
      roleText: overrides.roleText ?? '项目经理',
      capabilityText: overrides.capabilityText ?? '建立业务目标',
      valueText: overrides.valueText ?? '结构化梳理需求',
      businessValue: overrides.businessValue ?? '提升需求可追溯性',
      priority: overrides.priority ?? 'P0',
      // status / isSensitive 不显式写入时由表默认值决定（DRAFT / false）
      ...(overrides.status === undefined ? {} : { status: overrides.status }),
      acceptanceCriteria: overrides.acceptanceCriteria ?? null,
      ...(overrides.isSensitive === undefined ? {} : { isSensitive: overrides.isSensitive }),
    },
    select: { id: true },
  })
  return story.id
}

/**
 * 造一个任务，返回其 id。
 *
 * 为什么在 T3.9 补上：端点 22（删除用户故事）的 `HAS_CHILDREN` 分支要求故事下
 * **存在任务**，否则无法触发外键 RESTRICT。契约「测试数据工厂」清单里本就有
 * `makeTask`，只是 T3.1 当时用不到，故此前未实现。
 *
 * 契约要求：`makeTask` **必须在内部满足「验收人 ≠ 负责人」**，否则所有下游测试
 * 都要各自重复处理这个前置条件。本函数的两个 id 由调用方给出，因此改为**显式拒绝**
 * 相等的情形 —— 与其让下游写出一条违反端点 25 约束的脏数据，不如立刻失败。
 *
 * `planStart` / `planEnd` 缺省给合法的 `YYYY-MM-DD`（决策 I-10 的固定格式）；
 * 任务状态不显式写入，依赖表默认值 `'TODO'`（决策 I-7）。
 */
export async function makeTask(
  db: Db,
  projectId: string,
  storyId: string,
  ownerUserId: string,
  acceptorUserId: string,
  options: {
    title?: string
    description?: string | null
    planStart?: string
    planEnd?: string
    status?: 'TODO' | 'DOING' | 'DONE'
    isSensitive?: boolean
  } = {},
): Promise<string> {
  if (ownerUserId === acceptorUserId) {
    throw new Error(
      'makeTask：负责人与验收人不能是同一人（契约「测试数据工厂」要求夹具内部满足该约束）',
    )
  }

  const task = await db.task.create({
    data: {
      projectId,
      storyId,
      title: options.title ?? '测试任务',
      description: options.description ?? null,
      ownerUserId,
      acceptorUserId,
      planStart: options.planStart ?? '2026-01-01',
      planEnd: options.planEnd ?? '2026-01-02',
      // status / isSensitive 不显式写入时由表默认值决定（TODO / false）
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(options.isSensitive === undefined ? {} : { isSensitive: options.isSensitive }),
    },
    select: { id: true },
  })
  return task.id
}

/**
 * 把某个故事或任务标记为敏感，并指定可见成员白名单。
 *
 * 注意 `ObjectVisibility` 的 `objectId` 是**多态列、无真实外键**（决策 I-7 特殊约定），
 * 因此这里必须显式写入 `projectId`。
 */
export async function makeSensitive(
  db: Db,
  projectId: string,
  objectType: 'story' | 'task',
  objectId: string,
  userIds: string[],
): Promise<void> {
  await db.objectVisibility.createMany({
    data: userIds.map((userId) => ({ projectId, objectType, objectId, userId })),
  })
}
