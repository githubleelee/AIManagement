/**
 * M1 身份与会话 —— 请求校验（T0-04）
 *
 * 契约依据
 *   - 决策 I-2b：单字段形状（必填 / 格式）由 Zod schema 负责，产出 REQUIRED。
 *   - 决策 I-8 端点 1：`{ account: string, password: string }`
 *     → 422 VALIDATION_FAILED（account / password: REQUIRED）。
 *
 * 归属说明（决策 I-0）：本文件是 `src/auth/` 内的新增文件，属 M1 独占，不触碰冻结文件。
 */
import * as z from 'zod'
import { toFieldErrors } from '../shared/validation.js'
import { AppError } from '../shared/errors.js'
import type { FieldError } from '../shared/types.js'

/**
 * 登录请求体 { account: string, password: string }。
 *
 * `.min(1)` 拦住空字符串；纯空白账号（如 `"   "`）长度不为 0，会通过 Zod，
 * 由处理器 trim 后判空并抛 REQUIRED（与 M4/M2 的分工一致）。
 */
export const loginSchema = z.object({
  account: z.string().min(1),
  password: z.string().min(1),
})

export type LoginInput = z.infer<typeof loginSchema>

// ---------------------------------------------------------------------------
// 校验助手（模块私有；与 M4 requirement/schemas.ts 同构，不跨模块引用）
// ---------------------------------------------------------------------------

/** 把 Zod 校验失败转成契约决策 I-4 的 `422 VALIDATION_FAILED`。 */
export function validationFailed(issues: z.ZodIssue[], message = '字段校验失败'): never {
  throw new AppError(422, 'VALIDATION_FAILED', message, toFieldErrors(issues))
}

/** 解析请求体；失败即抛 `422 VALIDATION_FAILED` 并带上字段级错误码。 */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) {
    validationFailed(result.error.issues)
  }
  return result.data
}

/** 构造单条字段级错误。 */
export function fieldError(field: string, code: FieldError['code']): FieldError {
  return { field, code }
}

/** 用已给定的字段级错误抛出 `422 VALIDATION_FAILED`。 */
export function validationFailedWith(details: FieldError[], message = '字段校验失败'): never {
  throw new AppError(422, 'VALIDATION_FAILED', message, details)
}
