/**
 * US-06 甘特图（GitHub #26，本地 #11）—— 只读聚合服务。
 *
 * 设计依据：`docs/role-b-gantt-design.md`（§3 模型、§4 FS 语义、§5 汇总边界、
 * §6 可见性、§7 接口候选）。响应字段由主代理冻结（见 `./types.ts`）。
 *
 * ===========================================================================
 * 本批（#11）只做只读聚合，刻意不做的事
 * ===========================================================================
 *
 * - **不跨模块调 service**（契约决策 I-9）：不 import `task` / `project` /
 *   `workbench` 的 service，自己查 Prisma 并按本模块类型组装（与
 *   `src/modules/workload/service.ts` 同范式）。
 * - **可见性过滤在查询层**（契约决策 I-6）：`visibilityScope()` 取作用域，把
 *   `id IN (…)` 拼进**同一个 `where`**；绝不「先查全量、再内存剔除」。
 * - **故事进度按 C10 口径计算**（DECISIONS `analytics.story-progress-aggregation`）：
 *   已 `CLOSED` 任务数 ÷ 同一可见任务集合的任务总数，`DONE` 不计入；无任务 → `null`。
 *   表达形状与取整**沿用仪表盘**（`closed` / `total` / `ratio`，4 位小数），故对同一
 *   任务集合，本字段与 `GET /projects/:projectId/dashboard` 的 `progress` 必然相等。
 *   故事**日期**仍是候选口径（`aggregation='candidate-minmax'`），C10 只收口了进度。
 * - **依赖区恒为 `ok`**：`TaskDependency` 表本批已落地、数据源始终可用，
 *   故不用 `unavailable` 造假（`unavailable` 只是给未来数据源缺席留的两态形状）。
 * - 不含 `isSensitive`：过滤在查询层完成，列表不再回传敏感标记。
 *
 * ===========================================================================
 * 可见性口径（本批的一处明确取舍）
 * ===========================================================================
 *
 * 冻结响应把任务**内联在故事之下**（`stories[].tasks[]`）。因此本端点定义的
 * 「可见任务集」= 任务可见性 ∩ 可见故事内的任务：
 *
 *   - 任务：`visibilityScope(actor, projectId, 'task')`；
 *   - 故事：`visibilityScope(actor, projectId, 'story')`。
 *
 * 一个任务自身可见、但其所属故事不可见（如故事敏感、任务非敏感）时，冻结形状
 * 里没有安全落点（不能显示隐藏故事标题，也不能造占位），故本批**整体不返回**该
 * 任务 —— 包括里程碑的 `taskIds` 与依赖边端点 —— 以免间接泄漏隐藏故事的存在性。
 * 设计 §6 的「独立任务条 / 分组关系的安全表示」属待核对项，留待后续批次。
 *
 * 里程碑：PM 返回全项目；非 PM 仅返回「至少有一个可见关联任务」的里程碑
 * （无关联任务的里程碑对非 PM 不返回，避免存在性泄漏），`taskIds` 只含可见任务。
 * 依赖边：仅当前驱与后继**都可见**时才返回（否则边会泄漏隐藏任务的存在性）。
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { createAuthorization } from '../authz/permissions.js'
// ★ 取整与仪表盘**同一实现**（`roundTo`，纯函数、零 I/O）。一致性要求（C10 第 6 条）
//   不允许本模块自写第二套 `Math.round` —— 否则同集合两个端点的数值迟早分叉。
import { roundTo } from '../analytics/caliber.js'
import type { ProjectProgress } from '../analytics/types.js'
import type { Scope, StoryStatus } from '../../shared/types.js'
import {
  GANTT_STORY_AGGREGATION,
  GANTT_STORY_PROGRESS_STATE,
  type GanttDependencies,
  type GanttMilestoneItem,
  type GanttScopeLabel,
  type GanttStoryItem,
  type GanttTaskItem,
  type GanttView,
} from './types.js'

/** 任务总计最多返回行数（跨全部故事合计；超出只置 `truncated.tasks`）。 */
export const GANTT_TASK_LIMIT = 500
/** 里程碑最多返回行数。 */
export const GANTT_MILESTONE_LIMIT = 200
/** 依赖边最多返回行数。 */
export const GANTT_DEPENDENCY_LIMIT = 500

/** `visibilityScope` 的作用域 → 对外的口径标签：`all` 只可能是 PM。 */
function scopeLabelOf(scope: Scope): GanttScopeLabel {
  return scope.mode === 'all' ? '全项目' : '可见范围'
}

/** 任务取数形状：只取契约列出的字段，**不含 `isSensitive`**。 */
const TASK_SELECT = {
  id: true,
  title: true,
  status: true,
  planStart: true,
  planEnd: true,
  storyId: true,
  ownerUserId: true,
  createdAt: true,
  owner: { select: { displayName: true } },
} as const

type TaskRow = {
  id: string
  title: string
  status: string
  planStart: string
  planEnd: string
  storyId: string
  ownerUserId: string
  createdAt: Date
  owner: { displayName: string }
}

/** 故事内任务排序：`planStart asc, createdAt asc`，再以 `id` 破平局保证稳定。 */
function compareTaskRows(a: TaskRow, b: TaskRow): number {
  if (a.planStart !== b.planStart) return a.planStart < b.planStart ? -1 : 1
  const at = a.createdAt.getTime()
  const bt = b.createdAt.getTime()
  if (at !== bt) return at < bt ? -1 : 1
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

/**
 * 组装甘特聚合视图（`GET /projects/:projectId/gantt`）。
 *
 * 调用方（路由层）须已通过 `can(actorUserId, 'project.read', { kind: 'project', projectId })`。
 */
export async function buildGanttView(
  prisma: PrismaClient,
  actorUserId: string,
  projectId: string,
): Promise<GanttView> {
  const { visibilityScope } = createAuthorization(prisma)
  const [storyScope, taskScope] = await Promise.all([
    visibilityScope(actorUserId, projectId, 'story'),
    visibilityScope(actorUserId, projectId, 'task'),
  ])

  // 故事：可见性进查询层，排序 `createdAt asc, id asc`。
  const stories = await prisma.userStory.findMany({
    where: {
      projectId,
      ...(storyScope.mode === 'subset' ? { id: { in: storyScope.ids } } : {}),
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, title: true, status: true },
  })
  const storyIds = stories.map((s) => s.id)

  // 有效可见任务集：任务可见性（taskScope）∩ 可见故事内的任务（见文件头取舍说明）。
  // 可见性与业务条件进同一个 `where`（决策 I-6），不做内存剔除。
  const effectiveTaskWhere: Prisma.TaskWhereInput = {
    projectId,
    storyId: { in: storyIds },
    ...(taskScope.mode === 'subset' ? { id: { in: taskScope.ids } } : {}),
  }

  // PM 两侧作用域均为 `all`（`visibilityScope` 只对 PM 返回 all）→ 无需逐 id 过滤。
  const isGlobal = storyScope.mode === 'all' && taskScope.mode === 'all'

  // 任务明细：跨全部故事合计最多 GANTT_TASK_LIMIT 行。多取 1 行只用来判定截断，
  // **不用行数反推总数**（本端点不返回 total）。
  const taskRows = await prisma.task.findMany({
    where: effectiveTaskWhere,
    // 全局顺序保证「故事内」也满足 planStart / createdAt 升序（分组后仍显式排序）。
    orderBy: [{ planStart: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    take: GANTT_TASK_LIMIT + 1,
    select: TASK_SELECT,
  })
  const tasksTruncated = taskRows.length > GANTT_TASK_LIMIT
  const visibleTaskRows = tasksTruncated ? taskRows.slice(0, GANTT_TASK_LIMIT) : taskRows

  // 故事日期汇总：在**全部**可见任务上取 min(planStart) / max(planEnd)（精确，不受
  // 上述明细上限影响），只标候选口径。无可见任务 → null。
  //
  // 故事进度（C10）：与上面 min/max **同一集合**（同一个 `effectiveTaskWhere`），
  // 按 `storyId × status` 计数后算出 `closed / total`。刻意**不**在已截断的
  // `visibleTaskRows` 上数 —— 截断只是展示上限，不得让进度悄悄变小。
  const [aggregates, statusCounts] = await Promise.all([
    prisma.task.groupBy({
      by: ['storyId'],
      where: effectiveTaskWhere,
      _min: { planStart: true },
      _max: { planEnd: true },
    }),
    prisma.task.groupBy({
      by: ['storyId', 'status'],
      where: effectiveTaskWhere,
      _count: { _all: true },
    }),
  ])
  const rangeByStory = new Map<string, { planStart: string | null; planEnd: string | null }>()
  for (const agg of aggregates) {
    rangeByStory.set(agg.storyId, {
      planStart: agg._min.planStart ?? null,
      planEnd: agg._max.planEnd ?? null,
    })
  }

  // 每故事 closed / total（`DONE` 只进分母，不进分子）。
  const progressByStory = new Map<string, ProjectProgress>()
  for (const row of statusCounts) {
    const current = progressByStory.get(row.storyId) ?? { closed: 0, total: 0, ratio: null }
    current.total += row._count._all
    if (row.status === 'CLOSED') current.closed += row._count._all
    progressByStory.set(row.storyId, current)
  }
  for (const progress of progressByStory.values()) {
    // 与仪表盘 `progress.ratio` 同一条取整规则：4 位小数，`total === 0` 时为 null（不是 0）
    progress.ratio = progress.total === 0 ? null : roundTo(progress.closed / progress.total, 4)
  }

  // 非 PM 用「有效可见任务 id 集」过滤里程碑关联与依赖边端点。
  let visibleTaskIds: string[] | null = null
  if (!isGlobal) {
    const rows = await prisma.task.findMany({
      where: effectiveTaskWhere,
      select: { id: true },
    })
    visibleTaskIds = rows.map((row) => row.id)
  }

  // 里程碑：PM 全部；非 PM 仅「至少有一个可见关联任务」的。排序 `dueDate asc, id asc`。
  const milestoneWhere: Prisma.MilestoneWhereInput = isGlobal
    ? { projectId }
    : { projectId, tasks: { some: { taskId: { in: visibleTaskIds ?? [] } } } }
  const milestoneRows = await prisma.milestone.findMany({
    where: milestoneWhere,
    orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    take: GANTT_MILESTONE_LIMIT + 1,
    select: {
      id: true,
      name: true,
      dueDate: true,
      ownerUserId: true,
      owner: { select: { displayName: true } },
    },
  })
  const milestonesTruncated = milestoneRows.length > GANTT_MILESTONE_LIMIT
  const shownMilestones = milestonesTruncated
    ? milestoneRows.slice(0, GANTT_MILESTONE_LIMIT)
    : milestoneRows
  const milestoneIds = shownMilestones.map((m) => m.id)

  // 任务—里程碑关联：只取已展示里程碑的关联行，非 PM 再按可见任务过滤。
  const links =
    milestoneIds.length === 0
      ? []
      : await prisma.taskMilestone.findMany({
          where: {
            milestoneId: { in: milestoneIds },
            ...(isGlobal ? {} : { taskId: { in: visibleTaskIds ?? [] } }),
          },
          select: { milestoneId: true, taskId: true },
        })

  const taskIdsByMilestone = new Map<string, string[]>()
  const milestoneIdsByTask = new Map<string, string[]>()
  for (const link of links) {
    const forMilestone = taskIdsByMilestone.get(link.milestoneId)
    if (forMilestone) forMilestone.push(link.taskId)
    else taskIdsByMilestone.set(link.milestoneId, [link.taskId])

    const forTask = milestoneIdsByTask.get(link.taskId)
    if (forTask) forTask.push(link.milestoneId)
    else milestoneIdsByTask.set(link.taskId, [link.milestoneId])
  }

  const milestones: GanttMilestoneItem[] = shownMilestones.map((m) => ({
    id: m.id,
    name: m.name,
    dueDate: m.dueDate,
    ownerUserId: m.ownerUserId,
    ownerDisplayName: m.owner?.displayName ?? null,
    taskIds: (taskIdsByMilestone.get(m.id) ?? []).slice().sort(),
  }))

  // 任务按故事分组；组内显式排序（不依赖取数顺序）。
  const rowsByStory = new Map<string, TaskRow[]>()
  for (const row of visibleTaskRows) {
    const list = rowsByStory.get(row.storyId)
    if (list) list.push(row)
    else rowsByStory.set(row.storyId, [row])
  }
  const tasksByStory = new Map<string, GanttTaskItem[]>()
  for (const [storyId, rows] of rowsByStory) {
    rows.sort(compareTaskRows)
    tasksByStory.set(
      storyId,
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        planStart: row.planStart,
        planEnd: row.planEnd,
        ownerUserId: row.ownerUserId,
        ownerDisplayName: row.owner.displayName,
        milestoneIds: (milestoneIdsByTask.get(row.id) ?? []).slice().sort(),
      })),
    )
  }

  const storyItems: GanttStoryItem[] = stories.map((story) => {
    const range = rangeByStory.get(story.id)
    return {
      id: story.id,
      title: story.title,
      status: story.status as StoryStatus,
      planStart: range?.planStart ?? null,
      planEnd: range?.planEnd ?? null,
      aggregation: GANTT_STORY_AGGREGATION,
      // 无可见任务 → null（不显示 0%）；有任务则形状与仪表盘 `progress` 完全一致
      progress: progressByStory.get(story.id) ?? null,
      progressState: GANTT_STORY_PROGRESS_STATE,
      tasks: tasksByStory.get(story.id) ?? [],
    }
  })

  // 依赖边：仅当前驱与后继都可见时才返回。排序 `predecessorTaskId, successorTaskId`。
  const dependencyWhere: Prisma.TaskDependencyWhereInput = isGlobal
    ? { projectId }
    : {
        projectId,
        predecessorTaskId: { in: visibleTaskIds ?? [] },
        successorTaskId: { in: visibleTaskIds ?? [] },
      }
  const dependencyRows = await prisma.taskDependency.findMany({
    where: dependencyWhere,
    orderBy: [{ predecessorTaskId: 'asc' }, { successorTaskId: 'asc' }],
    take: GANTT_DEPENDENCY_LIMIT + 1,
    select: { id: true, predecessorTaskId: true, successorTaskId: true, type: true },
  })
  const dependenciesTruncated = dependencyRows.length > GANTT_DEPENDENCY_LIMIT
  // 数据源本批始终可用 → 一律 `ok`，不以 `unavailable` 或空数组造假。
  const dependencies: GanttDependencies = {
    state: 'ok',
    items: dependencyRows.slice(0, GANTT_DEPENDENCY_LIMIT).map((row) => ({
      id: row.id,
      predecessorTaskId: row.predecessorTaskId,
      successorTaskId: row.successorTaskId,
      type: row.type as 'FS',
    })),
  }

  return {
    projectId,
    basis: { scopeLabel: scopeLabelOf(taskScope) },
    stories: storyItems,
    milestones,
    dependencies,
    truncated: {
      tasks: tasksTruncated,
      milestones: milestonesTruncated,
      dependencies: dependenciesTruncated,
    },
  }
}
