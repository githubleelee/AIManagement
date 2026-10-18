import { z } from 'zod'
import { taskStatusSchema } from '../../shared/validation.js'

/** Module-local proposal only: not the frozen #31/#26/#27 wire contract. */
export const calendarDateSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, '日期必须为有效的 YYYY-MM-DD 自然日')

const id = z.string().trim().min(1)
export const schedulingTaskSchema = z.object({
  id, projectId: id, title: z.string(), ownerUserId: id, acceptorUserId: id,
  status: taskStatusSchema, planStart: calendarDateSchema, planEnd: calendarDateSchema,
  isSensitive: z.boolean(),
}).strict()

export const schedulingSnapshotSchema = z.object({
  projectId: id,
  // Must be supplied by the future authorized adapter; never a client-issued lock.
  revision: id,
  capturedAt: z.string().datetime(),
  memberIds: z.array(id),
  tasks: z.array(schedulingTaskSchema),
  dependencies: z.array(z.object({ predecessorId: id, successorId: id }).strict()),
  milestones: z.array(z.object({ id, taskIds: z.array(id), date: calendarDateSchema }).strict()),
}).strict()

export const dateChangeSchema = z.object({
  taskId: id, planStart: calendarDateSchema, planEnd: calendarDateSchema,
}).strict()
export const dateChangesSchema = z.array(dateChangeSchema).min(1)
export const assessmentRequestSchema = z.object({
  snapshot: schedulingSnapshotSchema, changes: dateChangesSchema,
}).strict()

export type SchedulingSnapshot = z.infer<typeof schedulingSnapshotSchema>
export type SchedulingTask = z.infer<typeof schedulingTaskSchema>
export type DateChange = z.infer<typeof dateChangeSchema>
export type SchedulingAssessment = {
  canApplyDates: boolean
  blockers: Array<{ code: string; taskIds: string[]; message: string }>
  warnings: Array<{ code: string; taskIds: string[]; message: string }>
  workload: Array<{ userId: string; openTaskCount: number }>
  scope: { label: string; participatingTaskIds: string[]; taskCount: number }
}
