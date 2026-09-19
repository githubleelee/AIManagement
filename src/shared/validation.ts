// 共享 Zod 校验器与字段错误码桥接（接口契约决策 I-2b，冻结）
import { z } from 'zod'
import type { FieldError } from './errors'

export const projectRoleSchema = z.enum(['PM', 'MEMBER', 'VIEWER'])
export const goalStatusSchema = z.enum(['ACTIVE', 'DONE'])
export const storyStatusSchema = z.enum(['DRAFT', 'PLANNING', 'DONE'])
export const prioritySchema = z.enum(['P0', 'P1', 'P2'])
export const taskStatusSchema = z.enum(['TODO', 'DOING', 'DONE'])
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

// 业务规则错误（需要查库或跳字段比较）一律由处理器主动抛 AppError，
// 不塞进 schema —— schema 不得依赖数据库（见决策 I-2b）。
