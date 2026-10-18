/**
 * US-07 成员任务图与负载（GitHub #27）—— 本模块自有类型。
 *
 * 为什么不放进 `src/shared/types.ts`：那是冻结文件（技术负责人单写）。
 * 本模块只新增、不改共享契约；等接口正式并入契约时再由技术负责人决定是否上提。
 *
 * 口径声明（见 `docs/role-b-workload-design.md` 与 `DECISIONS.md`
 * `scheduling.load-aggregation-baseline`）：
 *   - 负载 = 负责人名下**所有非 `CLOSED` 任务数（含 `DONE`）**，不做评分、不设过载阈值；
 *   - `DONE ≠ CLOSED`：`DONE` 只代表执行人已提交验收，仍算「未关闭」；
 *   - `scopeLabel` 随响应返回，让界面 / 审查 / 测试对「这是全项目还是可见范围」不再各说各话。
 */
import type { ProjectRole, TaskStatus } from '../../shared/types.js'

/**
 * 计算基数标签。
 *   - PM（`visibilityScope` 为 `all`）→ `'全项目'`
 *   - MEMBER / VIEWER（`subset`）   → `'可见范围'`
 */
export type WorkloadScopeLabel = '全项目' | '可见范围'

/** 计算口径的显式声明：随响应一起返回，避免消费方自行猜测范围。 */
export type WorkloadBasis = {
  scopeLabel: WorkloadScopeLabel
}

/** 项目负载总览中的一行成员。`openTaskCount` 为该成员在本项目内的非 `CLOSED` 任务数。 */
export type MemberWorkloadRow = {
  userId: string
  role: ProjectRole
  account: string
  displayName: string
  joinedAt: string
  /** 该成员名下 `status !== 'CLOSED'` 的任务数（含 `DONE`），由 count 精确得出。 */
  openTaskCount: number
}

/** `GET /projects/:projectId/workload` 的响应体（单资源，不套 `{ items }`）。 */
export type ProjectWorkloadView = {
  projectId: string
  basis: WorkloadBasis
  members: MemberWorkloadRow[]
}

/**
 * 单成员未关闭任务明细行。
 *
 * 刻意**不含 `isSensitive`**：本端点是列表，敏感过滤已在查询层完成（决策 I-6），
 * 不再向调用方回传敏感标记。
 */
export type MemberTaskItem = {
  id: string
  title: string
  status: TaskStatus
  planStart: string
  planEnd: string
  progress: number | null
}

/** `GET /projects/:projectId/workload/:userId` 的响应体。 */
export type MemberWorkloadDetailView = {
  projectId: string
  userId: string
  basis: WorkloadBasis
  /** 与 `items` 使用**同一 `where`** 的精确总数，不受明细上限影响。 */
  total: number
  /** 明细是否因达到上限被截断；**不得**用 `items.length` 冒充 `total`。 */
  truncated: boolean
  items: MemberTaskItem[]
}
