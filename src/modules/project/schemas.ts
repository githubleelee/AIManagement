/**
 * M2 项目与成员 —— 请求校验（US-01 / T1.1–T1.7）
 *
 * 契约依据
 *   - 决策 I-2b「职责边界」：**单字段形状**（必填 / 长度 / 格式 / 枚举取值）由本文件的
 *     Zod schema 负责，产出 REQUIRED / TOO_LONG / INVALID_FORMAT / INVALID_VALUE。
 *   - 决策 I-4「字段级错误码」：字段级错误码只出现在 `ErrorResponse.error.details[].code`。
 *
 * 归属说明（决策 I-0）
 *   本文件是 `src/modules/project/` 内的新增文件，属 M2 独占，不触碰任何冻结文件。
 *
 * ⚠️ 长度上限的出处
 *   契约只规定了错误码 `TOO_LONG`，**没有规定数值**（决策 I-2b 表里仅以「name（50）」举例）。
 *   因此这里的 50 是按契约示例取值，不是从文档推导出的硬性要求。
 */
import * as z from 'zod'
import { projectRoleSchema, toFieldErrors } from '../../shared/validation.js'
import { AppError } from '../../shared/errors.js'
import type { FieldError } from '../../shared/types.js'

// ---------------------------------------------------------------------------
// 长度上限（见文件头「长度上限的出处」）
// ---------------------------------------------------------------------------

/** 项目名称上限。契约未规定数值，按决策 I-2b 的示例「name（50）」取 50。 */
export const PROJECT_NAME_MAX_LENGTH = 50

// ---------------------------------------------------------------------------
// 端点 3 —— POST /projects
// ---------------------------------------------------------------------------

/**
 * 创建项目请求体 { name: string, description?: string }。
 *
 * 关于 `.min(1)` 与处理器里 `trim() === ''` 检查的分工（与 M4 一致）：
 *   - Zod 的 `.min(1)` 拦住**空字符串**，产出 `too_small` → 契约要求的 `REQUIRED`；
 *   - 纯空白（如 `"   "`）长度不为 0，会通过 Zod，必须由处理器 `trim()` 后判空，
 *     用 `validationFailedWith([fieldError('name', 'REQUIRED')])` 补齐。
 */
export const createProjectSchema = z.object({
  name: z.string().min(1).max(PROJECT_NAME_MAX_LENGTH),
  description: z.string().optional(),
})

export type CreateProjectInput = z.infer<typeof createProjectSchema>

// ---------------------------------------------------------------------------
// 端点 6 —— POST /projects/:projectId/members
// ---------------------------------------------------------------------------

/**
 * 添加成员请求体 { account: string, role: ProjectRole }。
 *
 * 纯空白账号同理由处理器 trim 后判空（REQUIRED）；账号不存在由处理器查库后
 * 抛 `USER_NOT_FOUND`（属业务规则，不塞进 schema）。
 */
export const addMemberSchema = z.object({
  account: z.string().min(1),
  role: projectRoleSchema,
})

export type AddMemberInput = z.infer<typeof addMemberSchema>

// ---------------------------------------------------------------------------
// 端点 8 —— PATCH /projects/:projectId/members/:userId
// ---------------------------------------------------------------------------

/** 修改角色请求体 { role: ProjectRole }。非法取值产出 `INVALID_VALUE`。 */
export const updateMemberRoleSchema = z.object({ role: projectRoleSchema })

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>

// ---------------------------------------------------------------------------
// 校验助手（与 M4 的 requirement/schemas.ts 同构；模块私有，不跨模块引用）
// ---------------------------------------------------------------------------

/** 把 Zod 校验失败转成契约决策 I-4 的 `422 VALIDATION_FAILED`。 */
export function validationFailed(issues: z.ZodIssue[], message = '字段校验失败'): never {
  throw new AppError(422, 'VALIDATION_FAILED', message, toFieldErrors(issues))
}

/**
 * 解析请求体；失败即抛 `422 VALIDATION_FAILED` 并带上字段级错误码。
 *
 * 之所以用 `.safeParse()` 而不是 Zod 的 `parse()`：后者的 `ZodError` 是另一种异常类型，
 * 显式转成 `AppError` 可以保证错误出口只有一条、语义稳定。
 */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) {
    validationFailed(result.error.issues)
  }
  return result.data
}

/** 构造单条字段级错误，供处理器主动抛业务规则错误时使用（决策 I-2b）。 */
export function fieldError(field: string, code: FieldError['code']): FieldError {
  return { field, code }
}

/** 用**已给定**的字段级错误抛出 `422 VALIDATION_FAILED`（纯空白等 Zod 表达不了的形状）。 */
export function validationFailedWith(details: FieldError[], message = '字段校验失败'): never {
  throw new AppError(422, 'VALIDATION_FAILED', message, details)
}
