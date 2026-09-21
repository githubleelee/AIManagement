/**
 * US-03（M4）需求层级 —— 写路径的表单与确认框
 *
 * 为什么单独一个文件：主页面 `ProjectRequirementsPage.tsx` 已经很长，
 * 把「新建 / 编辑」的表单与「删除确认」抽出来，页面只管**什么时候显示哪一个**。
 *
 * 覆盖的端点
 *   11  POST   /projects/:projectId/goals        建业务目标
 *   12  PATCH  /goals/:goalId                    改业务目标
 *   15  POST   /goals/:goalId/activities         建用户活动
 *   16  PATCH  /activities/:activityId           改用户活动
 *   19  POST   /activities/:activityId/stories   建用户需求
 *
 * ⚠️ **需求的「编辑」不在本文件**：那条路径（端点 21）只在需求详情页做一份，
 *    主页面对选中的需求给的是「打开详情页」的入口 —— 同一件事两处实现必然漂移。
 *
 * 三条与契约对齐的做法
 *   1. **部分更新只提交改动过的字段**（端点 12/16）：后端是「只写请求体出现的字段」，
 *      前端若把整行提交回去，会把别人在这期间改的其它字段覆盖掉。
 *   2. **纯空白要自己拦**：`'   '` 长度不为 0，后端的必填校验靠处理器的 trim 兜底；
 *      前端提前拦掉可以少发一次注定失败的请求。
 *   3. **422 的字段级错误照原样展示**：`details[].field` 是内部字段名，
 *      经 `fieldLabel()` 翻成中文后再给用户看，界面上不出现 `title` / `roleText` 这种词。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  ActivityNode,
  GoalNode,
  GoalStatus,
  Priority,
  UserStory,
} from '../../../../src/shared/types'
import { ApiError } from '../../api'
import {
  createActivity,
  createGoal,
  createStory,
  updateActivity,
  updateGoal,
  type CreateStoryInput,
} from './api'
import {
  GOAL_STATUS_LABEL,
  GOAL_STATUS_ORDER,
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  fieldErrorHint,
  fieldLabel,
} from './terms'

/** 表单要编辑的目标：三种节点的「新建 / 编辑」共用一个组件。 */
export type EditorTarget =
  | { kind: 'goal'; mode: 'create' }
  | { kind: 'goal'; mode: 'edit'; goal: GoalNode }
  | { kind: 'activity'; mode: 'create'; goal: GoalNode }
  | { kind: 'activity'; mode: 'edit'; goal: GoalNode; activity: ActivityNode }
  | { kind: 'story'; mode: 'create'; activity: ActivityNode }

type FieldError = { field: string; code: string }

const GOAL_NAME_MAX_LENGTH = 50
const STORY_TEXT_MAX_LENGTH = 50

/* ===========================================================================
 * 新建 / 编辑表单
 * =========================================================================== */

export function RequirementEditor({
  projectId,
  target,
  onSaved,
  onCancel,
}: {
  /** 新建业务目标时用作 URL 父级（契约 I-10：归属只从 URL 推导，不走表单）。 */
  projectId: string
  target: EditorTarget
  onSaved: (message: string) => void
  onCancel: () => void
}) {
  const isGoal = target.kind === 'goal'
  const isActivity = target.kind === 'activity'
  const isStory = target.kind === 'story'

  /* ---- 表单初值 ---- */
  const [name, setName] = useState(() => {
    if (target.kind === 'goal') return target.mode === 'edit' ? target.goal.name : ''
    if (target.kind === 'activity') return target.mode === 'edit' ? target.activity.name : ''
    return ''
  })
  const [description, setDescription] = useState(() => {
    if (target.kind === 'goal') return target.mode === 'edit' ? (target.goal.description ?? '') : ''
    if (target.kind === 'activity') {
      return target.mode === 'edit' ? (target.activity.description ?? '') : ''
    }
    return ''
  })
  const [status, setStatus] = useState<GoalStatus>(() => {
    if (target.kind === 'goal') return target.mode === 'edit' ? target.goal.status : 'ACTIVE'
    if (target.kind === 'activity') return target.mode === 'edit' ? target.activity.status : 'ACTIVE'
    return 'ACTIVE'
  })

  // 需求（端点 19）的字段
  const [title, setTitle] = useState('')
  const [roleText, setRoleText] = useState('')
  const [capabilityText, setCapabilityText] = useState('')
  const [valueText, setValueText] = useState('')
  const [businessValue, setBusinessValue] = useState('')
  const [priority, setPriority] = useState<Priority>('P0')
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('')

  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([])
  const [failure, setFailure] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const heading = isStory
    ? '新建用户需求'
    : isGoal
      ? target.mode === 'edit'
        ? '编辑业务目标'
        : '新建业务目标'
      : target.mode === 'edit'
        ? '编辑用户活动'
        : '新建用户活动'

  /** 归属说明：让「父级决定归属」这条契约（I-10）在界面上可见。 */
  const ownerHint = isActivity
    ? `归属目标：${target.goal.name}（归属由所在目标决定，表单里改不了）`
    : isStory
      ? `所属活动：${target.activity.name}（归属由所在活动决定）`
      : null

  function clientValidate(): FieldError[] {
    const errors: FieldError[] = []
    if (isStory) {
      // 五个必填文本字段**逐个**判，且长度按 trim 后的值算 ——
      // 提交的是 trim 后的值（见下方 input 构造），若拿原始长度判，
      // 「恰好 50 字 + 一个尾随空格」会被前端误拒。
      const fields: ReadonlyArray<readonly [string, string]> = [
        ['title', title],
        ['roleText', roleText],
        ['capabilityText', capabilityText],
        ['valueText', valueText],
        ['businessValue', businessValue],
      ]
      for (const [field, value] of fields) {
        const trimmed = value.trim()
        if (trimmed === '') errors.push({ field, code: 'REQUIRED' })
        else if (trimmed.length > STORY_TEXT_MAX_LENGTH) errors.push({ field, code: 'TOO_LONG' })
      }
      return errors
    }
    if (name.trim() === '') errors.push({ field: 'name', code: 'REQUIRED' })
    else if (name.trim().length > GOAL_NAME_MAX_LENGTH) errors.push({ field: 'name', code: 'TOO_LONG' })
    return errors
  }

  async function submit() {
    const errors = clientValidate()
    setFieldErrors(errors)
    setFailure(null)
    if (errors.length > 0) return

    setSaving(true)
    try {
      if (isStory) {
        const input: CreateStoryInput = {
          title: title.trim(),
          roleText: roleText.trim(),
          capabilityText: capabilityText.trim(),
          valueText: valueText.trim(),
          businessValue: businessValue.trim(),
          priority,
          // 验收标准这类自由文本**刻意不 trim**：后端对 description 就是
          // 「允许为纯空白字符串（契约未要求 trim 描述）」，前端替它 trim 反而与后端存储
          // 口径不一致。纯空白整体省略（不给该字段，落库为 null），而不是送一串空格。
          ...(acceptanceCriteria.trim() === '' ? {} : { acceptanceCriteria }),
        }
        const created: UserStory = await createStory(target.activity.id, input)
        onSaved(`需求「${created.title}」已创建。`)
        return
      }

      if (isGoal) {
        if (target.mode === 'create') {
          const created = await createGoal(projectId, {
            name: name.trim(),
            ...(description === '' ? {} : { description }),
          })
          onSaved(`业务目标「${created.name}」已创建，排在末位。`)
          return
        }
        // 只提交改动过的字段（端点 12）
        const patch: Parameters<typeof updateGoal>[1] = {}
        const changed: string[] = []
        if (name.trim() !== target.goal.name) {
          patch.name = name.trim()
          changed.push(fieldLabel('name'))
        }
        if (description !== (target.goal.description ?? '')) {
          patch.description = description
          changed.push(fieldLabel('description'))
        }
        if (status !== target.goal.status) {
          patch.status = status
          changed.push(fieldLabel('status'))
        }
        if (changed.length === 0) {
          onSaved('没有任何改动，未发出请求。')
          return
        }
        await updateGoal(target.goal.id, patch)
        onSaved(`已保存：${changed.join('、')}（只提交了改动过的字段）。`)
        return
      }

      // 用户活动（端点 15 / 16）
      if (target.mode === 'create') {
        const created = await createActivity(target.goal.id, {
          name: name.trim(),
          ...(description === '' ? {} : { description }),
        })
        onSaved(`用户活动「${created.name}」已创建。`)
        return
      }
      const patch: Parameters<typeof updateActivity>[1] = {}
      const changed: string[] = []
      if (name.trim() !== target.activity.name) {
        patch.name = name.trim()
        changed.push(fieldLabel('name'))
      }
      if (description !== (target.activity.description ?? '')) {
        patch.description = description
        changed.push(fieldLabel('description'))
      }
      if (status !== target.activity.status) {
        patch.status = status
        changed.push(fieldLabel('status'))
      }
      if (changed.length === 0) {
        onSaved('没有任何改动，未发出请求。')
        return
      }
      await updateActivity(target.activity.id, patch)
      onSaved(`已保存：${changed.join('、')}（只提交了改动过的字段）。`)
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.details && caught.details.length > 0) {
          setFieldErrors(caught.details.map((d) => ({ field: d.field, code: d.code })))
        } else {
          setFailure(`${caught.message}（HTTP ${caught.status}）`)
        }
      } else {
        setFailure(String(caught))
      }
    } finally {
      setSaving(false)
    }
  }

  const errorOf = (field: string) => fieldErrors.find((e) => e.field === field)

  return (
    <div>
      <p className="req-side-title">{heading}</p>
      {ownerHint ? <p className="req-note">{ownerHint}</p> : null}

      {failure ? (
        <div className="req-error" style={{ marginBottom: '0.8rem' }}>
          <p className="req-error-head">保存失败</p>
          <p className="req-error-message">{failure}</p>
        </div>
      ) : null}

      {fieldErrors.length > 0 ? (
        <div className="req-error" style={{ marginBottom: '0.8rem' }}>
          <p className="req-error-head">有 {fieldErrors.length} 个字段需要修改</p>
          <ul className="req-error-details">
            {fieldErrors.map((e, i) => (
              <li key={`${e.field}-${i}`}>
                <b>{fieldLabel(e.field)}</b>：{fieldErrorHint(e.code)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="req-form" style={{ border: 'none', padding: 0, background: 'transparent' }}>
        {isStory ? (
          <>
            <div className="req-triad">
              <p className="req-triad-caption">三段式（分开填写，不是一句话）</p>
              <div className="req-form-grid">
                <label className="req-label" htmlFor="ed-role">
                  角色
                </label>
                <input
                  id="ed-role"
                  className="req-input"
                  value={roleText}
                  onChange={(e) => setRoleText(e.target.value)}
                />
                <label className="req-label" htmlFor="ed-cap">
                  能力
                </label>
                <input
                  id="ed-cap"
                  className="req-input"
                  value={capabilityText}
                  onChange={(e) => setCapabilityText(e.target.value)}
                />
                <label className="req-label" htmlFor="ed-val">
                  价值
                </label>
                <input
                  id="ed-val"
                  className="req-input"
                  value={valueText}
                  onChange={(e) => setValueText(e.target.value)}
                />
              </div>
            </div>

            <div className="req-form-grid">
              <label className="req-label" htmlFor="ed-title">
                需求标题 *
              </label>
              <span>
                <input
                  id="ed-title"
                  className={errorOf('title') ? 'req-input is-invalid' : 'req-input'}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                {errorOf('title') ? (
                  <p className="req-field-error">
                    需求标题：{fieldErrorHint(errorOf('title')!.code)}
                  </p>
                ) : null}
              </span>

              <label className="req-label" htmlFor="ed-bv">
                业务价值 *
              </label>
              <input
                id="ed-bv"
                className="req-input"
                value={businessValue}
                onChange={(e) => setBusinessValue(e.target.value)}
              />

              <label className="req-label" htmlFor="ed-pri">
                优先级
              </label>
              <select
                id="ed-pri"
                className="req-select"
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
              >
                {PRIORITY_ORDER.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>

              <label className="req-label" htmlFor="ed-ac">
                验收标准
              </label>
              <textarea
                id="ed-ac"
                className="req-textarea"
                value={acceptanceCriteria}
                onChange={(e) => setAcceptanceCriteria(e.target.value)}
                placeholder="选填"
              />
            </div>
          </>
        ) : (
          <div className="req-form-grid">
            <label className="req-label" htmlFor="ed-name">
              名称 *
            </label>
            <span>
              <input
                id="ed-name"
                className={errorOf('name') ? 'req-input is-invalid' : 'req-input'}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="必填，最多 50 个字符"
              />
              {errorOf('name') ? (
                <p className="req-field-error">名称：{fieldErrorHint(errorOf('name')!.code)}</p>
              ) : null}
            </span>

            <label className="req-label" htmlFor="ed-desc">
              描述
            </label>
            <textarea
              id="ed-desc"
              className="req-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="选填"
            />

            {target.mode === 'edit' ? (
              <>
                <label className="req-label" htmlFor="ed-status">
                  状态
                </label>
                <select
                  id="ed-status"
                  className="req-select"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as GoalStatus)}
                >
                  {/* 选项来自 terms.ts 的唯一一份表，不在这里硬编码中文 —— 否则改文案必然两处漂移 */}
                  {GOAL_STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {GOAL_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
          </div>
        )}

        <div className="req-op-block">
          <div className="req-op-row">
            <button
              className="req-button"
              type="button"
              disabled={saving}
              onClick={() => void submit()}
            >
              {saving ? '保存中…' : target.mode === 'edit' ? '保存' : '创建'}
            </button>
            <button className="req-button req-button-plain" type="button" onClick={onCancel}>
              取消
            </button>
          </div>
          <p className="req-hint">
            {isStory
              ? '创建后状态为「待规划」、敏感标记为关闭；这两项分别由后续流程与「敏感设置」修改。'
              : target.mode === 'edit'
                ? '只提交你实际改动过的字段；未改动的字段不会被覆盖。'
                : '创建后排在最末位，状态自动为「进行中」。'}
          </p>
        </div>
      </div>
    </div>
  )
}

/* ===========================================================================
 * 删除二次确认（页内模态框，不用 window.confirm）
 * =========================================================================== */

export function ConfirmDialog({
  title,
  children,
  confirmText = '确认删除',
  danger = true,
  onConfirm,
  onCancel,
}: {
  title: string
  children: ReactNode
  confirmText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    // 打开即把焦点移到主按钮（否则键盘用户还在背后的页面上），Esc 可关闭。
    // 刻意**不做焦点陷阱（focus trap）**：本项目模态框很浅，加 trap 的复杂度
    // 换不来多少收益；但「能关」与「初始焦点不落在背景」是必须的。
    confirmRef.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    <div
      className="req-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="req-modal-title"
    >
      <div className="req-modal" style={danger ? undefined : { borderColor: '#b45309' }}>
        <p
          id="req-modal-title"
          className="req-form-title"
          style={danger ? { color: '#fca5a5' } : { color: '#fcd34d' }}
        >
          {title}
        </p>
        {children}
        <div className="req-op-row" style={{ marginTop: '0.8rem', justifyContent: 'flex-end' }}>
          <button className="req-button req-button-plain" type="button" onClick={onCancel}>
            取消
          </button>
          <button
            ref={confirmRef}
            className={danger ? 'req-button req-button-danger' : 'req-button'}
            type="button"
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

