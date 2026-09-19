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
import type { BusinessGoal, GoalStatus, Priority, StoryStatus, UserStory } from '../../shared/types.js'

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
// ---------------------------------------------------------------------------

/**
 * 计算「当前项目内 sortOrder 的最大值 + 1」（决策 I-8 端点 11 副作用）。
 *
 * 空项目（尚无目标）的取值：契约只说「最大值 + 1」，未规定起点。
 * 这里把「空集合的最大值」视作 `-1`，于是**首个目标得到 0**。
 * 定这个口径的理由：端点 14 的全量替换排序规定「第 i 个 id 的 sortOrder 置为 i」，
 * 即排序是**从 0 开始**的下标；两条规则必须同源，否则排序后 sortOrder 集合会突变。
 *
 * 注意 `aggregate` 在空集合上返回 `_max.sortOrder === null`（不是 0），
 * 因此必须用 `!== null` 判断，不能写成 `?? -1` 之外的散漫写法。
 */
export async function nextGoalSortOrder(
  prisma: PrismaClient,
  projectId: string,
): Promise<number> {
  const aggregate = await prisma.businessGoal.aggregate({
    where: { projectId },
    _max: { sortOrder: true },
  })
  const currentMax = aggregate._max.sortOrder
  return (currentMax === null ? -1 : currentMax) + 1
}

/**
 * 创建业务目标。
 *
 * 职责边界：本函数**只做数据写入**，不查项目是否存在、不做权限判定
 * （那两件事属于 handler + `can()`）。参数 `projectId` 由调用方**从 URL 父级推导**后传入，
 * 绝不来自请求体（决策 I-10）。
 */
export async function createBusinessGoal(
  prisma: PrismaClient,
  projectId: string,
  input: { name: string; description?: string },
): Promise<BusinessGoal> {
  const sortOrder = await nextGoalSortOrder(prisma, projectId)

  const row = await prisma.businessGoal.create({
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

  return toBusinessGoal(row)
}

/** 供测试与后续任务使用的类型导出（避免测试直接依赖 Prisma 生成类型）。 */
export type { Prisma }
