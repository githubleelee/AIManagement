/**
 * US-06 甘特图（GitHub #26）—— 统一时间轴（故事行可展开到任务行）。
 *
 * 纯 CSS 时间条，不引入任何图表库：把项目内所有**可见任务/故事**的
 * `planStart/planEnd` 归到一个整体 min~max，按百分比定位每行的计划区间条。
 *
 * 口径（设计 §4 / §5）：
 *   - 故事 `planStart/planEnd` 是**候选汇总**（`candidate-minmax`），日期存在时
 *     必须同时标注「候选汇总口径（待确认）」；
 *   - 故事 `progress` 恒为 null（`progressState='unconfirmed'`），**显示
 *     「进度口径未确认」而不是 0%** —— 把"还没定"显示成"0%"是本仓库已登记过的问题；
 *   - 日期缺失（`null`）不画条，显示「未排期」；
 *   - `planStart > planEnd` 属异常历史数据，按设计 §4.3 **标记**、不静默修正；
 *   - 状态标签复用既有实现（`TASK_STATUS_LABEL` / `STORY_STATUS_LABEL`），
 *     **`DONE` 不得显示为「已完成/关闭」**：任务 `DONE` 沿用既有「待验收」，
 *     故事 `DONE` 沿用需求模块既有故事标签（那是故事自己的语义，与任务 `DONE`
 *     不可互相赋值 —— 决策 I-1 的"三个 DONE 陷阱"）。
 */
import { useState } from 'react'
import type { CSSProperties } from 'react'
import EmptyState from '../../components/EmptyState'
import { STORY_STATUS_LABEL } from '../requirement/terms'
import { TASK_STATUS_LABEL } from '../task/TaskStatusBadge'
import type { GanttStory } from './types'

const DAY_MS = 86_400_000
const KNOWN_TASK_STATUSES = new Set(Object.keys(TASK_STATUS_LABEL))

/** 'YYYY-MM-DD' → 天序号（UTC 基准）。非法 / 空值返回 null。 */
function toDay(value: string | null | undefined): number | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(time) ? null : Math.round(time / DAY_MS)
}

/** 天序号 → 'YYYY-MM-DD'。 */
function fromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

/** 任务状态文案：复用既有表，未知值原样显示（不猜成「已完成」）。 */
function taskStatusLabel(status: string): string {
  return status in TASK_STATUS_LABEL
    ? TASK_STATUS_LABEL[status as keyof typeof TASK_STATUS_LABEL]
    : status
}

/** CSS 类后缀：仅已知状态用其小写名，未知统一进 unknown。 */
function taskStatusClass(status: string): string {
  return KNOWN_TASK_STATUSES.has(status) ? status.toLowerCase() : 'unknown'
}

/** 计划日期倒置（仅两者都在时可判定）。 */
function isInverted(start: string | null, end: string | null): boolean {
  const s = toDay(start)
  const e = toDay(end)
  return s !== null && e !== null && s > e
}

type Axis = { start: number; end: number; total: number }

/** 按可见故事/任务的日期求整体 min~max；无任何有效日期返回 null。 */
function computeAxis(stories: GanttStory[]): Axis | null {
  const days: number[] = []
  const push = (value: string | null) => {
    const day = toDay(value)
    if (day !== null) days.push(day)
  }
  for (const story of stories) {
    push(story.planStart)
    push(story.planEnd)
    for (const task of story.tasks ?? []) {
      push(task.planStart)
      push(task.planEnd)
    }
  }
  if (days.length === 0) return null
  const start = Math.min(...days)
  const end = Math.max(...days)
  // 起止日均计入（自然日、含周末，设计 §4.1），故按「日格」个数归一。
  return { start, end, total: end - start + 1 }
}

/** 计划区间的百分比定位（日格包含端点）；两个日期都缺失返回 null（不画条）。 */
function barStyle(
  start: string | null,
  end: string | null,
  axis: Axis,
): CSSProperties | null {
  const s = toDay(start)
  const e = toDay(end)
  if (s === null && e === null) return null
  const a = s ?? (e as number)
  const b = e ?? (s as number)
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return {
    left: `${((lo - axis.start) / axis.total) * 100}%`,
    width: `${((hi - lo + 1) / axis.total) * 100}%`,
  }
}

function planText(start: string | null, end: string | null): string {
  if (!start && !end) return '未排期'
  return `计划 ${start ?? '—'} ~ ${end ?? '—'}`
}

export default function GanttTimeline({ stories }: { stories: GanttStory[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const axis = computeAxis(stories)

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (stories.length === 0) {
    return (
      <EmptyState
        level={3}
        title="本项目暂无故事"
        hint="故事创建后，这里会按统一时间轴显示故事及其任务计划。"
      />
    )
  }

  return (
    <div className="gantt-timeline">
      <div className="gantt-axis">
        <span className="gantt-axis-label">故事 / 任务</span>
        <div className="gantt-axis-range">
          {axis ? (
            <>
              <span className="gantt-axis-date">{fromDay(axis.start)}</span>
              <span className="gantt-axis-hint">统一时间轴（自然日，含周末）</span>
              <span className="gantt-axis-date">{fromDay(axis.end)}</span>
            </>
          ) : (
            <span className="gantt-axis-hint">暂无可排期的日期</span>
          )}
        </div>
      </div>

      {stories.map((story) => {
        const tasks = story.tasks ?? []
        const open = expanded.has(story.id)
        const bar = axis ? barStyle(story.planStart, story.planEnd, axis) : null
        const hasDates = Boolean(story.planStart || story.planEnd)
        const inverted = isInverted(story.planStart, story.planEnd)

        return (
          <div className="gantt-story-block" key={story.id}>
            <div className="gantt-row gantt-row--story">
              <div className="gantt-cell">
                <button
                  type="button"
                  className="gantt-toggle"
                  onClick={() => toggle(story.id)}
                  aria-expanded={open}
                  aria-label={`${open ? '收起' : '展开'}故事「${story.title}」的任务`}
                >
                  {open ? '▾' : '▸'}
                </button>
                <div className="gantt-cell-main">
                  <div className="gantt-title-line">
                    <span className="gantt-title">{story.title}</span>
                    <span
                      className={`gantt-badge gantt-story-status gantt-story-status--${story.status.toLowerCase()}`}
                    >
                      {STORY_STATUS_LABEL[story.status]}
                    </span>
                  </div>
                  <div className="gantt-meta">
                    {hasDates ? (
                      <>
                        <span>{planText(story.planStart, story.planEnd)}</span>
                        <span className="gantt-note">候选汇总口径（待确认）</span>
                      </>
                    ) : null}
                    {inverted ? <span className="gantt-warn">日期倒置（异常）</span> : null}
                    <span className="gantt-note">进度口径未确认</span>
                  </div>
                </div>
              </div>
              <div className="gantt-track">
                {bar ? (
                  <span className="gantt-bar gantt-bar--story" style={bar} />
                ) : (
                  <span className="gantt-unscheduled">未排期</span>
                )}
              </div>
            </div>

            {open ? (
              tasks.length === 0 ? (
                <div className="gantt-row gantt-row--task gantt-row--empty">
                  <div className="gantt-cell gantt-cell--task">
                    <span className="gantt-empty">该故事下暂无可见任务</span>
                  </div>
                </div>
              ) : (
                tasks.map((task) => {
                  const taskBar = axis ? barStyle(task.planStart, task.planEnd, axis) : null
                  const taskInverted = isInverted(task.planStart, task.planEnd)
                  return (
                    <div className="gantt-row gantt-row--task" key={task.id}>
                      <div className="gantt-cell gantt-cell--task">
                        <div className="gantt-cell-main">
                          <div className="gantt-title-line">
                            <span className="gantt-title">{task.title}</span>
                            <span
                              className={`gantt-badge gantt-task-status gantt-task-status--${taskStatusClass(task.status)}`}
                            >
                              {taskStatusLabel(task.status)}
                            </span>
                          </div>
                          <div className="gantt-meta">
                            <span>负责人：{task.ownerDisplayName}</span>
                            <span>{planText(task.planStart, task.planEnd)}</span>
                            {taskInverted ? (
                              <span className="gantt-warn">日期倒置（异常）</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="gantt-track">
                        {taskBar ? (
                          <span className="gantt-bar gantt-bar--task" style={taskBar} />
                        ) : (
                          <span className="gantt-unscheduled">未排期</span>
                        )}
                      </div>
                    </div>
                  )
                })
              )
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
