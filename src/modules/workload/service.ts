/**
 * US-07 成员任务图与负载（GitHub #27）—— 只读查询服务。
 *
 * 设计依据：`docs/role-b-workload-design.md`（DRAFT，已获用户批准编码）。
 *
 * ===========================================================================
 * 三条纪律（缺一条这个模块就不该合）
 * ===========================================================================
 *
 * 1. **可见性过滤必须在查询层**（契约决策 I-6）。本模块不接受「先查全量、
 *    再在内存里剔掉敏感项」：那会在计数上泄漏敏感对象的存在性。做法与端点 26 /
 *    工作台一致 —— 用冻结入口 `visibilityScope()` 取作用域，把 `id IN (…)`
 *    拼进**同一个 `where`**（`all` → 不加条件）。
 *
 * 2. **不跨模块调 service**（契约决策 I-9）。因此本模块**不 import**
 *    `task` / `project` / `workbench` 的 service，而是自己查 Prisma、
 *    按本模块类型组装（与 `src/modules/workbench/service.ts:9-15` 同范式）。
 *
 * 3. **「未关闭」= `status != 'CLOSED'`（含 `DONE`）**。六状态已于 2026-10-17 落地，
 *    `DONE ≠ CLOSED`：`DONE` 只代表执行人已提交验收，仍需验收人关闭，故仍计负载。
 *
 * ===========================================================================
 * 口径边界（本轮刻意不做）
 * ===========================================================================
 *
 * - **不实现**候选 population / taskPopulation / excludedSensitiveCount：设计 §4/§11.1
 *   尚未定「退组负责人任务」的口径，不能发明（`removeMember` 不校验名下任务）。
 *   因此本模块只统计**当前 `ProjectMember` 成员**的非 CLOSED 负载。
 * - 成员—任务关联一律以 `Task.ownerUserId` 定义；`Task` 无协作人字段，不引入。
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { createAuthorization } from '../authz/permissions.js'
import type { ProjectRole, Scope, TaskStatus } from '../../shared/types.js'
import type {
  MemberTaskItem,
  MemberWorkloadDetailView,
  MemberWorkloadRow,
  ProjectWorkloadView,
  WorkloadBasis,
} from './types.js'

/**
 * 单成员未关闭任务明细的**最大返回行数**（本票自定上限）。
 *
 * 与工作台 `ROWS_PER_BLOCK` 同一纪律：`total` 始终由 `count` 精确得出、
 * 不受本上限影响；超出时只置 `truncated=true`，**不得**用 `items.length` 反推总数。
 */
export const MEMBER_TASK_ROWS_LIMIT = 200

/** 明细行的取数形状：只取本端点契约列出的字段，**不含 `isSensitive`**。 */
const MEMBER_TASK_SELECT = {
  id: true,
  title: true,
  status: true,
  planStart: true,
  planEnd: true,
  progress: true,
} as const

/** `visibilityScope` 的作用域 → 对外的口径标签：`all` 只可能是 PM。 */
function scopeLabelOf(scope: Scope): WorkloadBasis['scopeLabel'] {
  return scope.mode === 'all' ? '全项目' : '可见范围'
}

/**
 * 非 CLOSED 负载的**共用 `where`**：列表与计数必须逐字段一致，否则 AC1/AC3 会失配。
 * 可见性条件与「非 CLOSED」条件进同一个 `where`（决策 I-6，禁止内存过滤）。
 */
function openTaskWhere(
  projectId: string,
  ownerUserId: string,
  scope: Scope,
): Prisma.TaskWhereInput {
  return {
    projectId,
    ownerUserId,
    status: { not: 'CLOSED' },
    ...(scope.mode === 'subset' ? { id: { in: scope.ids } } : {}),
  }
}

/** 成员排序：displayName → account → userId，逐级打破平局，保证稳定顺序。 */
function compareMembers(a: MemberWorkloadRow, b: MemberWorkloadRow): number {
  if (a.displayName !== b.displayName) return a.displayName < b.displayName ? -1 : 1
  if (a.account !== b.account) return a.account < b.account ? -1 : 1
  if (a.userId === b.userId) return 0
  return a.userId < b.userId ? -1 : 1
}

/**
 * 项目成员负载总览（`GET /projects/:projectId/workload`）。
 *
 * 调用方（路由层）须已通过 `can(actorUserId, 'project.read', { kind: 'project', projectId })`。
 * `members` = 该项目**当前** `ProjectMember`（join user 取 account / displayName），
 * 零任务成员也返回、`openTaskCount=0`。
 */
export async function buildProjectWorkload(
  prisma: PrismaClient,
  actorUserId: string,
  projectId: string,
): Promise<ProjectWorkloadView> {
  const { visibilityScope } = createAuthorization(prisma)
  const scope = await visibilityScope(actorUserId, projectId, 'task')

  const rows = await prisma.projectMember.findMany({
    where: { projectId },
    include: { user: { select: { account: true, displayName: true } } },
  })

  // 每个成员的计数都用同一个 `where` 精确 `count`（成员数有限，逐成员并发取数）。
  const members: MemberWorkloadRow[] = await Promise.all(
    rows.map(async (row) => ({
      userId: row.userId,
      role: row.role as ProjectRole,
      account: row.user.account,
      displayName: row.user.displayName,
      joinedAt: row.joinedAt.toISOString(),
      openTaskCount: await prisma.task.count({
        where: openTaskWhere(projectId, row.userId, scope),
      }),
    })),
  )

  members.sort(compareMembers)

  return {
    projectId,
    basis: { scopeLabel: scopeLabelOf(scope) },
    members,
  }
}

/**
 * 单成员未关闭任务明细（`GET /projects/:projectId/workload/:userId`）。
 *
 * 返回 `null` 表示 `userId` **不是该项目当前成员** —— 由路由层转成与「项目不存在」
 * 逐字一致的 404（不泄漏存在性）。可见性条件同样进查询层。
 */
export async function buildMemberWorkload(
  prisma: PrismaClient,
  actorUserId: string,
  projectId: string,
  userId: string,
): Promise<MemberWorkloadDetailView | null> {
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { userId: true },
  })
  if (!membership) return null

  const { visibilityScope } = createAuthorization(prisma)
  const scope = await visibilityScope(actorUserId, projectId, 'task')
  const where = openTaskWhere(projectId, userId, scope)

  // count 与 findMany 共用同一 `where`：total 精确，明细最多 MEMBER_TASK_ROWS_LIMIT 行。
  const [total, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      orderBy: [{ planEnd: 'asc' }, { createdAt: 'asc' }],
      take: MEMBER_TASK_ROWS_LIMIT,
      select: MEMBER_TASK_SELECT,
    }),
  ])

  const items: MemberTaskItem[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status as TaskStatus,
    planStart: row.planStart,
    planEnd: row.planEnd,
    progress: row.progress,
  }))

  return {
    projectId,
    userId,
    basis: { scopeLabel: scopeLabelOf(scope) },
    total,
    truncated: total > items.length,
    items,
  }
}
