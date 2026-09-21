/**
 * 测试数据工厂（T0.5 交付，**全员只读**）
 *
 * 契约《Sprint 1 需求规格说明书 · 接口契约》「Testing Decisions → 测试数据工厂」规定：
 *
 *   makeUser(account, displayName)                  → UserBrief
 *   makeProject(ownerUserId, name)                  → { projectId, ownerUserId }
 *   makeMember(projectId, userId, role)             → void
 *   makeGoal(projectId, name)                       → goalId
 *   makeActivity(goalId, name)                      → activityId
 *   makeStory(activityId, overrides?)               → storyId
 *   makeTask(storyId, ownerUserId, acceptorUserId)  → taskId
 *   makeSensitive(objectType, objectId, userIds)    → void
 *
 * **本文件的签名与上表逐字一致。** 之所以不在签名里带数据库参数，是契约的直接要求；
 * 运行时库由 `test/helpers.ts` 的 `createTestContext()` 登记（见该文件顶部说明）。
 *
 * ===========================================================================
 * 三条设计原则（都有具体理由，不是风格偏好）
 * ===========================================================================
 *
 * ① **工厂直接写库、不经 HTTP**，并**复用表默认值**（`UserStory.status` 默认 `DRAFT`、
 *    `isSensitive` 默认 `false`、`Task.status` 默认 `TODO`）。这样夹具与端点写入路径的
 *    口径天然一致：哪天默认值被改，夹具不必同步也不会说谎。
 *    —— 但**验证一律走 HTTP**：契约「唯一 seam」要求断言打在接口层，工厂只是把
 *    前置数据摆好，不能替代接口断言（尤其不能替代越权用例）。
 *
 * ② **子对象的 `projectId` 由父级推导**，与契约决策 I-10 对端点的要求同构：
 *    `makeActivity(goalId, ...)` 自己查目标的 `projectId`、`makeStory(activityId, ...)`
 *    查活动的、`makeTask(storyId, ...)` 查故事的。这样"跨项目挂载"这类脏数据
 *    **在工厂层面就造不出来**，与端点 15/19/25 的结构性保证保持一致。
 *
 * ③ **`sortOrder` 复刻端点口径（最大值 + 1，空集合视作 -1）**，不硬编码 0。
 *    `BusinessGoal.sortOrder` 与 `UserActivity.sortOrder` 是必填且无默认值；若硬编码 0，
 *    造第二条时就会出现「两条 sortOrder 都是 0」的非法中间态，使 T3.3 的全量替换测试
 *    与 T3.1 的「最大值 + 1」测试同时失去可信度。
 *    （该口径与 M4 的 `src/modules/requirement/test-fixtures.ts` 一致。）
 *
 * ===========================================================================
 * 与既有夹具的关系（**不要造第三套**）
 * ===========================================================================
 *
 *   `test/http-support.ts`            保留其 3 个「带 db 参数」的旧工厂，供已引用它的
 *                                     14 个测试文件继续使用，**本文件不改动它**。
 *   本文件（T0.5）                   契约命名的正式版，**新代码请用这个**。
 *   `src/modules/requirement/test-fixtures.ts`（M4）自建夹具，其文件头已写明
 *                                     「待 T0.5 的 test/factories.ts 落地后，本文件可整体
 *                                     替换为对它的引用」—— 迁移由 M4 自行决定与执行。
 *   `src/modules/task/_t0-stubs.ts` + `_test-harness.ts`（M5）自建桩与装置，文件头自述
 *                                     「不得进入 main，rebase 时删除」—— 同上。
 *
 * ===========================================================================
 * 与 M4 自建夹具的一处**有意的语义差异**（迁移时必须知道）
 * ===========================================================================
 *
 *   `makeSensitive` 除了写入 `ObjectVisibility` 白名单，**还会把目标对象的
 *   `isSensitive` 置为 `true`**。
 *   理由：契约里的这条工厂叫「标记为敏感」，对应用户故事 16（标记敏感）与 17（指定可见成员）
 *   两件事 —— 端点 23 的一次调用同时做这两件事。若只写白名单而不置标记，工厂名字与行为
 *   不符，调用方还得自己再补一次 `isSensitive`。
 *   M4 的自建 `makeSensitive` 只写白名单（其调用方先经 `makeStory({ isSensitive: true })`
 *   置标记），两者叠加是幂等的；但若 M4 直接换成本函数，请确认该差异不会改变测试语义。
 */
import type {
  Priority,
  ProjectRole,
  StoryStatus,
  UserBrief,
  VisibilityObjectType,
} from '../src/shared/types.js'
import { hashPassword } from '../src/auth/password.js'
import { getActiveDatabase, TEST_PASSWORD } from './helpers.js'

// ---------------------------------------------------------------------------
// 一、用户与项目（T0.5 之前的 `test/http-support.ts` 只提供到这一层）
// ---------------------------------------------------------------------------

/**
 * 造一个用户，返回 `UserBrief`。
 *
 * 密码用真实 `scrypt` 哈希（`hashPassword` 是 async，故本函数也是 async），
 * 便于接入端点 1 之后可直接登录 —— 目前测试用 `ctx.loginAs(user.id)` 直接签发令牌。
 *
 * ⚠️ `account` 是唯一列：同一测试内重复用同一个 account 会触发唯一约束。
 *    常规用法是 `beforeEach(() => ctx.reset())` 清库，测试之间互不污染。
 */
export async function makeUser(account: string, displayName = account): Promise<UserBrief> {
  const db = getActiveDatabase()
  return db.user.create({
    data: { account, displayName, passwordHash: await hashPassword(TEST_PASSWORD) },
    select: { id: true, account: true, displayName: true },
  })
}

/**
 * 造一个项目，并把创建者写成该项目的 `PM` 成员。
 *
 * 这个副作用是**刻意复刻端点 3**（契约 I-8 端点 3：「同一事务内写入
 * ProjectMember(projectId, 当前用户, 'PM')」）。若不写成员关系，`can()` 会把
 * 创建者判成非成员，所有下游测试都要自己补一条 —— 与契约把工厂集中起来的初衷相反。
 */
export async function makeProject(
  ownerUserId: string,
  name = '测试项目',
): Promise<{ projectId: string; ownerUserId: string }> {
  const db = getActiveDatabase()
  const project = await db.project.create({
    data: {
      name,
      ownerUserId,
      members: { create: { userId: ownerUserId, role: 'PM' } },
    },
    select: { id: true },
  })
  return { projectId: project.id, ownerUserId }
}

/** 往项目里加一个成员并指定角色（默认 `MEMBER`，等价于端点 6 的效果）。 */
export async function makeMember(
  projectId: string,
  userId: string,
  role: ProjectRole = 'MEMBER',
): Promise<void> {
  await getActiveDatabase().projectMember.create({ data: { projectId, userId, role } })
}

// ---------------------------------------------------------------------------
// 二、需求层级（M4 用）
// ---------------------------------------------------------------------------

/** 取该项目内下一个可用的目标 `sortOrder`（= 现有最大值 + 1；空集合为 0）。 */
async function nextGoalSortOrder(projectId: string): Promise<number> {
  const aggregate = await getActiveDatabase().businessGoal.aggregate({
    where: { projectId },
    _max: { sortOrder: true },
  })
  const currentMax = aggregate._max.sortOrder
  return (currentMax === null ? -1 : currentMax) + 1
}

/** 取该目标下下一个可用的活动 `sortOrder`。 */
async function nextActivitySortOrder(goalId: string): Promise<number> {
  const aggregate = await getActiveDatabase().userActivity.aggregate({
    where: { goalId },
    _max: { sortOrder: true },
  })
  const currentMax = aggregate._max.sortOrder
  return (currentMax === null ? -1 : currentMax) + 1
}

/** 造一个业务目标，返回其 id。`sortOrder` 取项目内下一个序号（同端点 11）。 */
export async function makeGoal(
  projectId: string,
  name = '测试目标',
  options: { description?: string | null; status?: 'ACTIVE' | 'DONE'; sortOrder?: number } = {},
): Promise<string> {
  const goal = await getActiveDatabase().businessGoal.create({
    data: {
      projectId,
      name,
      description: options.description ?? null,
      sortOrder: options.sortOrder ?? (await nextGoalSortOrder(projectId)),
      ...(options.status === undefined ? {} : { status: options.status }),
    },
    select: { id: true },
  })
  return goal.id
}

/**
 * 造一个用户活动，返回其 id。
 *
 * `projectId` **由 `goalId` 推导**（契约 I-10）—— 因此「把活动挂到别的项目的目标下」
 * 这类脏数据在本工厂造不出来。
 */
export async function makeActivity(
  goalId: string,
  name = '测试活动',
  options: { description?: string | null; status?: 'ACTIVE' | 'DONE'; sortOrder?: number } = {},
): Promise<string> {
  const db = getActiveDatabase()
  const goal = await db.businessGoal.findUnique({
    where: { id: goalId },
    select: { projectId: true },
  })
  if (!goal) {
    throw new Error(
      `makeActivity：目标 ${goalId} 不存在，无法推导 projectId（契约 I-10：子对象的 projectId 由父级推导）`,
    )
  }

  const activity = await db.userActivity.create({
    data: {
      projectId: goal.projectId,
      goalId,
      name,
      description: options.description ?? null,
      sortOrder: options.sortOrder ?? (await nextActivitySortOrder(goalId)),
      ...(options.status === undefined ? {} : { status: options.status }),
    },
    select: { id: true },
  })
  return activity.id
}

/** `makeStory` 的可覆写字段（未给出的字段用下表默认值，或交给表默认值）。 */
export type StoryOverrides = {
  title?: string
  roleText?: string
  capabilityText?: string
  valueText?: string
  businessValue?: string
  priority?: Priority
  status?: StoryStatus
  acceptanceCriteria?: string | null
  isSensitive?: boolean
}

/**
 * 造一条用户故事，返回其 id。
 *
 * `projectId` **由 `activityId` 推导**（契约 I-10）。
 * `status` / `isSensitive` 不显式给出时**交给表默认值**（`DRAFT` / `false`），
 * 使夹具与端点 19 的副作用口径一致。
 */
export async function makeStory(activityId: string, overrides: StoryOverrides = {}): Promise<string> {
  const db = getActiveDatabase()
  const activity = await db.userActivity.findUnique({
    where: { id: activityId },
    select: { projectId: true },
  })
  if (!activity) {
    throw new Error(
      `makeStory：用户活动 ${activityId} 不存在，无法推导 projectId（契约 I-10：子对象的 projectId 由父级推导）`,
    )
  }

  const story = await db.userStory.create({
    data: {
      projectId: activity.projectId,
      activityId,
      title: overrides.title ?? '测试故事',
      roleText: overrides.roleText ?? '项目经理',
      capabilityText: overrides.capabilityText ?? '建立业务目标',
      valueText: overrides.valueText ?? '结构化梳理需求',
      businessValue: overrides.businessValue ?? '提升需求可追溯性',
      priority: overrides.priority ?? 'P0',
      acceptanceCriteria: overrides.acceptanceCriteria ?? null,
      ...(overrides.status === undefined ? {} : { status: overrides.status }),
      ...(overrides.isSensitive === undefined ? {} : { isSensitive: overrides.isSensitive }),
    },
    select: { id: true },
  })
  return story.id
}

// ---------------------------------------------------------------------------
// 三、任务（M5 用）
// ---------------------------------------------------------------------------

/** `makeTask` 的可覆写字段。全为附加项：契约签名只要求 3 个参数。 */
export type TaskOverrides = {
  title?: string
  description?: string | null
  planStart?: string
  planEnd?: string
  status?: 'TODO' | 'DOING' | 'DONE'
  isSensitive?: boolean
}

/**
 * 造一个任务，返回其 id。`projectId` **由 `storyId` 推导**（契约 I-10）。
 *
 * ⚠️ 契约原文：「`makeTask` 必须在内部满足『验收人 ≠ 负责人』约束，否则所有下游测试
 *    都要重复处理这个前置条件。」本实现选择**显式抛出**而不是偷偷替换验收人：
 *    两个 id 都由调用方给出，若它们相等，说明调用方想要一条**端点 25 会拒绝的脏数据**；
 *    此时静默换人会让调用方随后对 `acceptorUserId` 的断言落在错误的行上 ——
 *    那比一条清晰的失败危险得多。作为对策，`makeTask` 会在错误信息里说明该约束。
 *    （与 M4 自建夹具 `test-fixtures.ts` 的处置一致。）
 *
 * `planStart` / `planEnd` 缺省给合法的 `YYYY-MM-DD`（决策 I-10 固定格式，且结束 ≥ 开始）；
 * `status` / `isSensitive` 不给出时交给表默认值（`TODO` / `false`）。
 */
export async function makeTask(
  storyId: string,
  ownerUserId: string,
  acceptorUserId: string,
  options: TaskOverrides = {},
): Promise<string> {
  if (ownerUserId === acceptorUserId) {
    throw new Error(
      'makeTask：负责人与验收人不能是同一人 —— 契约「测试数据工厂」要求夹具内部满足该约束，' +
        '而端点 25/28 会以 ACCEPTOR_EQUALS_OWNER 拒绝这类数据。请传入两个不同的用户 id。',
    )
  }

  const db = getActiveDatabase()
  const story = await db.userStory.findUnique({
    where: { id: storyId },
    select: { projectId: true },
  })
  if (!story) {
    throw new Error(
      `makeTask：用户故事 ${storyId} 不存在，无法推导 projectId（契约 I-10：子对象的 projectId 由父级推导）`,
    )
  }

  const task = await db.task.create({
    data: {
      projectId: story.projectId,
      storyId,
      title: options.title ?? '测试任务',
      description: options.description ?? null,
      ownerUserId,
      acceptorUserId,
      planStart: options.planStart ?? '2026-01-01',
      planEnd: options.planEnd ?? '2026-01-02',
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(options.isSensitive === undefined ? {} : { isSensitive: options.isSensitive }),
    },
    select: { id: true },
  })
  return task.id
}

// ---------------------------------------------------------------------------
// 四、敏感可见性（M3 用）
// ---------------------------------------------------------------------------

/**
 * 把一条用户故事或一个任务**标记为敏感**，并写入可见成员白名单。
 *
 * 语义对应端点 23/30 的一次调用（`{ isSensitive: true, visibleMemberIds: userIds }`）：
 *   ① 目标对象 `isSensitive` 置 `true`；
 *   ② 为每个 `userIds` 写一条 `ObjectVisibility`。
 *
 * `projectId` **由目标对象推导** —— 因为 `ObjectVisibility.objectId` 是**多态列、
 * 没有真实外键**（契约 I-7 的特殊约定），无法靠数据库校验归属，只能在这里写对。
 * 这也正是契约要求「删除故事/任务时同事务清理可见性记录」的原因：多态列没有级联。
 *
 * ⚠️ `userIds` 传空数组时：对象被标为敏感、白名单为空 —— 即「除 PM 外无人可见」
 *    的状态，是合法且有用的（T2.6 的「未授权成员看不到」用例正需要它）。
 *
 * ⚠️ 本函数**不做项目成员校验**：`userIds` 里的人是不是本项目成员由调用方负责。
 *    端点 23 会校验（`NOT_PROJECT_MEMBER`），但那是接口层的事；夹具若也校验，
 *    就无法构造「白名单里混入项目外用户」这类反例数据。
 */
export async function makeSensitive(
  objectType: VisibilityObjectType,
  objectId: string,
  userIds: string[],
): Promise<void> {
  const db = getActiveDatabase()

  let projectId: string
  if (objectType === 'story') {
    const story = await db.userStory.findUnique({
      where: { id: objectId },
      select: { projectId: true },
    })
    if (!story) throw new Error(`makeSensitive：用户故事 ${objectId} 不存在，无法推导 projectId`)
    projectId = story.projectId
    await db.userStory.update({ where: { id: objectId }, data: { isSensitive: true } })
  } else {
    const task = await db.task.findUnique({ where: { id: objectId }, select: { projectId: true } })
    if (!task) throw new Error(`makeSensitive：任务 ${objectId} 不存在，无法推导 projectId`)
    projectId = task.projectId
    await db.task.update({ where: { id: objectId }, data: { isSensitive: true } })
  }

  if (userIds.length === 0) return

  await db.objectVisibility.createMany({
    data: userIds.map((userId) => ({ projectId, objectType, objectId, userId })),
  })
}

