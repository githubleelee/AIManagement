/**
 * 需求详情页（M4 / US-03）
 *
 * 路由：`/projects/:projectId/requirements/:storyId`（见 `docs/frontend-routes.md`，已冻结）
 *
 * 这一页原来只有 18 行占位，而主页面右栏早就提供了「在新页面打开」的深链入口 ——
 * 也就是说那条入口此前会落到一个写着「后续实现」的空页面。本文件补齐它。
 *
 * 数据来源（契约决策 I-8）
 *   端点 20 `GET /stories/:storyId`（权限 `project.read`）—— 本页的正文
 *   端点 10 `GET /projects/:projectId/goals`（权限 `project.read`）—— 只为面包屑取上级名称
 *   端点 21 `PATCH /stories/:storyId`（权限 `requirement.write`）—— 编辑
 *   端点 22 `DELETE /stories/:storyId`（权限 `requirement.write`）—— 删除
 *   端点 23 / 24（属 M3 / M5，尚未交付）—— 敏感名单与任务列表，见 `temporary-data.ts`
 *
 * 三条容易写错的契约约束（都在代码里钉住）
 *   1. **编辑里没有 `isSensitive`**：契约 I-8 端点 21 明文「该字段只能通过端点 23 修改」。
 *      `updateStory()` 的入参类型里就没有这个字段，写不进去。
 *   2. **部分更新只提交改过的字段**：后端是「只写请求体出现的字段」，
 *      前端若把整行提交回去，会把别人在这期间改的其它字段覆盖掉。
 *   3. **404 不可区分**：不存在 / 非项目成员 / 敏感且未授权，三者响应完全一致，
 *      所以界面不猜原因，只说「找不到这条需求」。
 *
 * 角色口径：按 `docs/frontend-routes.md:36`「仅 myRole === 'PM' 时显示写入口；
 * 服务端仍强制校验（前端隐藏仅为体验，不作为权限依据）」。
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import type {
  GoalNode,
  Priority,
  ProjectView,
  StoryStatus,
  TaskView,
  UserStory,
} from '../../../src/shared/types'
import { useAuth } from '../auth/AuthContext'
import { ApiError } from '../api'
import PageHeader from '../components/PageHeader'
import { ConfirmDialog } from './requirement/Editor'
import {
  deleteStory,
  findStoryRow,
  getGoalTree,
  getStory,
  updateStory,
  type StoryRow,
} from './requirement/api'
import { listStoryTasks, saveSensitivity } from './requirement/temporary-data'
import {
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  STORY_STATUS_LABEL,
  STORY_STATUS_ORDER,
  fieldErrorHint,
  fieldLabel,
} from './requirement/terms'
import './requirement/requirement.css'

/** 详情页的两个页签。原设计里还有「契约字段」（把整行 JSON 打出来），已移除：
 *  它会把内部字段命名与完整响应结构暴露给普通使用者。 */
type DetailTab = 'detail' | 'ac'

/** 端点 21 的入参类型（从 api 层推导，避免两处各写一份而漂移）。 */
type StoryPatch = Parameters<typeof updateStory>[1]

type EditForm = {
  title: string
  roleText: string
  capabilityText: string
  valueText: string
  businessValue: string
  priority: Priority
  status: StoryStatus
  acceptanceCriteria: string
}

/** 编辑表单的字段名 → 初始值，用于「只提交改动过的字段」。 */
function toForm(story: UserStory): EditForm {
  return {
    title: story.title,
    roleText: story.roleText,
    capabilityText: story.capabilityText,
    valueText: story.valueText,
    businessValue: story.businessValue,
    priority: story.priority,
    status: story.status,
    acceptanceCriteria: story.acceptanceCriteria ?? '',
  }
}

export default function RequirementDetailPage() {
  const { storyId = '' } = useParams()
  const navigate = useNavigate()
  // ProjectLayout 通过 <Outlet context={project}> 提供；本页在它之下，所以一定有值。
  const project = useOutletContext<ProjectView>()
  const isPM = project.myRole === 'PM'
  // 真实当前用户：设置敏感可见名单时必须用**真 userId**，不能用占位串。
  const { user } = useAuth()

  const [goals, setGoals] = useState<GoalNode[] | null>(null)
  const [story, setStory] = useState<UserStory | null>(null)
  const [tasks, setTasks] = useState<TaskView[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const [tab, setTab] = useState<DetailTab>('detail')
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<EditForm | null>(null)
  const [original, setOriginal] = useState<EditForm | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Array<{ field: string; code: string }>>([])
  const [saving, setSaving] = useState(false)

  const [sensitive, setSensitive] = useState<{ isSensitive: boolean; visibleMemberIds: string[] } | null>(null)
  const [savingSensitive, setSavingSensitive] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  /* ---------------- 读 ---------------- */

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // 两个请求并行：详情正文用端点 20，上级名称（面包屑）用端点 10。
      const [tree, detail] = await Promise.all([getGoalTree(project.id), getStory(storyId)])
      setGoals(tree)
      setStory(detail)
      // 端点 20 给出敏感状态；端点 23 的响应会在本页操作后补齐当前白名单。
      setSensitive({ isSensitive: detail.isSensitive, visibleMemberIds: [] })
    } catch (caught) {
      setGoals(null)
      setStory(null)
      setError(caught instanceof ApiError ? caught : new ApiError(0, 'UNKNOWN', String(caught)))
    } finally {
      setLoading(false)
    }
  }, [project.id, storyId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    setTasks(null)
    listStoryTasks(storyId)
      .then((rows) => {
        if (!cancelled) setTasks(rows)
      })
      .catch(() => {
        // 任务列表取不到不该让整页失败（端点 24 未交付时也走这里）
        if (!cancelled) setTasks([])
      })
    return () => {
      cancelled = true
    }
  }, [storyId])

  /* ---------------- 编辑 ---------------- */

  function startEdit(current: UserStory) {
    const initial = toForm(current)
    setForm(initial)
    setOriginal(initial)
    setFieldErrors([])
    setNotice(null)
    setEditing(true)
  }

  /**
   * 只收集与初值不同的字段 —— 与后端「只写请求体出现的字段」同构。
   *
   * 类型直接用 `updateStory` 的入参类型，而不是 `Record<string, ...>`：
   * 后者虽然也能构造，但传回 `updateStory` 时会因为「宽类型不能赋给具体属性对象」
   * 直接编译失败；用 `Parameters<...>` 还能顺带保证**不会**多提交一个契约外字段。
   */
  function dirtyPatch(current: EditForm, base: EditForm): StoryPatch {
    const patch: StoryPatch = {}
    // title 的空白由 saveEdit 提前拦掉，这里照常比较
    if (current.title !== base.title) patch.title = current.title
    if (current.roleText !== base.roleText) patch.roleText = current.roleText
    if (current.capabilityText !== base.capabilityText) patch.capabilityText = current.capabilityText
    if (current.valueText !== base.valueText) patch.valueText = current.valueText
    if (current.businessValue !== base.businessValue) patch.businessValue = current.businessValue
    if (current.priority !== base.priority) patch.priority = current.priority
    if (current.status !== base.status) patch.status = current.status
    if (current.acceptanceCriteria !== base.acceptanceCriteria) {
      patch.acceptanceCriteria = current.acceptanceCriteria
    }
    return patch
  }

  async function saveEdit(current: UserStory) {
    if (!form || !original) return

    // 纯空白在提交前就拦住（后端也会拒，但没必要的请求不发）
    if (form.title.trim() === '') {
      setFieldErrors([{ field: 'title', code: 'REQUIRED' }])
      return
    }
    const patch = dirtyPatch(form, original)
    if (Object.keys(patch).length === 0) {
      setEditing(false)
      setNotice({ tone: 'ok', text: '没有任何改动，未发出请求。' })
      return
    }

    setSaving(true)
    setFieldErrors([])
    try {
      const updated = await updateStory(current.id, patch)
      setStory(updated)
      setEditing(false)
      setForm(null)
      setOriginal(null)
      const names = Object.keys(patch).map(fieldLabel).join('、')
      setNotice({ tone: 'ok', text: `已保存：${names}（只提交了改动过的字段）。` })
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.details && caught.details.length > 0) setFieldErrors(caught.details)
        else setNotice({ tone: 'warn', text: `${caught.message}（HTTP ${caught.status}）` })
      } else {
        setNotice({ tone: 'warn', text: String(caught) })
      }
    } finally {
      setSaving(false)
    }
  }

  /* ---------------- 删除 ---------------- */

  async function doDelete(current: UserStory) {
    setConfirmDelete(false)
    setNotice(null)
    try {
      await deleteStory(current.id)
      navigate(`/projects/${project.id}/requirements`)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        // 契约 I-8 端点 22：HAS_CHILDREN —— 需求下还有任务，不允许静默级联删除
        const hasChildren = caught.details?.some((d) => d.code === 'HAS_CHILDREN') ?? false
        setNotice({
          tone: 'warn',
          text: hasChildren
            ? '这条需求下还有任务，请先处理这些任务再删除。系统不会连带删除它们。'
            : caught.message,
        })
        return
      }
      setNotice({
        tone: 'warn',
        text: caught instanceof ApiError ? `${caught.message}（HTTP ${caught.status}）` : String(caught),
      })
    }
  }

  /* ---------------- 敏感（端点 23，US-02 真实接口） ---------------- */

  async function toggleSensitive(current: UserStory) {
    if (!sensitive || savingSensitive) return

    const next = !sensitive.isSensitive

    // ⚠️ 名单里必须是**本项目成员的真实 userId**：契约 I-8 端点 23 的字段级错误就是
    // `visibleMemberIds: NOT_PROJECT_MEMBER`。这里原先写死了一个 `'u-self'` 的假 id ——
    // 走临时层看不出问题，换真接口后首次点击就 422；若服务端校验宽松，名单里则是无效 id，
    // PM 可能把自己排除在外从而看不到自己刚标敏感的需求（契约 I-5 第 3 条对 PM 同样生效）。
    // 代码审查的阻断项 B3。
    let visibleMemberIds = sensitive.visibleMemberIds
    if (next) {
      if (!user) {
        setNotice({ tone: 'warn', text: '拿不到当前用户信息，无法设置可见名单，请刷新后重试。' })
        return
      }
      visibleMemberIds = Array.from(new Set([...sensitive.visibleMemberIds, user.id]))
    }

    setSavingSensitive(true)
    setNotice(null)
    try {
      const view = await saveSensitivity(current.id, { isSensitive: next, visibleMemberIds })
      setSensitive({ isSensitive: view.isSensitive, visibleMemberIds: view.visibleMemberIds })
      setNotice({ tone: 'ok', text: `敏感标记已${view.isSensitive ? '开启' : '关闭'}。` })
    } catch (caught) {
      // 真接口会抛 403/404/422；必须接住，否则就是一个没人处理的 Promise 拒绝
      // （原先用 `void toggleSensitive(...)` 调用，没有 try/catch）。审查建议项 S16。
      setNotice({
        tone: 'warn',
        text:
          caught instanceof ApiError ? `${caught.message}（HTTP ${caught.status}）` : String(caught),
      })
    } finally {
      setSavingSensitive(false)
    }
  }

  /* ---------------- 渲染 ---------------- */

  if (loading) {
    return (
      <div className="page">
        <PageHeader title="需求详情" description="加载中…" />
        <div className="page-loading">加载中…</div>
      </div>
    )
  }

  if (error || !story) {
    // ⚠️ 不是所有失败都是 404：网络错误会落到 ApiError(0,'UNKNOWN')，500 也一样。
    // 把 500 说成「找不到这条需求」会掩盖真实故障（审查建议项 S15）。
    const status = error?.status ?? 404
    const isNotFound = status === 404
    return (
      <div className="page">
        <PageHeader
          title="需求详情"
          actions={
            <Link className="button ghost" to={`/projects/${project.id}/requirements`}>
              ← 返回需求层级
            </Link>
          }
        />
        <div className="req-error">
          <p className="req-error-head">{isNotFound ? '找不到这条需求' : '加载失败'}</p>
          <p className="req-error-message">
            {isNotFound
              ? '它可能已被删除，或者你不在这个项目里。'
              : (error?.message ?? '服务暂时不可用，请稍后重试。')}
          </p>
          <p className="req-error-advice">
            {isNotFound
              ? '出于安全考虑，「需求不存在」与「你没有查看权限」给出的是同一个提示，界面无法区分，也不应该去猜。'
              : `错误信息：HTTP ${status}${error?.code ? ` · ${error.code}` : ''}。若反复出现，请把这一行报给开发。`}
          </p>
        </div>
      </div>
    )
  }

  // 单一真相来源：端点 23 是唯一能改 isSensitive 的入口，所以开关动过之后以本地视图为准。
  // 否则同一屏上会同时出现「敏感需求：否」（来自端点 20）与「开关：开启」（本地）；
  // 而且换真接口后这个矛盾**依然存在**（toggle 只 setSensitive，从不更新 story）。
  // 代码审查的阻断项 B4。
  const isSensitive = sensitive?.isSensitive ?? story.isSensitive

  const row: StoryRow | null = goals ? findStoryRow(goals, story.id) : null
  const goalName = row?.goal.name
  const activityName = row?.activity.name
  const storyTasks = tasks ?? []
  const visibleCount = sensitive?.visibleMemberIds.length ?? 0

  return (
    <div className="page">
      <PageHeader
        title="需求详情"
        description="查看这条需求的完整信息、验收标准与关联任务，并可编辑或删除。"
        actions={
          <>
            <Link className="button ghost" to={`/projects/${project.id}/requirements`}>
              ← 返回需求层级
            </Link>
            <button
              className="ghost"
              type="button"
              onClick={() => {
                // 「刷新」是重新从服务端取数，因此也要退出编辑态 ——
                // 否则表单里留着旧快照，用户无法判断刷新到底发生了没有（审查建议项 S14）。
                setEditing(false)
                setForm(null)
                setOriginal(null)
                setFieldErrors([])
                setNotice(null)
                void load()
              }}
            >
              刷新
            </button>
          </>
        }
      />

      {/* 上一行：我在哪一页；下一行：这条需求在树的哪一支 */}
      <div className="req-crumb-nav">
        <Link className="req-crumb" to="/projects">
          我的项目
        </Link>
        <span className="req-crumb-sep">›</span>
        <Link className="req-crumb" to={`/projects/${project.id}/overview`}>
          {project.name}
        </Link>
        <span className="req-crumb-sep">›</span>
        <Link className="req-crumb" to={`/projects/${project.id}/requirements`}>
          需求层级
        </Link>
        <span className="req-crumb-sep">·</span>
        <span>需求详情</span>
      </div>

      {goalName || activityName ? (
        <div className="req-crumb-path">
          {goalName ? (
            <>
              <span>
                <span className="req-crumb-kind">目标</span>
                <Link className="req-crumb" to={`/projects/${project.id}/requirements`}>
                  {goalName}
                </Link>
              </span>
              <span className="req-crumb-sep">›</span>
            </>
          ) : null}
          {activityName ? (
            <>
              <span>
                <span className="req-crumb-kind">活动</span>
                <Link className="req-crumb" to={`/projects/${project.id}/requirements`}>
                  {activityName}
                </Link>
              </span>
              <span className="req-crumb-sep">›</span>
            </>
          ) : null}
          <span>
            <span className="req-crumb-kind">需求</span>
            <span className="req-crumb-current">{story.title}</span>
          </span>
        </div>
      ) : (
        <p className="req-note">
          这条需求不在当前可见的层级树里（例如它被标记为敏感，而你的角色看不到它）——
          直接打开它的地址仍然可以查看。
        </p>
      )}

      <p className="req-pane-title" style={{ marginBottom: '0.35rem' }}>
        {story.title}
      </p>
      <p className="req-pane-sub">
        <span className="req-badge req-badge-priority">{priorityLabel(story.priority)}</span>
        <span className="req-badge req-badge-story">{STORY_STATUS_LABEL[story.status]}</span>
        <span className="req-badge req-badge-muted">业务价值：{story.businessValue}</span>
        {isSensitive ? <span className="req-badge req-badge-sensitive">敏感</span> : null}
        {isPM ? null : <span className="req-badge req-badge-muted">我的角色：只读</span>}
      </p>

      {notice ? (
        <div className={notice.tone === 'warn' ? 'req-warn' : 'req-ok'} style={{ marginBottom: '0.9rem' }}>
          {notice.text}
        </div>
      ) : null}

      <div className="req-split">
        {/* ---------------- 左栏：正文 ---------------- */}
        <div className="req-main">
          <p className="req-story-sentence">
            作为 <em>{story.roleText}</em>，我要 <em>{story.capabilityText}</em>，以便{' '}
            <em>{story.valueText}</em>
          </p>

          <div className="req-tabs">
            {(
              [
                ['detail', '详情'],
                ['ac', '验收标准'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={tab === key ? 'req-tab is-active' : 'req-tab'}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {editing && form && original ? (
            <div className="req-form">
              <p className="req-form-title">编辑需求</p>

              {fieldErrors.length > 0 ? (
                <div className="req-error" style={{ marginBottom: '0.8rem' }}>
                  <p className="req-error-head">保存失败</p>
                  <ul className="req-error-details">
                    {fieldErrors.map((e, i) => (
                      <li key={`${e.field}-${i}`}>
                        <b>{fieldLabel(e.field)}</b>：{fieldErrorHint(e.code)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="req-triad">
                <p className="req-triad-caption">三段式（分开填写，不是一句话）</p>
                <div className="req-form-grid">
                  <label className="req-label" htmlFor="rd-role">
                    角色
                  </label>
                  <input
                    id="rd-role"
                    className="req-input"
                    value={form.roleText}
                    onChange={(e) => setForm({ ...form, roleText: e.target.value })}
                  />
                  <label className="req-label" htmlFor="rd-cap">
                    能力
                  </label>
                  <input
                    id="rd-cap"
                    className="req-input"
                    value={form.capabilityText}
                    onChange={(e) => setForm({ ...form, capabilityText: e.target.value })}
                  />
                  <label className="req-label" htmlFor="rd-val">
                    价值
                  </label>
                  <input
                    id="rd-val"
                    className="req-input"
                    value={form.valueText}
                    onChange={(e) => setForm({ ...form, valueText: e.target.value })}
                  />
                </div>
              </div>

              <div className="req-form-grid">
                <label className="req-label" htmlFor="rd-title">
                  需求标题 *
                </label>
                <span>
                  <input
                    id="rd-title"
                    className={
                      fieldErrors.some((e) => e.field === 'title')
                        ? 'req-input is-invalid'
                        : 'req-input'
                    }
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                  />
                  {fieldErrors.some((e) => e.field === 'title') ? (
                    <p className="req-field-error">需求标题：{fieldErrorHint('REQUIRED')}</p>
                  ) : null}
                </span>

                <label className="req-label" htmlFor="rd-bv">
                  业务价值 *
                </label>
                <input
                  id="rd-bv"
                  className="req-input"
                  value={form.businessValue}
                  onChange={(e) => setForm({ ...form, businessValue: e.target.value })}
                />

                <label className="req-label" htmlFor="rd-pri">
                  优先级
                </label>
                <select
                  id="rd-pri"
                  className="req-select"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}
                >
                  {PRIORITY_ORDER.map((p) => (
                    <option key={p} value={p}>
                      {priorityLabel(p)}
                    </option>
                  ))}
                </select>

                <label className="req-label" htmlFor="rd-status">
                  状态
                </label>
                <select
                  id="rd-status"
                  className="req-select"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as StoryStatus })}
                >
                  {STORY_STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {STORY_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>

                <label className="req-label" htmlFor="rd-ac">
                  验收标准
                </label>
                <textarea
                  id="rd-ac"
                  className="req-textarea"
                  value={form.acceptanceCriteria}
                  onChange={(e) => setForm({ ...form, acceptanceCriteria: e.target.value })}
                />
              </div>

              <div className="req-op-block">
                <p className="req-side-title">本次将提交的字段</p>
                <p className="req-note" style={{ margin: 0 }}>
                  {(() => {
                    const patch = dirtyPatch(form, original)
                    const keys = Object.keys(patch)
                    return keys.length === 0
                      ? '还没有改动 —— 什么都没改时不会发出请求。'
                      : keys.map(fieldLabel).join('、')
                  })()}
                </p>
                <div className="req-op-row" style={{ marginTop: '0.6rem' }}>
                  <button
                    className="req-button"
                    type="button"
                    disabled={saving}
                    onClick={() => void saveEdit(story)}
                  >
                    {saving ? '保存中…' : '保存'}
                  </button>
                  <button
                    className="req-button req-button-plain"
                    type="button"
                    onClick={() => {
                      setEditing(false)
                      setForm(null)
                      setOriginal(null)
                      setFieldErrors([])
                    }}
                  >
                    取消
                  </button>
                </div>
                <p className="req-hint">
                  只提交你实际改动过的字段；未改动的字段不会被覆盖。这里没有「敏感需求」——
                  它只能通过右侧的开关修改。
                </p>
              </div>
            </div>
          ) : tab === 'ac' ? (
            <>
              <p className="req-side-title">验收标准（由项目经理维护）</p>
              {story.acceptanceCriteria ? (
                <blockquote className="req-quote">{story.acceptanceCriteria}</blockquote>
              ) : (
                <p className="req-placeholder">这条需求还没有填写验收标准。</p>
              )}
              <p className="req-hint">
                本需求下有 {storyTasks.length} 个任务；任务的验收人由负责人之外的成员担任。
              </p>
            </>
          ) : (
            <dl className="req-fields">
              <dt>需求标题</dt>
              <dd>{story.title}</dd>
              <dt>角色</dt>
              <dd>{story.roleText}</dd>
              <dt>能力</dt>
              <dd>{story.capabilityText}</dd>
              <dt>价值</dt>
              <dd>{story.valueText}</dd>
              <dt>业务价值</dt>
              <dd>{story.businessValue}</dd>
              <dt>优先级</dt>
              <dd>{priorityLabel(story.priority)}</dd>
              <dt>状态</dt>
              <dd>{STORY_STATUS_LABEL[story.status]}</dd>
              <dt>敏感需求</dt>
              <dd>{isSensitive ? '是' : '否'}</dd>
              <dt>所属活动</dt>
              <dd>{activityName ?? '（不在可见的层级树里）'}</dd>
              <dt>创建时间</dt>
              <dd className="req-mono">{story.createdAt}</dd>
              <dt>需求编号</dt>
              <dd className="req-mono">{story.id}</dd>
            </dl>
          )}
        </div>

        {/* ---------------- 右栏：操作 / 任务 / 敏感 ---------------- */}
        <aside className="req-detail">
          <div className="req-op-block">
            <p className="req-side-title">操作</p>
            {isPM ? (
              <div className="req-op-row">
                <button
                  className="req-button-small req-button-plain"
                  type="button"
                  disabled={editing}
                  onClick={() => startEdit(story)}
                >
                  编辑
                </button>
                <button
                  className="req-button-small req-button-danger"
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                >
                  删除
                </button>
              </div>
            ) : (
              <>
                <p className="req-readonly">你的角色对这个项目只有查看权限。</p>
                <p className="req-hint">
                  界面隐藏只是体验优化；即使绕过界面直接发请求，服务端也会拒绝。
                </p>
              </>
            )}
          </div>

          <div className="req-op-block">
            <p className="req-side-title">
              关联任务（{tasks === null ? '…' : storyTasks.length}）
            </p>
            {tasks === null ? (
              <p className="req-placeholder">正在加载任务…</p>
            ) : storyTasks.length === 0 ? (
              <p className="req-placeholder">这条需求下还没有任务。</p>
            ) : (
              <table className="req-table">
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>负责人</th>
                    <th>验收人</th>
                    <th className="nowrap">计划</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {storyTasks.map((t) => (
                    <tr key={t.id}>
                      <td>{t.title}</td>
                      <td className="req-mono">{t.owner?.account ?? t.ownerUserId}</td>
                      <td className="req-mono">{t.acceptor?.account ?? t.acceptorUserId}</td>
                      <td className="req-mono nowrap">
                        {t.planStart} → {t.planEnd}
                      </td>
                      <td>{taskStatusLabel(t.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="req-op-block">
            <p className="req-side-title">敏感与可见成员</p>
            {isPM ? (
              <>
                <button
                  type="button"
                  className={isSensitive ? 'req-switch is-on' : 'req-switch'}
                  disabled={savingSensitive}
                  onClick={() => void toggleSensitive(story)}
                >
                  {savingSensitive ? '保存中…' : isSensitive ? '敏感需求：开启' : '敏感需求：关闭'}
                </button>
                {isSensitive ? (
                  <p className="req-hint">当前名单里有 {visibleCount} 人。</p>
                ) : null}
                <p className="req-hint">
                  开启后，只有名单里的成员能看到这条需求；其余成员在需求层级里看不到它，
                  但父级的目标与活动照常显示，也不会出现「已有 N 条被隐藏」这类提示。
                </p>
              </>
            ) : (
              <p className="req-readonly">敏感需求：{isSensitive ? '是' : '否'}</p>
            )}
          </div>
        </aside>
      </div>

      {/* ---------------- 删除二次确认 ----------------
          复用主页面同一个 ConfirmDialog：同一件事原先在详情页又手写了一遍模态框，
          而那一份还漏了 role/aria-modal 与 Esc 关闭（审查建议项 S4）。 */}
      {confirmDelete ? (
        <ConfirmDialog
          // 任务列表已经加载出来了，「还有没有任务」本地就知道 ——
          // 有任务时这个框只是**告知**，按钮不能真发 DELETE（发了必然 409）。
          // 同一类问题由人类走查在主页面上先抓到，这里一并修。
          title={storyTasks.length > 0 ? '这条需求还不能删除' : '确认删除这条需求？'}
          confirmText={storyTasks.length > 0 ? '知道了' : '确认删除'}
          danger={storyTasks.length === 0}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            if (storyTasks.length > 0) {
              setConfirmDelete(false)
              setNotice({
                tone: 'warn',
                text: `这条需求下还有 ${storyTasks.length} 个任务，请先删除或转移它们再删除本需求。系统不会连带删除。`,
              })
              return
            }
            void doDelete(story)
          }}
        >
          <dl className="req-fields">
            <dt>需求标题</dt>
            <dd>{story.title}</dd>
            <dt>需求编号</dt>
            <dd className="req-mono">{story.id}</dd>
            <dt>关联任务</dt>
            <dd>{storyTasks.length} 个</dd>
          </dl>
          <p className="req-hint" style={{ color: storyTasks.length > 0 ? '#fcd34d' : '#fecaca' }}>
            {storyTasks.length > 0
              ? '请先删除或转移下面这些任务，然后再回来删除这条需求。'
              : '删除后无法恢复。'}
          </p>
        </ConfirmDialog>
      ) : null}
    </div>
  )
}

/* ===========================================================================
 * 本地小助手
 * =========================================================================== */

/**
 * 优先级标签。
 *
 * 契约 I-7 约定 2 说明：枚举列的取值**不靠数据库约束**，只能靠写入前的校验。
 * 所以万一库里被写进一个契约外的值，这里回退成原样显示，而不是渲染出一片空白。
 */
function priorityLabel(priority: string): string {
  return (PRIORITY_LABEL as Readonly<Record<string, string>>)[priority] ?? priority
}

/** 任务状态标签（任务属 M5，标签表还没进 terms.ts，先用本页的局部表）。 */
function taskStatusLabel(status: string): string {
  if (status === 'TODO') return '待办'
  if (status === 'DOING') return '进行中'
  if (status === 'DONE') return '已完成'
  return status
}
