import { z } from 'zod'
import { apiFetch } from '../../api'

// Browser-owned transport DTOs. No imports from backend modules, Prisma, policy or crypto.
const id = z.string().min(1)
export const calendarDate = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
})
export const dateChange = z.object({ taskId: id, planStart: calendarDate, planEnd: calendarDate }).strict()
export type DateChangeDto = z.infer<typeof dateChange>
const changes = z.array(dateChange).min(1).superRefine((rows, ctx) => {
  if (new Set(rows.map((r) => r.taskId)).size !== rows.length || rows.some((r) => r.planStart > r.planEnd)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '日期倒置或重复任务' })
  }
})
const generation = z.object({
  requestId: id, status: z.enum(['SUCCEEDED', 'FAILED', 'TIMED_OUT']), generatedAt: z.string(),
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).strict().nullable(),
}).strict()
const receipt = z.object({
  id, status: z.enum(['GENERATION_FAILED', 'PENDING', 'DISPOSED', 'APPLIED', 'APPLICATION_FAILED']),
  disposition: z.enum(['PENDING', 'ACCEPTED', 'MODIFIED', 'REJECTED']),
  application: z.enum(['PENDING_DISPOSITION', 'NOT_APPLICABLE', 'PENDING_INTEGRATION', 'APPLIED', 'FAILED']),
}).strict()
export const summarySchema = receipt.extend({
  projectId: id,
  model: z.object({ provider: id, model: id, version: id, mode: z.enum(['STUB', 'API']), execution: z.enum(['LOCAL', 'EXTERNAL']) }).strict(),
  generation,
}).strict()
export const detailSchema = summarySchema.extend({
  sourceState: z.enum(['current', 'stale', 'unavailable']), changes: z.array(dateChange),
  tasks: z.array(z.object({ id, title: z.string(), planStart: calendarDate, planEnd: calendarDate }).strict()),
  reason: z.string().nullable(), finalChanges: z.array(dateChange).nullable(),
}).strict()
export type SchedulingDetailDto = z.infer<typeof detailSchema>
export const dispositionInput = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ACCEPTED'), note: z.string().trim().min(1).max(2000).optional() }).strict(),
  z.object({ status: z.literal('MODIFIED'), note: z.string().trim().min(1).max(2000), changes }).strict(),
  z.object({ status: z.literal('REJECTED'), note: z.string().trim().min(1).max(2000) }).strict(),
])
export type DispositionInputDto = z.infer<typeof dispositionInput>
export type Attempt = { suggestionId: string; requestId: string; input: DispositionInputDto }
/** Keep an unresolved attempt unchanged across network retries. Never invent a new key on retry. */
export function makeAttempt(suggestionId: string, input: DispositionInputDto, newId: () => string): Attempt {
  return { suggestionId, requestId: newId(), input: dispositionInput.parse(input) }
}
export const auditSchema = z.object({
  projectId: id, suggestionId: id, actorUserId: id, requestId: id,
  status: z.enum(['ACCEPTED', 'MODIFIED', 'REJECTED']), reason: z.string().nullable(), at: z.string(),
  before: z.array(dateChange), after: z.array(dateChange),
}).strict()
const diagnostic = z.object({ code: id, taskIds: z.array(id), message: z.string() }).strict()
export const assessmentSchema = z.object({
  state: z.enum(['ok', 'stale', 'invalid-changes', 'out-of-scope', 'unavailable']),
  assessment: z.object({
    canApplyDates: z.boolean(), blockers: z.array(diagnostic), warnings: z.array(diagnostic),
    workload: z.array(z.object({ userId: id, openTaskCount: z.number().int().nonnegative() }).strict()),
    scope: z.object({ label: z.string(), participatingTaskIds: z.array(id), taskCount: z.number().int().nonnegative() }).strict(),
  }).strict().nullable(),
}).strict()
export type AssessmentDto = z.infer<typeof assessmentSchema>
const pageSchema = z.object({ items: z.array(summarySchema), total: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(200), truncated: z.boolean() }).strict()
export type SchedulingPageDto = z.infer<typeof pageSchema>

/** Paths mirror C's unmounted plugin. B confirms/mounts the route; no probe or stub fallback. */
export function createSchedulingClient(projectId: string, request = apiFetch) {
  const base = `/projects/${encodeURIComponent(projectId)}/scheduling-suggestions`
  const item = (suggestionId: string) => `${base}/${encodeURIComponent(suggestionId)}`
  return {
    async list(signal?: AbortSignal) {
      const value = pageSchema.parse(await request(base, { signal }))
      if (value.items.some((row) => row.projectId !== projectId) || value.items.length > value.limit
        || value.total < value.items.length || value.truncated !== (value.total > value.items.length)) {
        throw new Error('排期列表归属或截断信息不一致')
      }
      return value
    },
    async get(suggestionId: string, signal?: AbortSignal) {
      const value = detailSchema.parse(await request(item(suggestionId), { signal }))
      if (value.projectId !== projectId || value.id !== suggestionId) throw new Error('排期响应归属不一致')
      return value
    },
    async generate(requestId: string, signal?: AbortSignal) {
      const value = z.object({ id, status: receipt.shape.status, generation }).strict().parse(await request(base, {
        method: 'POST', body: JSON.stringify({ requestId }), signal,
      }))
      if (value.generation.requestId !== requestId) throw new Error('生成请求关联不一致')
      return value
    },
    async dispose(attempt: Attempt, signal?: AbortSignal) {
      const body = { ...dispositionInput.parse(attempt.input), requestId: attempt.requestId }
      const value = receipt.parse(await request(`${item(attempt.suggestionId)}/disposition`, { method: 'POST', body: JSON.stringify(body), signal }))
      if (value.id !== attempt.suggestionId) throw new Error('排期响应归属不一致')
      return value
    },
    async assess(suggestionId: string, proposed: DateChangeDto[], signal?: AbortSignal) {
      return assessmentSchema.parse(await request(`${item(suggestionId)}/assessment`, {
        method: 'POST', body: JSON.stringify({ changes: changes.parse(proposed) }), signal,
      }))
    },
    async audit(suggestionId: string, signal?: AbortSignal) {
      const value = z.object({ items: z.array(auditSchema) }).strict().parse(await request(`${item(suggestionId)}/audit`, { signal }))
      if (value.items.some((entry) => entry.projectId !== projectId || entry.suggestionId !== suggestionId)) throw new Error('审计响应归属不一致')
      return value.items
    },
  }
}
export type SchedulingClient = ReturnType<typeof createSchedulingClient>
