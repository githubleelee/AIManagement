/**
 * 共享校验器单测（T0-01）
 *
 * 对齐决策 I-2b：5 个 Zod 枚举、dateSchema、toFieldErrors 的字段错误码映射。
 *
 * 重点（探针 1）：穷举契约列出的 5 种 Zod issue 码到字段码的映射，
 * 并确认「未列出的 issue 码」落到 INVALID_VALUE 兜底分支。
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  dateSchema,
  goalStatusSchema,
  prioritySchema,
  projectRoleSchema,
  storyStatusSchema,
  taskStatusSchema,
  toFieldErrors,
} from '../src/shared/validation.js'

describe('5 个 Zod 枚举', () => {
  it('接受契约规定的线上常量', () => {
    expect(projectRoleSchema.safeParse('PM').success).toBe(true)
    expect(projectRoleSchema.safeParse('MEMBER').success).toBe(true)
    expect(projectRoleSchema.safeParse('VIEWER').success).toBe(true)

    expect(goalStatusSchema.safeParse('ACTIVE').success).toBe(true)
    expect(goalStatusSchema.safeParse('DONE').success).toBe(true)

    expect(storyStatusSchema.safeParse('DRAFT').success).toBe(true)
    expect(storyStatusSchema.safeParse('PLANNING').success).toBe(true)
    expect(storyStatusSchema.safeParse('DONE').success).toBe(true)

    expect(prioritySchema.safeParse('P0').success).toBe(true)
    expect(taskStatusSchema.safeParse('TODO').success).toBe(true)
    expect(taskStatusSchema.safeParse('DOING').success).toBe(true)
  })

  it('拒绝中文界面标签与非法取值', () => {
    expect(projectRoleSchema.safeParse('项目经理').success).toBe(false)
    expect(prioritySchema.safeParse('P9').success).toBe(false)
    expect(taskStatusSchema.safeParse('BLOCKED').success).toBe(false)
    expect(goalStatusSchema.safeParse('进行中').success).toBe(false)
    expect(storyStatusSchema.safeParse('planning').success).toBe(false)
  })

  it('三个含 DONE 的枚举彼此独立地校验各自取值集合', () => {
    // GoalStatus 只有 ACTIVE / DONE
    expect(goalStatusSchema.safeParse('DRAFT').success).toBe(false)
    expect(goalStatusSchema.safeParse('TODO').success).toBe(false)
    // StoryStatus 只有 DRAFT / PLANNING / DONE
    expect(storyStatusSchema.safeParse('ACTIVE').success).toBe(false)
    expect(storyStatusSchema.safeParse('DOING').success).toBe(false)
    // TaskStatus 只有 TODO / DOING / DONE
    expect(taskStatusSchema.safeParse('ACTIVE').success).toBe(false)
    expect(taskStatusSchema.safeParse('PLANNING').success).toBe(false)
  })
})

describe('dateSchema', () => {
  it('只接受 YYYY-MM-DD', () => {
    expect(dateSchema.safeParse('2026-09-19').success).toBe(true)
    expect(dateSchema.safeParse('2026/09/19').success).toBe(false)
    expect(dateSchema.safeParse('2026-9-9').success).toBe(false)
    expect(dateSchema.safeParse('2026-09-19T00:00:00Z').success).toBe(false)
  })
})

describe('toFieldErrors：Zod issue → 字段级错误码', () => {
  /** 便捷函数：解析失败后取出 { field: code } 映射。 */
  function mapErrors(schema: z.ZodTypeAny, input: unknown): Record<string, string> {
    const result = schema.safeParse(input)
    expect(result.success).toBe(false)
    if (result.success) return {}
    return Object.fromEntries(toFieldErrors(result.error.issues).map((e) => [e.field, e.code]))
  }

  it('invalid_type（类型错误 / 必填缺失）→ REQUIRED', () => {
    const schema = z.object({ name: z.string() })
    expect(mapErrors(schema, { name: 123 }).name).toBe('REQUIRED')
  })

  it('too_small（字符串空值）→ REQUIRED', () => {
    const schema = z.object({ name: z.string().min(1) })
    expect(mapErrors(schema, { name: '' }).name).toBe('REQUIRED')
  })

  it('too_small（数组为空）→ REQUIRED', () => {
    const schema = z.object({ visibleMemberIds: z.array(z.string()).min(1) })
    expect(mapErrors(schema, { visibleMemberIds: [] }).visibleMemberIds).toBe('REQUIRED')
  })

  it('too_big（超长）→ TOO_LONG', () => {
    const schema = z.object({ name: z.string().max(3) })
    expect(mapErrors(schema, { name: 'abcd' }).name).toBe('TOO_LONG')
  })

  it('invalid_enum_value → INVALID_VALUE', () => {
    const schema = z.object({ role: projectRoleSchema })
    expect(mapErrors(schema, { role: 'ADMIN' }).role).toBe('INVALID_VALUE')
  })

  it('invalid_string（正则不匹配）→ INVALID_FORMAT', () => {
    const schema = z.object({ planStart: dateSchema })
    expect(mapErrors(schema, { planStart: '2026/09/19' }).planStart).toBe('INVALID_FORMAT')
  })

  it('invalid_string（邮箱等其它字符串校验）→ INVALID_FORMAT', () => {
    const schema = z.object({ account: z.string().email() })
    expect(mapErrors(schema, { account: 'not-an-email' }).account).toBe('INVALID_FORMAT')
  })

  // 探针 1 的关键分支：契约未列出的 issue 码必须落入 INVALID_VALUE 兜底
  it('未列出的 issue 码（invalid_literal）→ INVALID_VALUE 兜底', () => {
    const schema = z.object({ kind: z.literal('a') })
    expect(mapErrors(schema, { kind: 'b' }).kind).toBe('INVALID_VALUE')
  })

  it('未列出的 issue 码（unrecognized_keys）→ INVALID_VALUE 兜底', () => {
    const schema = z.object({}).strict()
    const result = schema.safeParse({ unexpected: 1 })
    expect(result.success).toBe(false)
    if (result.success) return
    const errors = toFieldErrors(result.error.issues)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe('INVALID_VALUE')
  })

  it('field 为 issue.path 以点号连接，数组下标保留（items.0）', () => {
    const schema = z.object({ items: z.array(z.string()) })
    expect(mapErrors(schema, { items: [1] })['items.0']).toBe('REQUIRED')
  })

  it('空 issues 返回空数组', () => {
    expect(toFieldErrors([])).toEqual([])
  })

  it('综合 schema：REQUIRED / TOO_LONG / INVALID_FORMAT / INVALID_VALUE 同时映射', () => {
    const schema = z.object({
      name: z.string().min(1),
      title: z.string().min(1).max(3),
      planStart: dateSchema,
      priority: prioritySchema,
    })

    const result = schema.safeParse({
      name: '',
      title: 'abcd',
      planStart: '2026/09/19',
      priority: 'P9',
    })

    expect(result.success).toBe(false)
    if (result.success) return

    const byField = Object.fromEntries(
      toFieldErrors(result.error.issues).map((e) => [e.field, e.code]),
    )

    expect(byField.name).toBe('REQUIRED')
    expect(byField.title).toBe('TOO_LONG')
    expect(byField.planStart).toBe('INVALID_FORMAT')
    expect(byField.priority).toBe('INVALID_VALUE')
  })

  it('缺失必填字段映射为 REQUIRED 且 field 为字段名', () => {
    const schema = z.object({
      name: z.string().min(1),
      planStart: dateSchema,
    })
    const result = schema.safeParse({})
    expect(result.success).toBe(false)
    if (result.success) return

    const errors = toFieldErrors(result.error.issues)
    expect(errors).toContainEqual({ field: 'name', code: 'REQUIRED' })
    expect(errors).toContainEqual({ field: 'planStart', code: 'REQUIRED' })
  })
})
