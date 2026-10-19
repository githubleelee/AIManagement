/**
 * US-04 故事看板（GitHub #25）—— 单张故事卡片。
 *
 * 字段（设计 §3）：标题为主，副标题显示 `goalName / activityName` 路径（缺失则省略），
 * 再显示优先级标签。**不含敏感标记**。
 *
 * 写入口（本地 #18，权限依据 `DECISIONS.md` `permissions.story-status-write`）：
 *   - **只对 PM 渲染**三态选择（`DRAFT` / `PLANNING` / `DONE`）；非 PM 只看到只读状态标签，
 *     服务端 `requirement.write` 仍是权威（非 PM 直连接口 403）；
 *   - 提交**只带 `{ status }`** 的 `PATCH /stories/:storyId`；
 *   - **不做拖拽**、不做乐观改写：成功后由页面重新拉取看板作为唯一真相；
 *   - 失败**就近**显示在本卡片内（不弹窗、不顶到页面级错误），文案口径见 `api.ts`。
 *
 * 优先级标签复用需求模块既有实现：`pages/requirement/terms.ts` 的 `PRIORITY_LABEL`
 * （与 `ProjectRequirementsPage.tsx` 的 `PriorityBadge` 同一张表、同一兜底口径），
 * 只是渲染节点用本票自己的 CSS，不把 `requirement.css` 整体拉进看板。
 */
import { useState } from 'react'
import { PRIORITY_LABEL, STORY_STATUS_LABEL, STORY_STATUS_ORDER } from '../requirement/terms'
import { boardWriteErrorMessage, updateStoryStatus } from './api'
import type { BoardStoryCard, StoryStatusValue } from './types'

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

/** 三态选择里的一枚选项（顺序取 `STORY_STATUS_ORDER`，与看板列序同源）。 */
const STATUS_OPTIONS: ReadonlyArray<{ value: StoryStatusValue; label: string }> =
  STORY_STATUS_ORDER.map((status) => ({ value: status, label: statusLabel(status) }))

type Props = {
  story: BoardStoryCard
  /** 是否渲染写控件。**仅 PM 为 true**；服务端权限仍是权威。 */
  canWrite: boolean
  /** 状态写入成功后的回调（由页面重新拉取看板 + 展示成功提示）。 */
  onStatusChanged: (message: string) => void
}

export default function StoryCard({ story, canWrite, onStatusChanged }: Props) {
  const path = storyPath(story)
  const statusClass = `board-status--${story.status.toLowerCase()}`
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(next: string) {
    const target = next as StoryStatusValue
    // 选回当前值 → 不发请求（后端会 200 但不写审计；这里干脆不发，省一次往返）
    if (target === story.status) return

    setBusy(true)
    setError(null)
    try {
      await updateStoryStatus(story.id, target)
      onStatusChanged(`已把「${story.title}」调整为${statusLabel(target)}。`)
    } catch (caught) {
      // 失败**就近**显示；不乐观改写本地状态，卡片仍显示服务端返回的旧状态
      setError(boardWriteErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

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
        {canWrite ? (
          <label className="board-status-select">
            <span className="board-status-select-label">状态</span>
            <select
              value={story.status}
              disabled={busy}
              onChange={(event) => {
                void handleChange(event.target.value)
              }}
              aria-label={`调整「${story.title}」的状态`}
            >
              {STATUS_OPTIONS.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className={`board-status ${statusClass}`}>{statusLabel(story.status)}</span>
        )}
      </div>
      {canWrite && error ? (
        <p className="board-card-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  )
}
