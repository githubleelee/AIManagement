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
import type { BusinessGoal, GoalStatus, Priority, StoryStatus, UserActivity, UserStory } from '../../shared/types.js'

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

/** 供测试与后续任务使用的类型导出（避免测试直接依赖 Prisma 生成类型）。 */
export type { Prisma }
