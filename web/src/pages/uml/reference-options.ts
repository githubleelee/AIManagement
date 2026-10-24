import { z } from 'zod'

export const referenceFields = ['goalIds', 'activityIds', 'storyIds', 'taskIds'] as const
export type ReferenceField = typeof referenceFields[number]
export const referenceLabels: Record<ReferenceField, string> = {
  goalIds: '业务目标', activityIds: '用户活动', storyIds: '用户故事', taskIds: '任务',
}
export type ReferenceOption = { id: string; label: string }
export type ReferenceOptions = Record<ReferenceField, ReferenceOption[]>
export const referenceIds = (text: string) => [...new Set(text.split(/[\s,，]+/).filter(Boolean))]
const id = z.string().min(1)
const story = z.object({ id, projectId: id, activityId: id, title: z.string() })
const activity = z.object({ id, projectId: id, goalId: id, name: z.string(), stories: z.array(story) })
const goals = z.object({ items: z.array(z.object({ id, projectId: id, name: z.string(), activities: z.array(activity) })) })
const tasks = z.object({ items: z.array(z.object({ id, projectId: id, storyId: id, title: z.string() })) })

/** Only consumes existing authenticated HTTP projections; never imports another domain's service. */
export function parseReferenceOptions(projectId: string, goalResponse: unknown, taskResponse: unknown): ReferenceOptions {
  const tree = goals.parse(goalResponse), taskList = tasks.parse(taskResponse)
  const result: ReferenceOptions = { goalIds: [], activityIds: [], storyIds: [], taskIds: [] }
  const seen: Record<ReferenceField, Set<string>> = { goalIds: new Set(), activityIds: new Set(), storyIds: new Set(), taskIds: new Set() }
  function add(field: ReferenceField, objectId: string, label: string, valid: boolean) {
    if (!valid || seen[field].has(objectId)) throw new Error('关联候选响应不属于当前项目或结构重复')
    seen[field].add(objectId)
    result[field].push({ id: objectId, label })
  }
  for (const goal of tree.items) {
    add('goalIds', goal.id, goal.name, goal.projectId === projectId)
    for (const item of goal.activities) {
      const prefix = `${goal.name} / ${item.name}`
      add('activityIds', item.id, prefix, item.projectId === projectId && item.goalId === goal.id)
      for (const child of item.stories) {
        add('storyIds', child.id, `${prefix} / ${child.title}`, child.projectId === projectId && child.activityId === item.id)
      }
    }
  }
  for (const task of taskList.items) add('taskIds', task.id, task.title, task.projectId === projectId)
  return result
}
