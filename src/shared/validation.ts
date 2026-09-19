/**
 * 共享契约 —— Zod 校验器与字段错误码桥接（冻结）
 *
 * 权威来源：`docs/sprint1-spec-interface-contract.md` 决策 I-2b。
 *
 * 职责边界（关键）：
 *   - 单字段形状（必填 / 长度 / 格式 / 枚举取值）由本文件的 Zod schema 负责，
 *     产出 REQUIRED / TOO_LONG / INVALID_FORMAT / INVALID_VALUE。
 *   - 业务规则（跳字段比较、需查库）由处理器主动抛出 AppError，产出
 *     ACCEPTOR_EQUALS_OWNER / END_BEFORE_START / HAS_CHILDREN 等。
 *     业务规则不塞进 Zod，避免 schema 依赖数据库、破坏测试独立性。
 */
import { z } from 'zod'
import type { FieldError } from './types.js'

export const projectRoleSchema = z.enum(['PM', 'MEMBER', 'VIEWER'])
export const goalStatusSchema = z.enum(['ACTIVE', 'DONE'])
export const storyStatusSchema = z.enum(['DRAFT', 'PLANNING', 'DONE'])
export const prioritySchema = z.enum(['P0', 'P1', 'P2'])
export const taskStatusSchema = z.enum(['TODO', 'DOING', 'DONE'])

/** 日期固定格式 `YYYY-MM-DD`（决策 I-10：不接受其它格式） */
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

// Zod issue → 决策 I-4 的字段级错误码
export function toFieldErrors(issues: z.ZodIssue[]): FieldError[] {
  return issues.map((issue) => ({
    field: issue.path.join('.'),
    code:
      issue.code === 'invalid_type'
        ? 'REQUIRED'
        : issue.code === 'too_small'
          ? 'REQUIRED'
          : issue.code === 'too_big'
            ? 'TOO_LONG'
            : issue.code === 'invalid_enum_value'
              ? 'INVALID_VALUE'
              : issue.code === 'invalid_string'
                ? 'INVALID_FORMAT'
                : 'INVALID_VALUE',
  }))
}
