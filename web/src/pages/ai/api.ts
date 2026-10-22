import type {
  AiReviewDecision,
  RequirementBreakdownRecord,
  RequirementBreakdownSuggestion,
} from '../../../../src/modules/ai/contracts'
import { apiFetch } from '../../api'

export function listAiSuggestions(projectId: string, storyId: string) {
  return apiFetch<{ items: RequirementBreakdownRecord[] }>(
    `/projects/${projectId}/stories/${storyId}/ai-suggestions`,
  )
}

export function generateAiSuggestion(projectId: string, storyId: string) {
  return apiFetch<RequirementBreakdownRecord>(
    `/projects/${projectId}/stories/${storyId}/ai-suggestions`,
    { method: 'POST' },
  )
}

export function reviewAiSuggestion(
  projectId: string,
  storyId: string,
  suggestionId: string,
  input: {
    requestId: string
    decision: AiReviewDecision
    note?: string
    modifiedSuggestion?: RequirementBreakdownSuggestion
  },
) {
  return apiFetch<RequirementBreakdownRecord>(
    `/projects/${projectId}/stories/${storyId}/ai-suggestions/${suggestionId}/disposition`,
    { method: 'POST', body: JSON.stringify(input) },
  )
}
