/**
 * M5 任务模块 —— 任务分配业务规则（创建与编辑共用的单一入口）
 *
 * 权威来源：`docs/sprint1-spec-interface-contract.md`
 *   - 决策 I-2b：业务规则（跳字段比较 / 需查库）不走 Zod，由处理器主动抛 `AppError`
 *   - 决策 I-4：字段级错误码 `NOT_PROJECT_MEMBER` / `ACCEPTOR_EQUALS_OWNER` /
 *     `END_BEFORE_START` / `INSUFFICIENT_MEMBERS`
 *   - 决策 I-8 端点 25 / 28 与决策 I-10 部分更新语义
 *
 * 本函数是创建（端点 25）与编辑（端点 28，T5-03）共用的**唯一**分配校验入口。
 * 为支持 T5-03 的部分更新，入参不是请求体，而是「**现有值 + 请求体覆盖**」合并后的
 * 最终值：PATCH 侧只要先合并出 `TaskAssignmentInput`，再调用本函数即可，规则无需重写。
 *
 * 注意：单字段形状校验（必填、长度、日期格式）由 Zod 在处理器里先行完成，
 * 本函数只处理需要跳字段比较或查库的业务规则。
 */
import type { PrismaClient } from '@prisma/client'
import { AppError } from '../../shared/errors.js'
import type { FieldError } from '../../shared/types.js'

/**
 * 创建与编辑共用的业务规则入参：必须是「合并后的最终值」。
 *
 * - 创建：全部字段来自请求体（形状校验之后）。
 * - 编辑（T5-03）：`{ ...现有任务, ...请求体出现过的字段 }`。
 */
export type TaskAssignmentInput = {
  ownerUserId: string
  acceptorUserId: string
  planStart: string
  planEnd: string
}

/** 统一的 422 VALIDATION_FAILED 抛出，保证字段级错误码可被测试断言（契约 I-4）。 */
function validationError(message: string, details: FieldError[]): AppError {
  return new AppError(422, 'VALIDATION_FAILED', message, details)
}

/**
 * 任务分配业务规则校验；入参必须是「合并后的最终值」。
 *
 * 校验顺序（契约端点 25 明文要求）：
 *   1. 负责人是且仅是本项目成员（`ownerUserId: NOT_PROJECT_MEMBER`）
 *   2. 验收人是且仅是本项目成员（`acceptorUserId: NOT_PROJECT_MEMBER`）
 *   3. 项目成员数 ≥ 2（`INSUFFICIENT_MEMBERS`，放空 field）
 *   4. 验收人 ≠ 负责人（`acceptorUserId: ACCEPTOR_EQUALS_OWNER`）
 *   5. 计划结束 ≥ 计划开始（`planEnd: END_BEFORE_START`，`YYYY-MM-DD` 字典序即时间序）
 *
 * 第 1 / 2 步先于第 4 步：避免对空值或非成员做相等判断；
 * 第 3 步先于第 4 步：成员只有 1 人时，负责人与验收人若都是该成员，
 * 应报 `INSUFFICIENT_MEMBERS` 而不是 `ACCEPTOR_EQUALS_OWNER`（否则上一条不可能满足）。
 */
export async function assertTaskAssignment(
  prisma: PrismaClient,
  projectId: string,
  input: TaskAssignmentInput,
): Promise<void> {
  // 1 / 2. 成员归属：一次查询取回两个候选人的成员关系。
  const memberships = await prisma.projectMember.findMany({
    where: {
      projectId,
      userId: { in: [input.ownerUserId, input.acceptorUserId] },
    },
    select: { userId: true },
  })
  const memberIds = new Set(memberships.map((membership) => membership.userId))

  if (!memberIds.has(input.ownerUserId)) {
    throw validationError('负责人必须是本项目成员', [
      { field: 'ownerUserId', code: 'NOT_PROJECT_MEMBER' },
    ])
  }
  if (!memberIds.has(input.acceptorUserId)) {
    throw validationError('验收人必须是本项目成员', [
      { field: 'acceptorUserId', code: 'NOT_PROJECT_MEMBER' },
    ])
  }

  // 3. 成员数 ≥ 2：少于 2 人时不可能满足验收独立性。该规则无归属字段，field 置空。
  const memberCount = await prisma.projectMember.count({ where: { projectId } })
  if (memberCount < 2) {
    throw validationError('项目成员不足 2 人，请先添加其他成员', [
      { field: '', code: 'INSUFFICIENT_MEMBERS' },
    ])
  }

  // 4. 验收独立性与负责人互斥（团队决策 3）。
  if (input.acceptorUserId === input.ownerUserId) {
    throw validationError('验收人不能与负责人为同一人', [
      { field: 'acceptorUserId', code: 'ACCEPTOR_EQUALS_OWNER' },
    ])
  }

  // 5. 计划结束不早于计划开始。`YYYY-MM-DD` 零填充下字典序等于时间序（T0-02 已实测）。
  if (input.planEnd < input.planStart) {
    throw validationError('计划结束不能早于计划开始', [
      { field: 'planEnd', code: 'END_BEFORE_START' },
    ])
  }
}
