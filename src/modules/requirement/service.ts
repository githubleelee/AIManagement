/**
 * 需求层级模块 —— 数据访问（M4 / US-03）
 *
 * 契约依据
 *   - 决策 I-9「模块依赖方向」：数据访问层（表与查询）所有模块都可以直接使用。
 *     本文件**只读写 Prisma 表**，不调用 M2 / M3 / M5 的任何 service，因此不会形成循环依赖。
 *   - 决策 I-10「`projectId` 的推导」：子对象的 `projectId` 一律**从父对象推导**，
 *     不接受请求体传入 —— 这从结构上消除了 `CROSS_PROJECT_REF`。
 *   - 决策 I-2：响应里的 `createdAt` 必须是 **ISO 8601 UTC 字符串**，
 *     而数据层存的是 `DateTime`（决策 I-7 数据层约定 4：序列化层必须转换）。
 *
 * 归属说明（决策 I-0）
 *   本文件是 `src/modules/requirement/` 内的新增文件，属 M4 独占，不触碰任何冻结文件。
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import type {
  BusinessGoal,
  GoalNode,
  GoalStatus,
  Priority,
  Scope,
  StoryStatus,
  UserActivity,
  UserStory,
} from '../../shared/types.js'

// ---------------------------------------------------------------------------
// 行 → 契约响应类型的映射（时间字段在此完成序列化）
// ---------------------------------------------------------------------------

/** `BusinessGoal` 表行 → 决策 I-2 的 `BusinessGoal` 类型。 */
function toBusinessGoal(row: {
  id: string
  projectId: string
  name: string
  description: string | null
  status: string
  sortOrder: number
}): BusinessGoal {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    // 枚举列在库里是 String（决策 I-0：SQLite 不支持原生 enum），
    // 取值合法性由写入前的 Zod 校验 + 表默认值共同保证。
    status: row.status as GoalStatus,
    sortOrder: row.sortOrder,
  }
}

/** `UserActivity` 表行 → 决策 I-2 的 `UserActivity` 类型。
 *
 * 刻意**不导出**：T3.1 的代码审查指出「已导出但无人调用的函数属于可被误用的危险 API」
 * （表五序号 44 登记的 E9 类隐患）。本模块的测试全部走 HTTP seam，不需要它，
 * 因此保持模块私有，等真有第二个调用方时再决定是否导出。
 */
function toUserActivity(row: {
  id: string
  projectId: string
  goalId: string
  name: string
  description: string | null
  status: string
  sortOrder: number
}): UserActivity {
  return {
    id: row.id,
    projectId: row.projectId,
    goalId: row.goalId,
    name: row.name,
    description: row.description,
    // 枚举列在库里是 String（决策 I-0：SQLite 不支持原生 enum），
    // 取值合法性由写入前的 Zod 校验 + 表默认值共同保证。
    status: row.status as GoalStatus,
    sortOrder: row.sortOrder,
  }
}

/** `UserStory` 表行 → 决策 I-2 的 `UserStory` 类型；`createdAt` 转 ISO 8601 UTC。 */
export function toUserStory(row: {
  id: string
  projectId: string
  activityId: string
  title: string
  roleText: string
  capabilityText: string
  valueText: string
  businessValue: string
  priority: string
  status: string
  acceptanceCriteria: string | null
  isSensitive: boolean
  createdAt: Date
}): UserStory {
  return {
    id: row.id,
    projectId: row.projectId,
    activityId: row.activityId,
    title: row.title,
    roleText: row.roleText,
    capabilityText: row.capabilityText,
    valueText: row.valueText,
    businessValue: row.businessValue,
    priority: row.priority as Priority,
    status: row.status as StoryStatus,
    acceptanceCriteria: row.acceptanceCriteria,
    isSensitive: row.isSensitive,
    createdAt: row.createdAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// 端点 11 —— 创建业务目标
//
// 【关于 sortOrder 的口径，单一定义处】
//   计算逻辑现在**内联在 `createBusinessGoal` 的事务里**，不再单独导出函数。
//   原先导出过一个 `nextGoalSortOrder(prisma, projectId)`，但因为「读最大值」必须与
//   「写入」同事务，任何独立的公开函数都会**诱使调用方在事务外使用它**从而重新引入竞态，
//   故刻意不再提供该函数（死代码 + 危险 API）。
//
//   sortOrder 的取值口径（两处实现的唯一权威描述）：
//     - 项目内现有最大值 + 1；
//     - **空集合把最大值视作 -1**，于是首条目标得到 0。
//       依据：端点 14 规定「第 i 个 id 的 sortOrder 置为 i」，即排序是**从 0 开始的下标**；
//       两条规则必须同源，否则排序后 sortOrder 集合会突变。
//     - 注意 `aggregate` 在空集合上返回 `_max.sortOrder === null`（不是 0），
//       必须用 `=== null` 显式判断，写成 `?? 0` 会让首条目标从 1 开始。
//
//   测试夹具 `test-fixtures.ts` 的 `nextGoalSortOrderInDb` 是**第二份**同口径实现，
//   它只用于造数据、不参与生产路径，恰好可作为交叉验证。
// ---------------------------------------------------------------------------

/**
 * 创建业务目标。
 *
 * 职责边界：本函数**只做数据写入**，不查项目是否存在、不做权限判定
 * （那两件事属于 handler + `can()`）。参数 `projectId` 由调用方**从 URL 父级推导**后传入，
 * 绝不来自请求体（决策 I-10）。
 *
 * ---------------------------------------------------------------------------
 * 【并发修复】为什么必须放在同一个事务里
 *
 * 原实现是两次独立查询：先 `aggregate` 读最大值，再 `create` 写入。两者之间没有任何
 * 保护，并发请求会**读到同一个最大值**从而算出相同的 `sortOrder`。
 * 独立检测实测（T3.1 对抗测试「对抗 6」）：并发 5 条 → `[0,0,1,1,1]`；
 * 并发 8 条 → `[0,0,0,0,0,1,1,1]`；而串行创建 8 条是严格正确的 `[0..7]`。
 *
 * 这违反决策 I-8 端点 11 的「sortOrder = 当前项目内最大值 + 1」，
 * 更要紧的是违反基线 AC-US-03-01 的「排序为末位」——序号重复时「末位」不再有定义。
 *
 * 修法：把「读」与「写」纳入**同一个 `$transaction`**。SQLite 是单写者模型，
 * 事务期间持有写锁，于是并发事务被串行化：第 N 个事务在 BEGIN 之后才读到
 * 前 N-1 个事务**已提交**的最大值。这不是应用层的读-改-写，而是把该不变量
 * 交给数据库的隔离性保证。
 *
 * 为什么不加 `@@unique([projectId, sortOrder])` 兜底：
 *   端点 14 的语义是「全量替换顺序：第 i 个 id 的 sortOrder 置为 i」，
 *   全量替换的**中间态**天然会出现重复序号（把 [A,B] 换成 [B,A] 时，
 *   置 A:=1 于 B 尚为 1 之时）。唯一约束会拒绝这个合法中间态，
 *   反而使排序功能不可实现。故本不变量只能靠事务，不能靠约束。
 *   （该选型权衡由代码审查智能体独立提出，与检测结论一致。）
 *
 * 残余边界（已记入表五，留 Sprint 2 评估）：本修法未引入重试。
 *   若将来换成 Postgres（其默认 READ COMMITTED 下两个事务可并发读到同一最大值），
 *   单靠事务不再充分，届时需要 `SELECT ... FOR UPDATE` 或加唯一约束 + 冲突重试。
 *   Sprint 1 用 SQLite，写锁串行化已经足够。
 * ---------------------------------------------------------------------------
 */
export async function createBusinessGoal(
  prisma: PrismaClient,
  projectId: string,
  input: { name: string; description?: string },
): Promise<BusinessGoal> {
  // 读最大值与写入必须在同一事务内完成：见上方「并发修复」
  const row = await prisma.$transaction(async (tx) => {
    const aggregate = await tx.businessGoal.aggregate({
      where: { projectId },
      _max: { sortOrder: true },
    })
    const currentMax = aggregate._max.sortOrder
    const sortOrder = (currentMax === null ? -1 : currentMax) + 1

    return tx.businessGoal.create({
      data: {
        projectId,
        name: input.name,
        // 可选字段：未提供时置 null（契约 I-2 中 description 的类型是 `string | null`）。
        description: input.description ?? null,
        // status 不显式写入，依赖表默认值 'ACTIVE'（决策 I-7：@default("ACTIVE")）。
        // 这样端点 11 的「status 默认 'ACTIVE'」与数据层默认值只有一处真相。
        sortOrder,
      },
      select: {
        id: true,
        projectId: true,
        name: true,
        description: true,
        status: true,
        sortOrder: true,
      },
    })
  })

  return toBusinessGoal(row)
}

// ---------------------------------------------------------------------------
// 端点 15 —— 创建用户活动
//
// 【sortOrder 的口径，单一定义处】
//   与端点 11 **同源但作用域不同**：
//     - 端点 11 的作用域是「项目内所有目标」；
//     - 端点 15 的作用域是「**该目标下的所有活动**」（契约 I-8 端点 15 原文：
//       「sortOrder = 该目标下最大值 + 1」）。
//   空集合把最大值视作 -1，于是某目标下的第一条活动得到 0。依据同端点 11：
//   端点 18 规定「第 i 个 id 的 sortOrder 置为 i」，即排序是从 0 开始的下标，
//   两条规则必须同源，否则排序后 sortOrder 集合会突变。
//   注意 `aggregate` 在空集合上返回 `_max.sortOrder === null`（不是 0），
//   必须用 `=== null` 显式判断，写成 `?? 0` 会让第一条活动从 1 开始。
//
//   与端点 11 一样，计算逻辑**内联在事务里**、不单独导出函数：任何独立的公开
//   函数都会诱使调用方在事务外使用它，从而重新引入竞态。
// ---------------------------------------------------------------------------

/**
 * 创建用户活动。
 *
 * 职责边界：本函数**只做数据写入**，不查目标是否存在、不做权限判定
 * （那两件事属于 handler + `can()`）。
 *
 * 参数口径：`goalId` 是 URL 父级；`projectId` **必须由调用方从 `goalId` 所属目标
 * 推导**后传入，绝不来自请求体（决策 I-10「`projectId` 的推导」，基线 AC-US-03-02
 * 「必须在某业务目标下创建；不允许无归属的用户活动」）。把它做成显式参数而不是在
 * 函数内再查一次目标，是为了让「归属只能来自父级」这条规则在**签名上可见** ——
 * 数据层不知道「请求体」的存在，所以它无从被污染。
 *
 * ---------------------------------------------------------------------------
 * 【并发】为什么必须放在同一个事务里（同端点 11 的 B1 缺陷）
 *
 * 「读该目标下的最大值」与「插入」若是两次独立查询，并发请求会**读到同一个最大值**，
 * 从而算出相同的 `sortOrder`。T3.1 实测过该竞态的形态：并发 5 条 → `[0,0,1,1,1]`、
 * 并发 8 条 → `[0,0,0,0,0,1,1,1]`，而串行 8 条严格为 `[0..7]`。
 * 端点 15 的契约同样是「最大值 + 1」，因此同样必须纳入单个 `$transaction`，
 * 依赖 SQLite 单写者模型的写锁把并发事务串行化。
 *
 * 同样**不加** `@@unique([goalId, sortOrder])` 兜底：端点 18 的全量替换存在
 * **合法中间态**（把 [A,B] 换成 [B,A] 时置 A:=1 于 B 尚为 1 之时），唯一约束会拒绝
 * 该中间态而使排序功能不可实现。
 *
 * 残余边界（同表五序号 42 记录的端点 11 结论）：本修法依赖 SQLite 单写者模型。
 * 若将来换成 Postgres（默认 READ COMMITTED），两个事务仍可能读到同一最大值，
 * 届时需要 `SELECT ... FOR UPDATE` 或唯一约束 + 冲突重试。
 * ---------------------------------------------------------------------------
 */
export async function createUserActivity(
  prisma: PrismaClient,
  goalId: string,
  projectId: string,
  input: { name: string; description?: string },
): Promise<UserActivity> {
  // 读最大值与写入必须在同一事务内完成：见上方「并发」
  const row = await prisma.$transaction(async (tx) => {
    const aggregate = await tx.userActivity.aggregate({
      where: { goalId },
      _max: { sortOrder: true },
    })
    const currentMax = aggregate._max.sortOrder
    const sortOrder = (currentMax === null ? -1 : currentMax) + 1

    return tx.userActivity.create({
      data: {
        goalId,
        projectId,
        name: input.name,
        // 可选字段：未提供时置 null（契约 I-2 中 description 的类型是 `string | null`）。
        description: input.description ?? null,
        // status 不显式写入，依赖表默认值 'ACTIVE'（决策 I-7：@default("ACTIVE")）。
        // 这样端点 15 的「status 默认 'ACTIVE'」与数据层默认值只有一处真相。
        sortOrder,
      },
      select: {
        id: true,
        projectId: true,
        goalId: true,
        name: true,
        description: true,
        status: true,
        sortOrder: true,
      },
    })
  })

  return toUserActivity(row)
}

// ---------------------------------------------------------------------------
// 端点 12 —— 更新业务目标（部分更新）
// ---------------------------------------------------------------------------

/**
 * 端点 12 可修改字段的**白名单**。
 *
 * `projectId`（决策 I-10：子对象归属只能从父级推导）与 `sortOrder`
 * （决策 I-10：排序只能走端点 14 的全量替换）都**刻意不在其中** ——
 * 用类型白名单而不是靠 handler 手工挑字段，可以让「本端点改不了归属与排序」
 * 这条约束在编译器层面成立。
 */
export type BusinessGoalPatch = {
  name?: string
  description?: string
  status?: GoalStatus
}

/**
 * 端点 12 的返回列集合。
 *
 * 与 `createBusinessGoal` 里的 `select` 内容相同（契约 I-2 的 BusinessGoal 共 6 字段）。
 * **刻意不去抽公共常量复用**：端点 11 的实现已通过 79 例对抗测试与只读代码审查，
 * 为一个 6 字段的字面量去动它，会让 T3.2 的差异扩散到已验收的 T3.1 代码上，
 * 得不偿失。等 T3.x 全部落地后再统一收敛。
 */
const BUSINESS_GOAL_FIELDS = {
  id: true,
  projectId: true,
  name: true,
  description: true,
  status: true,
  sortOrder: true,
} as const

/**
 * 更新业务目标（端点 12）。
 *
 * 职责边界同端点 11/15：**只做数据写入**，不查目标是否存在、不做权限判定
 * （那两件事属于 handler + `can()`）。
 *
 * ---------------------------------------------------------------------------
 * 【为什么这里不需要事务】—— 与端点 11/15 的 sortOrder 竞态不同
 *
 * 端点 11/15 必须包事务，是因为它们要「读最大值 → 写新行」，属读-改-写。
 * 端点 12 只写**请求体明确给出的字段**，新值不依赖任何读取结果，
 * 因此单条 `UPDATE` 本身就是原子的，包事务只是徒增开销。
 * 且 `sortOrder` 不在可改字段白名单内，本端点**根本不触碰**那个不变量，
 * 也就不存在与端点 11/15/14 的竞态。
 *
 * ---------------------------------------------------------------------------
 * 【部分更新语义怎么实现才是对的】（决策 I-10）
 *
 * 只把请求体中**出现**的字段放进 `data`，而不是「先读出旧行、在内存里合并、
 * 再整行写回」。后者会引入读-改-写窗口：两个并发 PATCH 各改一个字段时，
 * 后写者会拿自己读到的旧值把前者的改动覆盖掉（经典的丢失更新）。
 * 只提交被改字段，则两次并发 PATCH 各写各的列，互不干扰。
 *
 * 契约 I-10 的「校验以合并后的结果为准」在本端点**无事可做**：端点 12 的校验
 * 全是单字段形状校验，没有跨字段规则。那条规则是为端点 28 的
 * `acceptor !== owner` 写的（只改一个字段也要拿另一个字段的现值比较）。
 * 此点显式写明，以免代码审查把它误判成漏实现。
 *
 * ---------------------------------------------------------------------------
 * 【空补丁】请求体为 `{}`（或只含被剥除的未知字段）时，本函数**不执行写操作**，
 * 改为读一次并原样返回。契约未定义该情形的状态码，本实现取「200 + 资源不变」：
 * 部分更新的字面语义就是「没提到的字段保持不变」，全都没提到即什么都没变。
 * 为什么不直接 `update({ data: {} })`：Prisma 对空 `data` 的行为属未定义区域，
 * 依赖它不如显式分支 —— 行为可预期，也便于测试钉住。
 * ---------------------------------------------------------------------------
 */
export async function updateBusinessGoal(
  prisma: PrismaClient,
  goalId: string,
  patch: BusinessGoalPatch,
): Promise<BusinessGoal | null> {
  // 只提交请求体明确给出的字段（见上方「部分更新语义」）
  const data: Prisma.BusinessGoalUpdateInput = {
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(patch.description === undefined ? {} : { description: patch.description }),
    ...(patch.status === undefined ? {} : { status: patch.status }),
  }

  // 补丁为空 → 不写，只读（见上方「空补丁」）
  const row =
    Object.keys(data).length === 0
      ? await prisma.businessGoal.findUnique({ where: { id: goalId }, select: BUSINESS_GOAL_FIELDS })
      : await prisma.businessGoal.update({ where: { id: goalId }, data, select: BUSINESS_GOAL_FIELDS })

  // 返回 `null` 只可能来自 TOCTOU：`can()` 已确认目标存在，但从它查到本行之间
  // 目标可能被删除（端点 13 属 T3.9，实现后这个窗口才真正可达）。
  // 交给 handler 转 404，而不是让 Prisma 抛 P2025 变成 500 ——
  // 后者会把「对象已不存在」误报成「服务端故障」。
  // 本函数刻意**不抛 AppError**：AppError 属 HTTP 层，数据访问层只返回数据。
  return row ? toBusinessGoal(row) : null
}

// ---------------------------------------------------------------------------
// 端点 16 —— 更新用户活动（部分更新）
// ---------------------------------------------------------------------------

/**
 * 端点 16 可修改字段的**白名单**。
 *
 * `goalId`（父级归属）与 `projectId`（从父级推导，决策 I-10）都不在其中；
 * `sortOrder` 也不在其中 —— 活动排序只能走端点 18 的全量替换（决策 I-10）。
 * 与 `BusinessGoalPatch` 同理：用类型白名单让「本端点改不了归属与排序」在编译器层面成立。
 */
export type UserActivityPatch = {
  name?: string
  description?: string
  status?: GoalStatus
}

/**
 * 端点 16 的返回列集合（契约 I-2 的 UserActivity 共 7 字段，无 createdAt）。
 * 同 `BUSINESS_GOAL_FIELDS`：刻意不抽公共常量，避免把 T3.5 的差异扩散到已验收的端点。
 */
const USER_ACTIVITY_FIELDS = {
  id: true,
  projectId: true,
  goalId: true,
  name: true,
  description: true,
  status: true,
  sortOrder: true,
} as const

/**
 * 更新用户活动（端点 16）。
 *
 * 职责边界、部分更新语义、空补丁处理、以及「为什么不需要事务」的推理
 * **与端点 12 完全同型**（见 `updateBusinessGoal` 的注释），此处不重复展开，
 * 只说明两处**不同**点：
 *
 *   1. 返回类型是 `UserActivity`（7 字段），比 `BusinessGoal` 多 `goalId`、少 `createdAt`；
 *   2. 返回 `null` 的 TOCTOU 窗口来自端点 17（删除活动，属 T3.9），而不是端点 13。
 */
export async function updateUserActivity(
  prisma: PrismaClient,
  activityId: string,
  patch: UserActivityPatch,
): Promise<UserActivity | null> {
  // 只提交请求体明确给出的字段（避免读-改-写窗口造成的丢失更新）
  const data: Prisma.UserActivityUpdateInput = {
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(patch.description === undefined ? {} : { description: patch.description }),
    ...(patch.status === undefined ? {} : { status: patch.status }),
  }

  // 补丁为空 → 不写，只读（同端点 12）
  const row =
    Object.keys(data).length === 0
      ? await prisma.userActivity.findUnique({ where: { id: activityId }, select: USER_ACTIVITY_FIELDS })
      : await prisma.userActivity.update({
          where: { id: activityId },
          data,
          select: USER_ACTIVITY_FIELDS,
        })

  return row ? toUserActivity(row) : null
}

// ---------------------------------------------------------------------------
// 端点 18 —— 用户活动排序（全量替换）
// ---------------------------------------------------------------------------

/**
 * 端点 18 的结果类型。
 *
 * 用**可判别联合**而不是直接抛异常：集合不一致属**客户端输入错误**（要转 422），
 * 不是服务端故障；而 `AppError` 属 HTTP 层，数据访问层不该知道状态码。
 * 于是 service 只报告「发生了什么」，由 handler 决定「回什么码」——
 * 与端点 12 用 `null` 表示「目标已不存在」是同一个设计取向。
 */
export type ReorderActivitiesResult =
  | { ok: true; activities: UserActivity[] }
  | { ok: false; reason: 'SET_MISMATCH' }

/**
 * 判断请求的 id 序列与库内现有 id 集合是否**完全一致**。
 *
 * 契约 I-8 端点 14（端点 18 沿用）：集合与本项目/本目标现有集合不一致 → 422。
 * 三条判据合起来才充分：
 *   - 长度相同、且请求序列内部**无重复**（有重复则长度相同也会漏掉某个 id）；
 *   - 库内每个 id 都出现在请求里（配合长度相同 ⇒ 两集合相等）。
 */
function isSameIdSet(existingIds: string[], requestedIds: string[]): boolean {
  if (requestedIds.length !== existingIds.length) return false
  const requested = new Set(requestedIds)
  if (requested.size !== requestedIds.length) return false
  return existingIds.every((id) => requested.has(id))
}

/**
 * 全量替换某目标下用户活动的顺序（端点 18）。
 *
 * 语义（契约 I-8 端点 18「同端点 14」，范围限定在该目标下）：
 *   第 i 个 id 的 `sortOrder` 置为 i；幂等，可重复调用。
 *
 * ---------------------------------------------------------------------------
 * 【为什么整个操作必须在同一个事务里】—— 这是端点 12/16 所没有的
 *
 * 本操作是**读-改-写**：先读出现有活动集合用于一致性校验，再逐条改 `sortOrder`。
 * 若读与写分成两次独立访问，会出现两类问题：
 *   ① 校验通过之后、写入之前，集合被端点 15 改变（新增/删除了活动），
 *      于是「校验时成立的集合」与「写入时实际的集合」不一致 —— 写完后序号不再连续；
 *   ② 逐条 update 若中途失败，会留下**半应用的顺序**（一部分新序号、一部分旧序号），
 *      而排序功能最忌讳的就是这种静默的中间态。
 * 放进单个 `$transaction` 后，SQLite 单写者模型的写锁把并发事务串行化，
 * 且整体要么全成、要么全不成。
 *
 * 【为什么不加唯一约束兜底】同端点 11/15 的结论（表五序号 42）：
 * 全量替换**必然经过合法中间态** —— 把 [A,B] 换成 [B,A] 时，置 A:=1 的那一刻 B 仍为 1。
 * `@@unique([goalId, sortOrder])` 会拒绝这个中间态，使排序根本无法实现。
 * 所以序号唯一性这条不变量只能由事务保证，不能由约束保证。
 *
 * 【集合不一致时不写入任何东西】校验在写入之前、且在同一事务内完成，
 * 返回 `SET_MISMATCH` 时事务内没有任何写操作，因此失败请求零副作用。
 * ---------------------------------------------------------------------------
 */
export async function reorderUserActivities(
  prisma: PrismaClient,
  goalId: string,
  orderedIds: string[],
): Promise<ReorderActivitiesResult> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.userActivity.findMany({
      where: { goalId },
      select: { id: true },
    })
    const existingIds = existing.map((row) => row.id)

    if (!isSameIdSet(existingIds, orderedIds)) {
      return { ok: false, reason: 'SET_MISMATCH' } as const
    }

    // 用 `entries()` 而不是 `orderedIds[i]`：后者在 noUncheckedIndexedAccess 下
    // 类型是 `string | undefined`，会诱使写出非空断言；`entries()` 直接给 `string`。
    for (const [index, activityId] of orderedIds.entries()) {
      await tx.userActivity.update({
        where: { id: activityId },
        data: { sortOrder: index },
      })
    }

    // 响应按新序号升序返回（端点 10 的层级树同样按 sortOrder 升序）
    const rows = await tx.userActivity.findMany({
      where: { goalId },
      orderBy: { sortOrder: 'asc' },
      select: USER_ACTIVITY_FIELDS,
    })

    return { ok: true, activities: rows.map(toUserActivity) } as const
  })
}

// ---------------------------------------------------------------------------
// 端点 14 —— 业务目标排序（全量替换）
//
// 【本节为什么写在端点 18 之后】本文件按**任务顺序**追加（T3.1 → T3.2 → T3.5 → T3.3），
// 不按端点号排序，这样每次任务只往文件末尾追加，diff 干净、历史可追溯。
// 本节的实现与端点 18 **同型**（同一套 `isSameIdSet` 判据、同样的单事务包裹），
// 差别只有两处：作用域是「项目内所有目标」而非「目标下所有活动」；
// 返回类型是 `BusinessGoal` 而非 `UserActivity`。
// ---------------------------------------------------------------------------

/**
 * 端点 14 的结果类型。设计取向同 `ReorderActivitiesResult`：
 * service 只报告「发生了什么」，由 handler 决定「回什么码」。
 */
export type ReorderGoalsResult =
  | { ok: true; goals: BusinessGoal[] }
  | { ok: false; reason: 'SET_MISMATCH' }

/**
 * 全量替换某项目内业务目标的顺序（端点 14）。
 *
 * 语义（契约 I-8 端点 14）：第 i 个 id 的 `sortOrder` 置为 i；幂等，可重复调用。
 *
 * 【为什么整段包在同一个事务里】理由与端点 18 完全相同，此处不重复展开：
 * 这是「读出现有集合作一致性校验 → 批量写序号」的读-改-写，分两次独立访问会出现
 * ① 校验通过后集合被端点 11 改变，② 逐条 update 中途失败留下半应用的顺序。
 *
 * 【为什么不加唯一约束兜底】契约 I-8 端点 14 的全量替换存在**合法中间态**：
 * 把 [A,B] 换成 [B,A] 时，置 A:=1 的那一刻 B 仍为 1。`@@unique([projectId, sortOrder])`
 * 会拒绝这个中间态，使排序功能根本无法实现。这条结论由代码审查智能体独立提出、
 * 被 T3.1 的并发修复采纳，记录在表五序号 42。序号唯一性只能由事务保证。
 * ---------------------------------------------------------------------------
 */
export async function reorderBusinessGoals(
  prisma: PrismaClient,
  projectId: string,
  orderedIds: string[],
): Promise<ReorderGoalsResult> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.businessGoal.findMany({
      where: { projectId },
      select: { id: true },
    })
    const existingIds = existing.map((row) => row.id)

    if (!isSameIdSet(existingIds, orderedIds)) {
      return { ok: false, reason: 'SET_MISMATCH' } as const
    }

    for (const [index, goalId] of orderedIds.entries()) {
      await tx.businessGoal.update({
        where: { id: goalId },
        data: { sortOrder: index },
      })
    }

    const rows = await tx.businessGoal.findMany({
      where: { projectId },
      orderBy: { sortOrder: 'asc' },
      select: BUSINESS_GOAL_FIELDS,
    })

    return { ok: true, goals: rows.map(toBusinessGoal) } as const
  })
}

// ---------------------------------------------------------------------------
// 端点 13 / 17 / 22 —— 删除与 HAS_CHILDREN
//
// 【为什么这三个删除端点不需要应用层判断子项】
//   契约 I-8 端点 13 的说明写着：「由外键 RESTRICT 保证，不依赖应用层判断」。
//   决策 I-7 为 UserActivity.goalId / UserStory.activityId / Task.storyId 都设了
//   `onDelete: Restrict`，因此删除仍有子项的行时，数据库会直接拒绝（Prisma 抛 P2003）。
//   这是**比应用层 count() 更可靠**的实现方式：它不依赖本模块的代码正确性，
//   也不存在「先查后删」之间的竞态窗口（查到没有子项、删之前别人插入了一个子项）。
//
//   顺带说明：`hasChildren` 这类判断若用「先 count 再 delete」实现，就又是一次
//   读-改-写竞态 —— 与本模块 T3.1 的 sortOrder 竞态同型，只是后果从「序号重复」
//   变成「误删有子项的节点」。下沉到数据库层后该窗口不存在。
// ---------------------------------------------------------------------------

/** 删除类端点（13/17/22）的结果。设计取向同其他 service：只报告发生了什么。 */
export type DeleteResult = { ok: true } | { ok: false; reason: 'HAS_CHILDREN' | 'NOT_FOUND' }

/**
 * 读出 Prisma 的**已知错误码**（形如 `P2003`），非 Prisma 错误返回 `null`。
 *
 * 用鸭子类型而不是 `instanceof Prisma.PrismaClientKnownRequestError`：本文件对
 * `@prisma/client` 只做 `import type`，引入运行时导入会让数据访问层与 Prisma 的
 * 运行时类耦合（也让 mock 变难）。正则 `/^P\d{4}$/` 保证只认 Prisma 的码形状，
 * 不会把恰好带 `code` 字段的其它错误误判成外键失败。
 */
function prismaErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const code: unknown = (error as { code?: unknown }).code
  return typeof code === 'string' && /^P\d{4}$/.test(code) ? code : null
}

/**
 * 把删除失败的异常翻译成 `DeleteResult`。
 *
 * - `P2003`（外键约束失败）→ `HAS_CHILDREN`：目标行仍被下级引用（决策 I-7 的 RESTRICT）；
 * - `P2025`（待操作记录不存在）→ `NOT_FOUND`：`can()` 之后、删除之前被别人删掉了；
 * - 其它异常**原样抛出**：本函数只解释它能解释的两种情况，其余交给统一错误处理器
 *   转 500。把不认识的情况也吞成 409/404 会掩盖真实缺陷 —— 那是比崩溃更糟的事。
 */
function classifyDeleteFailure(error: unknown): DeleteResult {
  const code = prismaErrorCode(error)
  if (code === 'P2003') return { ok: false, reason: 'HAS_CHILDREN' }
  if (code === 'P2025') return { ok: false, reason: 'NOT_FOUND' }
  throw error
}

/** 删除业务目标（端点 13）。有用户活动时由外键 RESTRICT 拒绝 → `HAS_CHILDREN`。 */
export async function deleteBusinessGoal(prisma: PrismaClient, goalId: string): Promise<DeleteResult> {
  try {
    // 单条 DELETE，无需事务：要么删掉、要么被外键拒绝，不存在中间态。
    await prisma.businessGoal.delete({ where: { id: goalId } })
    return { ok: true }
  } catch (error) {
    return classifyDeleteFailure(error)
  }
}

/** 删除用户活动（端点 17）。有用户故事时由外键 RESTRICT 拒绝 → `HAS_CHILDREN`。 */
export async function deleteUserActivity(
  prisma: PrismaClient,
  activityId: string,
): Promise<DeleteResult> {
  try {
    await prisma.userActivity.delete({ where: { id: activityId } })
    return { ok: true }
  } catch (error) {
    return classifyDeleteFailure(error)
  }
}

/**
 * 删除用户故事（端点 22）。有任务时由外键 RESTRICT 拒绝 → `HAS_CHILDREN`。
 *
 * ---------------------------------------------------------------------------
 * 【为什么这个删除必须包事务，而端点 13/17 不用】
 *
 * 决策 I-7 的「`ObjectVisibility` 的特殊约定」：`objectId` 是**多态列、无法建立真实外键**，
 * 数据库不会替你清理。因此删除故事时必须由本模块**在同一事务内**手动清理
 * `ObjectVisibility(objectType='story', objectId=storyId)`。这是全文档唯一需要人工
 * 保证的引用完整性。
 *
 * 两件事必须同成同败：
 *   - 若删了故事却没清可见性 → 留下**悬挂记录**。它不会报错，只会在将来某个
 *     恰好复用了同一 id 的对象上造成错误的可见性判定（静默损坏，最难查的一类）；
 *   - 若清了可见性却没能删故事（例如故事仍有任务，DELETE 抛 P2003）→ 故事的可见
 *     名单被清空，等于**擅自修改了敏感配置**。
 * 包在同一个 `$transaction` 里后，第二种情况自动成立：DELETE 抛 P2003 → 整体回滚，
 * 可见性记录一条都不会少。测试里对此有专门用例（409 之后可见性记录逐行不变）。
 *
 * 注意 delete 放在 deleteMany 之前：故事删不掉时就短路，连碰都不碰 ObjectVisibility。
 * ---------------------------------------------------------------------------
 */
export async function deleteUserStory(prisma: PrismaClient, storyId: string): Promise<DeleteResult> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.userStory.delete({ where: { id: storyId } })
      await tx.objectVisibility.deleteMany({
        where: { objectType: 'story', objectId: storyId },
      })
    })
    return { ok: true }
  } catch (error) {
    return classifyDeleteFailure(error)
  }
}

// ---------------------------------------------------------------------------
// 端点 19 —— 创建用户故事
//
// 端点 20 —— 读取用户故事（GET /stories/:storyId）
// 端点 21 —— 更新用户故事（部分更新）
//
// 这三个端点共用 `USER_STORY_FIELDS` 与 `toUserStory`（后者在 T3.1 就已写好，
// 当时没有调用方，还被审查智能体作为 E9 类隐患登记过「已导出但无人调用的危险 API」——
// 现在端点 19/20/21 三个调用方到位，该隐患自然消除，`toUserStory` 从「可疑导出」
// 变成「三处共用的映射函数」）。
// ---------------------------------------------------------------------------

/**
 * 用户故事的返回列集合（契约 I-2 的 UserStory 共 13 字段，含 createdAt 与 isSensitive）。
 *
 * 与 `BUSINESS_GOAL_FIELDS` / `USER_ACTIVITY_FIELDS` 同理：独立常量、不抽公共工具，
 * 避免把本任务的差异扩散到已验收的端点。
 */
const USER_STORY_FIELDS = {
  id: true,
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
  createdAt: true,
} as const

/**
 * 创建用户故事（端点 19）。
 *
 * 职责边界同其他 service：只做数据写入，不查活动是否存在、不做权限判定。
 * `projectId` 必须由调用方**从 `activityId` 所属活动推导**后传入（决策 I-10）。
 *
 * ---------------------------------------------------------------------------
 * 【为什么这里不需要事务】—— 与端点 11/15/18/14 都不同
 *
 * `UserStory` 表**没有 `sortOrder` 列**：契约 I-10 规定「用户故事与任务使用固定字段
 * 排序（`createdAt` / `planStart`），不提供手工排序」。因此创建故事时**没有任何
 * 需要读现有行才能算出的值** —— 不存在「读-改-写」，也就没有序号竞态。
 * `createdAt` 由数据库 `@default(now())` 生成，`status` / `isSensitive` 由表默认值决定。
 * 单条 `INSERT` 本身就是原子的，包事务只是徒增开销。
 *
 * 反过来说：若将来给故事加了手工排序字段，这里就必须补事务 —— 判据是
 * 「新值是否依赖读取结果」，而不是「是不是创建操作」。
 * ---------------------------------------------------------------------------
 */
export async function createUserStory(
  prisma: PrismaClient,
  activityId: string,
  projectId: string,
  input: {
    title: string
    roleText: string
    capabilityText: string
    valueText: string
    businessValue: string
    priority: Priority
    acceptanceCriteria?: string
  },
): Promise<UserStory> {
  const row = await prisma.userStory.create({
    data: {
      activityId,
      projectId,
      title: input.title,
      roleText: input.roleText,
      capabilityText: input.capabilityText,
      valueText: input.valueText,
      businessValue: input.businessValue,
      priority: input.priority,
      // 可选字段：未提供时置 null（契约 I-2 中 acceptanceCriteria 的类型是 `string | null`）
      acceptanceCriteria: input.acceptanceCriteria ?? null,
      // status / isSensitive 不显式写入，依赖表默认值（决策 I-7：'DRAFT' / false）。
      // 这样端点 19 的「status 默认 'DRAFT'；isSensitive 默认 false」与数据层默认值
      // 只有一处真相。也正因如此，端点 23 未实现前不存在「从创建接口偷偷标敏感」的路径。
    },
    select: USER_STORY_FIELDS,
  })

  return toUserStory(row)
}

/**
 * 读取用户故事（端点 20）。
 *
 * 返回 `null` 表示不存在，由 handler 转 404 —— 与「敏感且未授权」「非项目成员」
 * 的 404 共用同一文案，三者不可区分（契约 I-8 端点 20 明写「三者响应一致」）。
 */
export async function getUserStory(prisma: PrismaClient, storyId: string): Promise<UserStory | null> {
  const row = await prisma.userStory.findUnique({
    where: { id: storyId },
    select: USER_STORY_FIELDS,
  })
  return row ? toUserStory(row) : null
}

/**
 * 端点 21 可修改字段的**白名单**。
 *
 * ⚠️ **不含 `isSensitive`** —— 契约 I-8 端点 21 明写「该字段只能通过端点 23 修改」。
 * 用类型白名单而不是靠 handler 手工挑字段，让这条约束在编译器层面成立：
 * 任何人都无法在端点 21 里写出 `{ isSensitive: ... }` 而不被 tsc 拦住。
 *
 * 同样不含 `projectId` / `activityId`（归属只能从父级推导，决策 I-10）与 `createdAt`
 * （服务端生成，决策 I-10）。
 */
export type UserStoryPatch = {
  title?: string
  roleText?: string
  capabilityText?: string
  valueText?: string
  businessValue?: string
  priority?: Priority
  status?: StoryStatus
  acceptanceCriteria?: string
}

/**
 * 更新用户故事（端点 21，部分更新）。
 *
 * 实现与端点 12/16 **完全同型**（只提交请求体出现的字段、空补丁走只读分支、
 * 返回 `null` 表示目标已不存在），此处不重复展开理由，只说明差异：
 *   - 可改字段从 3 个变成 8 个，其中 `status` 是 **`StoryStatus`**（DRAFT/PLANNING/DONE）
 *     而不是 `GoalStatus`（决策 I-1 的三 DONE 陷阱）；
 *   - 不含 `isSensitive`（见 `UserStoryPatch`）。
 */
export async function updateUserStory(
  prisma: PrismaClient,
  storyId: string,
  patch: UserStoryPatch,
): Promise<UserStory | null> {
  // 只提交请求体明确给出的字段（避免读-改-写窗口造成的丢失更新）
  const data: Prisma.UserStoryUpdateInput = {
    ...(patch.title === undefined ? {} : { title: patch.title }),
    ...(patch.roleText === undefined ? {} : { roleText: patch.roleText }),
    ...(patch.capabilityText === undefined ? {} : { capabilityText: patch.capabilityText }),
    ...(patch.valueText === undefined ? {} : { valueText: patch.valueText }),
    ...(patch.businessValue === undefined ? {} : { businessValue: patch.businessValue }),
    ...(patch.priority === undefined ? {} : { priority: patch.priority }),
    ...(patch.status === undefined ? {} : { status: patch.status }),
    ...(patch.acceptanceCriteria === undefined ? {} : { acceptanceCriteria: patch.acceptanceCriteria }),
  }

  // 补丁为空 → 不写，只读（同端点 12/16）
  const row =
    Object.keys(data).length === 0
      ? await prisma.userStory.findUnique({ where: { id: storyId }, select: USER_STORY_FIELDS })
      : await prisma.userStory.update({ where: { id: storyId }, data, select: USER_STORY_FIELDS })

  return row ? toUserStory(row) : null
}

// ---------------------------------------------------------------------------
// 端点 10 —— 需求层级树（GET /projects/:projectId/goals）
//
// 契约 I-8 端点 10：
//   响应 200 ListResponse<GoalNode>；goals 按 sortOrder 升序、activities 按 sortOrder 升序、
//   stories 按 createdAt 升序；敏感用户故事按 visibilityScope(actor, projectId, 'story') 过滤，
//   被过滤掉的 story 不出现在 stories 数组中，其父级 activity 与 goal 仍正常返回。
//
// 本函数同时承担 T3.8（层级树组装）与 T3.10（可见性接线）——
// 两者是同一个查询的「组装」与「过滤」两半，无法拆成两个可独立交付的版本：
// 契约「常见拼装失败与预防」表明确写着「不可保留一个未过滤的版本」。
// ---------------------------------------------------------------------------

/**
 * 组装某项目的完整需求层级树（目标 → 活动 → 故事）。
 *
 * ---------------------------------------------------------------------------
 * 【为什么过滤必须下推到查询层】（决策 I-6，全文档最要紧的一条约束之一）
 *
 * 契约禁止「取出全量再在内存里过滤」，理由不是性能而是**存在性泄漏**：
 * 内存过滤会让「不该看见敏感故事」的调用者仍能从**数量**上推断出敏感对象的存在
 * （例如列表长度、下级数量），从而违反 AC-US-02-06 / AC-US-03-08 的「不泄漏存在性」。
 * 因此这里把可见性条件写进 `stories.where`，由数据库完成过滤 ——
 * 被过滤掉的故事**根本不会离开数据库**。
 *
 * 三种 scope 的落地方式（决策 I-6 的使用约定）：
 *   - `{mode:'all'}`          → `where: {}`，不加可见性条件；
 *   - `{mode:'subset'; ids}`  → `where: { id: { in: ids } }`；`ids` 为空数组时
 *     Prisma 的 `in: []` 恒假 → 该层返回空集合，正是契约要求的
 *     「若 ids 为空则该列表返回空集合」。
 *
 * ⚠️ 【排序口径的两个补充判断 —— 契约未定义处，本实现的选择与依据】
 *
 *   1. **每个排序都加了 `id` 次级键**（`[{ sortOrder:'asc' }, { id:'asc' }]`、
 *      `[{ createdAt:'asc' }, { id:'asc' }]`）。
 *      契约只规定「按 sortOrder 升序」「按 createdAt 升序」，**没有规定并列时怎么排**，
 *      而并列是真实存在的：
 *        - `sortOrder` 并列：端点 14/18 的全量替换存在**合法中间态**（把 [A,B] 换成 [B,A]
 *          时置 A:=1 于 B 尚为 1 之时），夹具也可能造出并列；而 `schema.prisma` 上
 *          **没有唯一约束**（表五序号 42 已论证为何不能加）。
 *        - `createdAt` 并列：**这是本端点最容易被忽略的一处** —— 迁移里的列定义是
 *          `"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`，SQLite 的
 *          `CURRENT_TIMESTAMP` 只有**秒级精度、没有毫秒**。因此同一秒内创建的多条故事
 *          `createdAt` **完全相同**，纯按 `createdAt` 排序时它们的相对顺序由数据库的
 *          物理顺序决定，**不可预期也不可复现**。
 *      加 `id` 次级键后：顺序虽不等于「业务上有意义的顺序」，但**确定、可复现**，
 *      这比未定义要好；契约的四字规定（升序）依然被满足。
 *      真正的修法在冻结区：`createdAt` 应使用毫秒精度（或改由 Prisma 客户端生成
 *      `now()`），或由技术负责人在契约里补一条次级排序规则。已记入表五，
 *      并请在 Sprint 回顾中提出 —— 该问题在**评审演示的主链路脚本**里最容易暴露
 *      （脚本在同一秒内连续建多条故事）。
 *   2. 排序全部下推到查询层（`orderBy`），不用 JS 排序 —— 与过滤下推同一理由。
 * ---------------------------------------------------------------------------
 *
 * ⚠️ 现状说明（T3.10 的诚实边界）：`visibilityScope()` 目前是 T0.4 骨架，
 * 对**非 PM 的成员**返回 `{mode:'all'}`（T2.5 待实现）。因此本函数的 subset 分支
 * 在 T2.5 落地前**不可能被 HTTP 请求触发**（端点 10 会先用 can() 把非成员挡成 404），
 * 其效果也就无法通过接口测试观测。这不影响接线本身的正确性，但意味着
 * 「敏感故事对未授权成员不可见」这条验收标准**今天演不出来**，需记录为跨模块依赖。
 */
export async function getGoalTree(
  prisma: PrismaClient,
  projectId: string,
  storyScope: Scope,
): Promise<GoalNode[]> {
  // 可见性过滤下推到查询层（见上方说明）
  const storyWhere: Prisma.UserStoryWhereInput =
    storyScope.mode === 'all' ? {} : { id: { in: storyScope.ids } }

  const rows = await prisma.businessGoal.findMany({
    where: { projectId },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: {
      ...BUSINESS_GOAL_FIELDS,
      activities: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: {
          ...USER_ACTIVITY_FIELDS,
          stories: {
            where: storyWhere,
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: USER_STORY_FIELDS,
          },
        },
      },
    },
  })

  // 行 → 契约类型（ActivityNode = UserActivity & { stories }；GoalNode = BusinessGoal & { activities }）
  return rows.map((goal) => ({
    ...toBusinessGoal(goal),
    activities: goal.activities.map((activity) => ({
      ...toUserActivity(activity),
      stories: activity.stories.map(toUserStory),
    })),
  }))
}

/** 供测试与后续任务使用的类型导出（避免测试直接依赖 Prisma 生成类型）。 */
export type { Prisma }