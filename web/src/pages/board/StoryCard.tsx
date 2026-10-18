/**
 * US-04 故事看板（GitHub #25）—— 单张只读故事卡片。
 *
 * 字段（设计 §3）：标题为主，副标题显示 `goalName / activityName` 路径（缺失则省略），
 * 再显示优先级标签。**不含敏感标记**、无任何写交互（本批只读）。
 *
 * 优先级标签复用需求模块既有实现：`pages/requirement/terms.ts` 的 `PRIORITY_LABEL`
 * （与 `ProjectRequirementsPage.tsx` 的 `PriorityBadge` 同一张表、同一兜底口径），
 * 只是渲染节点用本票自己的 CSS，不把 `requirement.css` 整体拉进看板。
 */
import { PRIORITY_LABEL, STORY_STATUS_LABEL } from '../requirement/terms'
import type { BoardStoryCard } from './types'

/** 已知优先级取界面标签；契约外取值回退为线上值原文（与需求模块同口径）。 */
function priorityLabel(priority: string): string {
  return (PRIORITY_LABEL as Readonly<Record<string, string>>)[priority] ?? priority
}

/** 状态标签：只接受故事三态，契约外取值显式标注「未知」（与需求模块同口径）。 */
function statusLabel(status: string): string {
  return (STORY_STATUS_LABEL as Readonly<Record<string, string>>)[status] ?? `${status}（未知）`
}

/** `goalName / activityName` 路径；两端缺失（或纯空白）则整体省略。 */
export function storyPath(card: BoardStoryCard): string {
  return [card.goalName, card.activityName]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part !== '')
    .join(' / ')
}

export default function StoryCard({ story }: { story: BoardStoryCard }) {
  const path = storyPath(story)
  const statusClass = `board-status--${story.status.toLowerCase()}`

  return (
    <article className="board-card">
      <h4 className="board-card-title">{story.title}</h4>
      {path ? (
        <p className="board-card-path" title={path}>
          {path}
        </p>
      ) : null}
      <div className="board-card-meta">
        <span className="board-priority" title={`优先级 ${story.priority}`}>
          {priorityLabel(story.priority)}
        </span>
        <span className={`board-status ${statusClass}`}>{statusLabel(story.status)}</span>
      </div>
    </article>
  )
}
