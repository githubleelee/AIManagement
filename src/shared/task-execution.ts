/**
 * 任务执行门禁的共享窄端口（类型契约，ROLE-B 单写）
 *
 * 权威来源：`DECISIONS.md` `scheduling.fs-release-closed-natural-days` 与
 * `legacy.task-start-guard-authorization`（2026-10-23 项目负责人裁定扩展触发面：
 * 任何从非 `DOING` 进入 `DOING` 都校验 FS，含首次 / 恢复 / 重开及验收 `REJECT`）。
 *
 * ===========================================================================
 * 归属与依赖方向
 * ===========================================================================
 *
 * - **只放类型**：本文件不 import 任何业务模块、不引入任何 node 运行时 / DB 客户端；
 *   编译产物为空。实现留在 `src/modules/task/rules.ts` 的**同一守卫函数**里，由唯一组装点
 *   `src/app.ts` 显式装配后经 `RouteContext.taskStartGuard` 注入。
 * - 调用方（例如验收 `REJECT` 进入 `DOING`）**只依赖本端口**，不 import
 *   `src/modules/task/` 的实现，避免跨模块 service 依赖（契约 I-9）。
 * - **没有 no-op / 默认放行实现**：缺省端口 = 组装缺失，调用方必须 fail-fast。
 *
 * ===========================================================================
 * 固定语义（调用方必须遵守）
 * ===========================================================================
 *
 * 1. **必须传调用方自己的事务客户端**：端口在**该事务内**读取前置与（可选）当前计划，
 *    与调用方后续的 CAS / 状态写 / 验收记录 / 审计 / 事件同事务提交或回滚。端口自身
 *    **绝不**开启或提交事务；传根 `PrismaClient` 会 fail-fast（见实现）。
 * 2. **校验的是“进入 `DOING`”**：调用方在真正写入 `DOING` 之前调用一次；当前状态已是
 *    `DOING` 时直接返回（同值编辑不算“新进入”，不重复校验）。
 * 3. **不给 `nextPlanStart` 时**，实现会在同一事务内读取该任务当前的 `planStart` 作为
 *    本次进入 `DOING` 的计划开始日；不读、也不回传任何正文。
 * 4. **`projectId` 强校验**：`taskId` 不属于该 `projectId`（越项目 / 不存在）按不可访问处理。
 * 5. **失败形态**：抛 `AppError`（422 `VALIDATION_FAILED`，字段码取自决策 I-4 冻结表；
 *    任务不存在 / 越项目为 404 `NOT_FOUND`）。异常与响应**不含**任何前置的 ID / 标题 /
 *    正文 / 日期 / 条数或逐项状态。
 * 6. **并发边界**：端口是“检查后写入”，不提供跨事务的锁保证；调用方必须把它与真实写入
 *    放在同一事务内，并自行接受当前数据库隔离级别下的读写竞态（见测试记录的真实结论，
 *    不宣称“无锁也一定安全”）。
 */

/** `assertCanEnterDoing` 的入参（不读 / 不回传任何任务正文）。 */
export type TaskStartGuardInput = {
  /** 任务所属项目；与 `taskId` 不匹配（越项目 / 不存在）按不可访问处理。 */
  projectId: string
  taskId: string
  /**
   * 本次进入 `DOING` 后的计划开始日（`YYYY-MM-DD`）。
   * 缺省时由实现于**同一事务**内读取该任务当前计划，不额外回传正文。
   */
  nextPlanStart?: string
}

/**
 * FS 开工守卫端口。`TTransaction` 由调用方按其事务客户端类型实例化
 * （生产为 `Prisma.TransactionClient`）。
 */
export type TaskStartGuardPort<TTransaction> = {
  /**
   * 断言任务可以从当前状态进入 `DOING`：
   *   - 当前已是 `DOING` → 直接返回；
   *   - 否则每个 FS 前置必须 `CLOSED`（`DONE` 不算），且计划开始不得早于前置计划结束次日。
   *
   * 使用传入的 `transaction`，不自行开启 / 提交事务。
   */
  assertCanEnterDoing(transaction: TTransaction, input: TaskStartGuardInput): Promise<void>
}
