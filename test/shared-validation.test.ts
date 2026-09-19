/**
 * 共享校验器单测（T0-01）
 *
 * 对齐决策 I-2b：5 个 Zod 枚举、dateSchema、toFieldErrors 的字段错误码映射。
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

    expect(prioritySchema.safeParse('P0').success).toBe(true)
    expect(taskStatusSchema.safeParse('TODO').success).toBe(true)
  })

  it('拒绝中文界面标签与非法取值', () => {
    expect(projectRoleSchema.safeParse('项目经理').success).toBe(false)
    expect(prioritySchema.safeParse('P9').success).toBe(false)
    expect(taskStatusSchema.safeParse('BLOCKED').success).toBe(false)
  })
})

describe('dateSchema', () => {
  it('只接受 YYYY-MM-DD', () => {
    expect(dateSchema.safeParse('2026-09-19').success).toBe(true)
    expect(dateSchema.safeParse('2026/09/19').success).toBe(false)
    expect(dateSchema.safeParse('2026-9-9').success).toBe(false)
  })
})

describe('toFieldErrors：Zod issue → 字段级错误码', () => {
  const schema = z.object({
    name: z.string().min(1),
    title: z.string().min(1).max(3),
    planStart: dateSchema,
    priority: prioritySchema,
  })

  it('映射 REQUIRED / TOO_LONG / INVALID_FORMAT / INVALID_VALUE', () => {
    const result = schema.safeParse({
      name: '',
      title: 'abcd',
      planStart: '2026/09/19',
      priority: 'P9',
    })

    expect(result.success).toBe(false)
    if (result.success) return

    const errors = toFieldErrors(result.error.issues)
    const byField = Object.fromEntries(errors.map((e) => [e.field, e.code]))

    expect(byField.name).toBe('REQUIRED')
    expect(byField.title).toBe('TOO_LONG')
    expect(byField.planStart).toBe('INVALID_FORMAT')
    expect(byField.priority).toBe('INVALID_VALUE')
  })

  it('缺失必填字段映射为 REQUIRED 且 field 为字段名', () => {
    const result = schema.safeParse({ title: 'ok' })
    expect(result.success).toBe(false)
    if (result.success) return

    const errors = toFieldErrors(result.error.issues)
    expect(errors).toContainEqual({ field: 'name', code: 'REQUIRED' })
    expect(errors).toContainEqual({ field: 'planStart', code: 'REQUIRED' })
  })
})
