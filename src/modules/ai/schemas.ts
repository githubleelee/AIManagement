import { z } from 'zod'

export const breakdownItemSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(1000),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
  sourceTrace: z.array(z.string().trim().min(1).max(80)).min(1).max(10),
})

export const breakdownSuggestionSchema = z.object({
  summary: z.string().trim().min(1).max(1000),
  workItems: z.array(breakdownItemSchema).min(1).max(20),
})

export const reviewSuggestionSchema = z
  .object({
    requestId: z.string().trim().min(1).max(128),
    decision: z.enum(['ACCEPTED', 'MODIFIED', 'REJECTED']),
    note: z.string().trim().max(1000).optional(),
    modifiedSuggestion: breakdownSuggestionSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.decision === 'MODIFIED' && value.modifiedSuggestion === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['modifiedSuggestion'],
        message: '修改后采纳时必须提交修改后的建议',
      })
    }
    if ((value.decision === 'MODIFIED' || value.decision === 'REJECTED') && !value.note?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: '修改后采纳或拒绝时必须填写理由',
      })
    }
  })

export type ReviewSuggestionInput = z.infer<typeof reviewSuggestionSchema>
