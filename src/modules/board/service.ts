/**
 * US-04 故事看板（GitHub #25，本地 #17）—— 只读聚合服务。
 *
 * 设计依据：`docs/role-b-board-design.md`（§3 列与卡片字段、§4 读路径、§6 权限矩阵）。
 * 响应字段由主代理冻结（见 `./types.ts`）。
 *
 * ===========================================================================
 * 本批（#17）只做只读聚合，刻意不做的事
 * ===========================================================================
 *
 * - **不跨模块调 service**（契约决策 I-9）：不 import `requirement` / `project` /
 *   `task` 的 service，自己查 Prisma 并按本模块类型组装（与
 *   `src/modules/workload/service.ts`、`src/modules/gantt/service.ts` 同范式）。
 * - **可见性进查询层**（契约决策 I-6）：`visibilityScope(actor, projectId, 'story')`
 *   的结果并入 `where`（`all` → 不加条件；`subset` → `id IN (…)`）；`count` 与
 *   `findMany` **共用同一 `where`**，禁止内存过滤 / 内存计数（会泄漏存在性）。
 * - **卡片不含 `isSensitive`**：过滤在查询层完成，列表不再回传敏感标记。
 * - **排序沿用既有源码口径** `createdAt asc, id asc`（端点 10，`requirement/service.ts`），
 *   不新造排序键。
 * - **不做写路径**：不新增 PATCH / POST，不判断角色、不新增 `Action`。
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { createAuthorization } from '../authz/permissions.js'
import type { Scope, StoryStatus } from '../../shared/types.js'
import {
  BOARD_COLUMN_ROW_LIMIT,
  BOARD_STATUS_ORDER,
  type BoardCardItem,
  type BoardColumn,
  type BoardView,
} from './types.js'

/** `visibilityScope` 的作用域 → 对外的口径标签：`all` 只可能是 PM。 */
function scopeLabelOf(scope: Scope): BoardView['basis']['scopeLabel'] {
  return scope.mode === 'all' ? '全项目' : '可见范围'
}

/**
 * 单列查询的**共用 `where`**：可见性条件与状态条件进同一个 `where`（决策 I-6）。
 *
 * `count` 与 `findMany` 必须传入**同一个** `where` 对象，否则 AC5「敏感不展示、
 * 计数与列表一致」会失配。
 */
function columnWhere(projectId: string, status: StoryStatus, scope: Scope): Prisma.UserStoryWhereInput {
  return {
    projectId,
    status,
    ...(scope.mode === 'subset' ? { id: { in: scope.ids } } : {}),
  }
}

/** 卡片取数形状：只取契约列出的 7 个字段，**不含 `isSensitive`**。 */
const CARD_SELECT = {
  id: true,
  title: true,
  priority: true,
  status: true,
  activity: { select: { name: true, goal: { select: { name: true } } } },
} as const

/**
 * 组装故事看板视图（`GET /projects/:projectId/board`）。
 *
 * 调用方（路由层）须已通过 `can(actorUserId, 'project.read', { kind: 'project', projectId })`。
 * 三列固定顺序 `DRAFT, PLANNING, DONE`；空列也返回（`count=0, items=[], truncated=false`）。
 */
export async function buildBoardView(
  prisma: PrismaClient,
  actorUserId: string,
  projectId: string,
): Promise<BoardView> {
  const { visibilityScope } = createAuthorization(prisma)
  const scope = await visibilityScope(actorUserId, projectId, 'story')

  const columns: BoardColumn[] = await Promise.all(
    BOARD_STATUS_ORDER.map(async (status) => {
      // count 与 findMany 共用同一 where（决策 I-6）。
      const where = columnWhere(projectId, status, scope)
      // 多取 1 行只用于判定截断；count 仍是精确值，不由行数反推。
      const [count, rows] = await Promise.all([
        prisma.userStory.count({ where }),
        prisma.userStory.findMany({
          where,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: BOARD_COLUMN_ROW_LIMIT + 1,
          select: CARD_SELECT,
        }),
      ])

      const truncated = rows.length > BOARD_COLUMN_ROW_LIMIT
      const shown = truncated ? rows.slice(0, BOARD_COLUMN_ROW_LIMIT) : rows
      const items: BoardCardItem[] = shown.map((row) => ({
        id: row.id,
        title: row.title,
        priority: row.priority,
        status: row.status as StoryStatus,
        activityName: row.activity.name,
        goalName: row.activity.goal.name,
      }))

      return { status, count, truncated, items }
    }),
  )

  return {
    projectId,
    basis: { scopeLabel: scopeLabelOf(scope) },
    columns,
  }
}
