import { useCallback, useEffect, useState } from 'react'
import type {
  RequirementBreakdownRecord,
  RequirementBreakdownSuggestion,
} from '../../../../src/modules/ai/contracts'
import { ApiError } from '../../api'
import { generateAiSuggestion, listAiSuggestions, reviewAiSuggestion } from './api'
import './ai-breakdown.css'

export type AiBreakdownPanelProps = {
  projectId: string
  storyId: string
  /** 权限负责人提供的服务端权限在前端的展示结果；隐藏按钮不替代服务端校验。 */
  canRead: boolean
  canGenerate: boolean
  canReview: boolean
}

type Notice = { tone: 'ok' | 'warn'; text: string }

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function decisionLabel(decision: Exclude<RequirementBreakdownRecord['disposition']['status'], 'PENDING'>): string {
  if (decision === 'ACCEPTED') return '采纳'
  if (decision === 'MODIFIED') return '修改后采纳'
  return '拒绝'
}

export default function AiBreakdownPanel({
  projectId,
  storyId,
  canRead,
  canGenerate,
  canReview,
}: AiBreakdownPanelProps) {
  const [records, setRecords] = useState<RequirementBreakdownRecord[]>([])
  const [loading, setLoading] = useState(canRead)
  const [workingId, setWorkingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<RequirementBreakdownSuggestion | null>(null)

  const load = useCallback(async () => {
    if (!canRead) {
      setRecords([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const result = await listAiSuggestions(projectId, storyId)
      setRecords(result.items)
    } catch (error) {
      const message = error instanceof ApiError ? error.message : String(error)
      setNotice({ tone: 'warn', text: `AI 建议加载失败：${message}` })
    } finally {
      setLoading(false)
    }
  }, [canRead, projectId, storyId])

  useEffect(() => {
    void load()
  }, [load])

  async function generate() {
    setWorkingId('generate')
    setNotice(null)
    try {
      const created = await generateAiSuggestion(projectId, storyId)
      setRecords(previous => [created, ...previous])
      setNotice({ tone: 'ok', text: '已生成本地建议。它尚未写入任何正式任务。' })
    } catch (error) {
      const message = error instanceof ApiError ? error.message : String(error)
      setNotice({ tone: 'warn', text: message })
    } finally {
      setWorkingId(null)
    }
  }

  async function review(
    record: RequirementBreakdownRecord,
    decision: 'ACCEPTED' | 'MODIFIED' | 'REJECTED',
  ) {
    setWorkingId(record.id)
    setNotice(null)
    try {
      const updated = await reviewAiSuggestion(projectId, storyId, record.id, {
        requestId: crypto.randomUUID(),
        decision,
        note:
          decision === 'REJECTED'
            ? '项目经理在需求详情页拒绝该建议'
            : decision === 'MODIFIED'
              ? '项目经理修改后采纳'
              : '项目经理采纳原建议',
        ...(decision === 'MODIFIED' && draft ? { modifiedSuggestion: draft } : {}),
      })
      setRecords(previous => previous.map(item => (item.id === updated.id ? updated : item)))
      setEditingId(null)
      setDraft(null)
      setNotice({
        tone: 'ok',
        text:
          decision === 'REJECTED'
            ? '已记录拒绝结论。'
            : '已记录人工审核；正式应用仍等待公共写入路径整合。',
      })
    } catch (error) {
      const message = error instanceof ApiError ? error.message : String(error)
      setNotice({ tone: 'warn', text: message })
    } finally {
      setWorkingId(null)
    }
  }

  function startModify(record: RequirementBreakdownRecord) {
    if (!record.suggestion) return
    setEditingId(record.id)
    setDraft(structuredClone(record.suggestion))
    setNotice(null)
  }

  if (!canRead) {
    return (
      <section className="ai-panel" aria-label="AI 需求拆解">
        <div className="ai-panel__header">
          <div>
            <p className="ai-panel__eyebrow">AI 需求拆解</p>
            <h2>当前角色无权查看 AI 建议</h2>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="ai-panel" aria-label="AI 需求拆解">
      <div className="ai-panel__header">
        <div>
          <p className="ai-panel__eyebrow">AI 需求拆解</p>
          <h2>先生成建议，再由项目经理确认</h2>
          <p>当前执行器为本地确定性 Stub；无 SDK、无外部网络请求、不会自动写入正式任务。</p>
        </div>
        {canGenerate ? (
          <button
            type="button"
            className="ai-panel__primary"
            disabled={workingId !== null}
            onClick={() => void generate()}
          >
            {workingId === 'generate' ? '生成中…' : '生成拆解建议'}
          </button>
        ) : null}
      </div>

      {notice ? (
        <p className={`ai-panel__notice ai-panel__notice--${notice.tone}`} role="status">
          {notice.text}
        </p>
      ) : null}

      {loading ? <p className="ai-panel__empty">正在加载 AI 建议…</p> : null}
      {!loading && records.length === 0 ? (
        <p className="ai-panel__empty">还没有建议。生成后会先进入“待人工审核”，不会直接修改项目数据。</p>
      ) : null}

      <div className="ai-panel__list">
        {records.map(record => {
          const visibleContent = record.disposition.finalContent ?? record.suggestion
          const isEditing = editingId === record.id && draft !== null
          return (
            <article key={record.id} className="ai-suggestion">
              <div className="ai-suggestion__meta">
                <span className={`ai-chip ai-chip--${record.status.toLowerCase()}`}>{record.status}</span>
                <span>{record.model.provider} / {record.model.model}@{record.model.version}</span>
                <span>{record.model.mode}</span>
                <span>{formatTime(record.generation.generatedAt)}</span>
              </div>

              {record.generation.status !== 'SUCCEEDED' || !record.suggestion ? (
                <p className="ai-panel__notice ai-panel__notice--warn">
                  生成失败：{record.generation.error?.message ?? '未提供错误信息'}
                </p>
              ) : null}

              {record.suggestion && isEditing ? (
                <div className="ai-editor">
                  <label>
                    <span>拆解摘要</span>
                    <textarea
                      value={draft.summary}
                      onChange={event => setDraft({ ...draft, summary: event.target.value })}
                    />
                  </label>
                  {draft.workItems.map((item, index) => (
                    <label key={`${record.id}-${index}`}>
                      <span>建议项 {index + 1} 标题</span>
                      <input
                        value={item.title}
                        onChange={event => {
                          const workItems = draft.workItems.map((current, currentIndex) =>
                            currentIndex === index ? { ...current, title: event.target.value } : current,
                          )
                          setDraft({ ...draft, workItems })
                        }}
                      />
                    </label>
                  ))}
                  <div className="ai-suggestion__actions">
                    <button
                      type="button"
                      className="ai-panel__primary"
                      disabled={workingId !== null}
                      onClick={() => void review(record, 'MODIFIED')}
                    >
                      保存并采纳
                    </button>
                    <button
                      type="button"
                      className="ai-panel__plain"
                      onClick={() => { setEditingId(null); setDraft(null) }}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : record.suggestion ? (
                <>
                  <p className="ai-suggestion__summary">{visibleContent?.summary ?? record.suggestion.summary}</p>
                  <ol className="ai-suggestion__items">
                    {(visibleContent?.workItems ?? record.suggestion.workItems).map((item, index) => (
                      <li key={`${record.id}-item-${index}`}>
                        <strong>{item.title}</strong>
                        <p>{item.description}</p>
                        <ul>
                          {item.acceptanceCriteria.map((criterion, criterionIndex) => (
                            <li key={`${record.id}-${index}-ac-${criterionIndex}`}>{criterion}</li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ol>
                </>
              ) : null}

              {record.disposition.status !== 'PENDING' ? (
                <div className="ai-suggestion__audit">
                  <strong>人工结论：{decisionLabel(record.disposition.status)}</strong>
                  <span>审核人 {record.disposition.disposedByUserId}</span>
                  <span>{formatTime(record.disposition.disposedAt ?? '')}</span>
                  <span>应用状态：{record.application.status}</span>
                </div>
              ) : canReview && record.generation.status === 'SUCCEEDED' && !isEditing ? (
                <div className="ai-suggestion__actions">
                  <button
                    type="button"
                    className="ai-panel__primary"
                    disabled={workingId !== null}
                    onClick={() => void review(record, 'ACCEPTED')}
                  >
                    采纳
                  </button>
                  <button
                    type="button"
                    className="ai-panel__plain"
                    disabled={workingId !== null}
                    onClick={() => startModify(record)}
                  >
                    修改后采纳
                  </button>
                  <button
                    type="button"
                    className="ai-panel__danger"
                    disabled={workingId !== null}
                    onClick={() => void review(record, 'REJECTED')}
                  >
                    拒绝
                  </button>
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}
