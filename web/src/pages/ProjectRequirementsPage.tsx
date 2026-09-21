import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import type { ActivityNode, GoalNode, ProjectView, StoryNode } from '../../../src/shared/types'
import { ApiError } from '../api'
import Button from '../components/Button'
import DataTable, { type Column } from '../components/DataTable'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import { ConfirmDialog, RequirementEditor, type EditorTarget } from './requirement/Editor'
import {
  collectStoryRows,
  deleteActivity,
  deleteGoal,
  deleteStory,
  getGoalTree,
  reorderActivities,
  reorderGoals,
} from './requirement/api'
import {
  GOAL_STATUS_LABEL,
  GAP_ROWS,
  PRIORITY_LABEL,
  STORY_STATUS_LABEL,
  TERM_ROWS,
  fieldErrorHint,
  fieldLabel,
} from './requirement/terms'
import './requirement/requirement.css'

/**
 * 需求层级页（M4 / US-03，端点 10）
 *
 * 路由：`/projects/:projectId/requirements`（见 `docs/frontend-routes.md`，已冻结）。
 * 本文件替换了该分支上的占位实现，并遵守骨架约定：
 *   - 项目与角色从 `useOutletContext<ProjectView>()` 取（不自己再拉一次端点 5）
 *   - 只往 `pages/` 下新增文件，不改骨架
 *   - 请求路径带 `/api` 前缀（见 `pages/requirement/api.ts` 的说明）
 *
 * 界面结构（**相对我第一版设计稿的改动**）
 *   第一版设计稿自带"左栏视图导航"（三栏）。集成时发现 `ProjectLayout` 已经提供了
 *   左侧导航（概览/需求/任务/成员），再加一栏会变成四栏。因此视图切换降级为页内 tab，
 *   页面内部只保留**两栏**：左「结构 / 列表」、右「选中项详情」。
 *
 * 覆盖的验收标准
 *   - AC-US-03-04（P0 ★核心）四层结构一致性：完整展示 目标 → 活动 → 故事 的归属关系
 *   - AC-US-03-09 列表与详情：列表显示名称、状态、优先级、下属数量
 *
 * 尚未覆盖（如实标注，避免被误认为已做）
 *   - AC-US-03-01/02/03/05/06：创建 / 编辑 / 删除 / 排序（写路径端点 11–22）属后续功能块
 *   - AC-US-03-07：只读角色的写按钮形态（写按钮尚未接入，故无从体现）
 *   - AC-US-03-08：敏感联动 —— `visibilityScope()` 在 T2.5 落地前是空操作，
 *     本页显示的 `isSensitive` 只是**已有字段**，**不代表过滤已生效**
 *
 * 界面用词（2026-09-20 调整）
 *   详情面板一律显示**中文标签**，不再把接口字段名（title / roleText / capabilityText /
 *   valueText / businessValue / isSensitive / createdAt / storyId …）直接摆在界面上；
 *   同时移除原先把整条记录 JSON 化展示的「契约字段」页签 —— 它会把内部字段命名与
 *   完整响应结构暴露给普通使用者。开发与联调需要的原始字段视图改为**不进入产品界面**。
 *
 *   ⚠️ 例外（有意保留，不在本次清理范围）：`pages/requirement/terms.ts` 的
 *   「术语对照与缺口」表**仍然**列举线上字段名（BusinessGoal / UserStory / Priority …），
 *   那是给评审看的四方言对照（平台用词 / 线上字段 / 实验指导书用词 / PMBOK 用词），
 *   删掉它反而会丢掉设计意图。若人类要求连它也一并去掉，请另行裁决。
 */
type View = 'tree' | 'stories' | 'terms'
type DetailTab = 'detail' | 'ac'
type Selection =
  | { kind: 'goal'; id: string }
  | { kind: 'activity'; id: string }
  | { kind: 'story'; id: string }

/**
 * 写操作的统一入口类型。
 *
 * 放在模块级而不是组件内部：树面板（TreePane）与详情面板（DetailPane）是两个
 * 独立的函数组件，它们都要用这个类型，声明在组件内就传不出去了。
 */
type RowAction =
  | { type: 'create-goal' }
  | { type: 'create-activity'; goalId: string }
  | { type: 'create-story'; activityId: string }
  | { type: 'edit-goal'; id: string }
  | { type: 'edit-activity'; id: string }
  | { type: 'open-story'; id: string }
  | { type: 'move-goal'; id: string; delta: number }
  | { type: 'move-activity'; id: string; delta: number }
  | { type: 'delete'; kind: 'goal' | 'activity' | 'story'; id: string }

/** 目标 / 活动状态徽标（决策 I-1：GoalStatus = ACTIVE | DONE）。 */
function GoalStatusBadge({ status }: { status: string }) {
  const label =
    status === 'ACTIVE' || status === 'DONE' ? GOAL_STATUS_LABEL[status] : `${status}（未知）`
  return <span className="req-badge req-badge-goal">{label}</span>
}

/**
 * 需求状态徽标（决策 I-1：StoryStatus = DRAFT | PLANNING | DONE）。
 *
 * ⚠️ 与 `GoalStatusBadge` 是两个函数、两张表 —— 这正是三 DONE 陷阱要求的：
 *   两个 `DONE` 语义不同、不可互相赋值；且 `ACTIVE` 在此**不被接受**。
 */
function StoryStatusBadge({ status }: { status: string }) {
  const label =
    status === 'DRAFT' || status === 'PLANNING' || status === 'DONE'
      ? STORY_STATUS_LABEL[status]
      : `${status}（未知）`
  return <span className="req-badge req-badge-story">{label}</span>
}

function PriorityBadge({ priority }: { priority: string }) {
  const label =
    priority === 'P0' || priority === 'P1' || priority === 'P2' ? PRIORITY_LABEL[priority] : priority
  return <span className="req-badge req-badge-priority">{label}</span>
}

/**
 * 在树里找节点的三个助手（模块级，DetailPane 也直接用）。
 *
 * ⚠️ 「把三层摊平成一行行」的函数**不在这里** —— 用 `api.ts` 的 `collectStoryRows`。
 * 代码审查指出同一件事在本文件里曾有两份实现，漏改一份就漂移。
 */
function findGoal(goals: GoalNode[], id: string): GoalNode | null {
  return goals.find((goal) => goal.id === id) ?? null
}

function findActivity(
  goals: GoalNode[],
  id: string,
): { goal: GoalNode; activity: ActivityNode } | null {
  for (const goal of goals) {
    const activity = goal.activities.find((item) => item.id === id)
    if (activity) return { goal, activity }
  }
  return null
}

function findStory(
  goals: GoalNode[],
  id: string,
): { goal: GoalNode; activity: ActivityNode; story: StoryNode } | null {
  for (const goal of goals) {
    for (const activity of goal.activities) {
      const story = activity.stories.find((item) => item.id === id)
      if (story) return { goal, activity, story }
    }
  }
  return null
}

/**
 * 编辑器组件的 `key`：**必须随被编辑对象变化**。
 *
 * 代码审查的阻断项 B1：不给 key 时，React 会在同一位置复用同一个组件实例，
 * 而 `useState(初值)` 的初始化器**只在挂载时执行一次** —— 于是从「编辑目标 A」
 * 切到「编辑目标 B」时，表单里残留的仍是 A 的名字/描述/状态。
 * 更要命的是 `Editor` 的「只提交改动过的字段」是拿**新对象**当基准比较的，
 * A 的值会被判成"改动"，从而把 A 的数据写进 B，或凭空造出 A 的副本。
 * 加 key 强制重新挂载，顺带把 fieldErrors / failure / saving 一并重置。
 */
function editorKey(target: EditorTarget): string {
  if (target.kind === 'goal') {
    return target.mode === 'edit' ? `goal:edit:${target.goal.id}` : 'goal:create'
  }
  if (target.kind === 'activity') {
    return target.mode === 'edit'
      ? `activity:edit:${target.activity.id}`
      : `activity:create:${target.goal.id}`
  }
  return `story:create:${target.activity.id}`
}

export default function ProjectRequirementsPage() {
  const project = useOutletContext<ProjectView>()
  const navigate = useNavigate()
  const isPM = project.myRole === 'PM'

  const [goals, setGoals] = useState<GoalNode[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('tree')
  const [detailTab, setDetailTab] = useState<DetailTab>('detail')
  const [selection, setSelection] = useState<Selection | null>(null)
  /** 正在编辑 / 新建的表单；null 表示右栏显示详情。 */
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  /** 待确认的删除；null 表示没有确认框。 */
  const [confirm, setConfirm] = useState<{ kind: 'goal' | 'activity' | 'story'; id: string } | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    async (keepSelection = false) => {
      setLoading(true)
      setError(null)
      try {
        const tree = await getGoalTree(project.id)
        setGoals(tree)
        if (!keepSelection) {
          // 默认选中第一个需求，使右栏一进来就有内容（而不是空白面板）
          const first = collectStoryRows(tree)[0]
          setSelection(first ? { kind: 'story', id: first.story.id } : null)
        }
      } catch (caught) {
        setGoals(null)
        setError(caught instanceof ApiError ? caught : new ApiError(0, 'UNKNOWN', String(caught)))
      } finally {
        setLoading(false)
      }
    },
    [project.id],
  )

  useEffect(() => {
    void load()
  }, [load])

  function select(kind: Selection['kind'], id: string) {
    setSelection({ kind, id })
    setDetailTab('detail')
    setEditor(null)
  }

  /* ===========================================================================
   * 写路径（端点 11–22）
   *
   * 所有写操作都走同一个 `runWrite`：统一置 busy、统一把失败翻成可读提示。
   * 失败提示优先用**后端给的字段级错误码**（422 的 details[]），
   * 经 fieldLabel / fieldErrorHint 翻成中文后再显示 —— 界面上不出现内部字段名。
   * =========================================================================== */

  async function runWrite(action: () => Promise<void>) {
    setBusy(true)
    setNotice(null)
    try {
      await action()
    } catch (caught) {
      if (caught instanceof ApiError) {
        const detail = caught.details?.[0]
        setNotice({
          tone: 'warn',
          text:
            caught.status === 409
              ? `${caught.message}。系统不会连带删除下级内容。`
              : detail
                ? `${fieldLabel(detail.field)}：${fieldErrorHint(detail.code)}（HTTP ${caught.status}）`
                : `${caught.message}（HTTP ${caught.status}）`,
        })
      } else {
        setNotice({ tone: 'warn', text: String(caught) })
      }
    } finally {
      setBusy(false)
    }
  }

  function findGoalById(id: string): GoalNode | null {
    return goals ? findGoal(goals, id) : null
  }

  function findActivityById(id: string): { goal: GoalNode; activity: ActivityNode } | null {
    return goals ? findActivity(goals, id) : null
  }

  function findStoryById(
    id: string,
  ): { goal: GoalNode; activity: ActivityNode; story: StoryNode } | null {
    return goals ? findStory(goals, id) : null
  }

  /** 交换相邻两项，返回新的全量顺序 —— 端点 14 / 18 收的就是这份完整顺序。 */
  function swappedIds(list: Array<{ id: string }>, index: number, delta: number): string[] | null {
    const target = index + delta
    if (target < 0 || target >= list.length) return null
    const ids = list.map((x) => x.id)
    const tmp = ids[index]
    ids[index] = ids[target]
    ids[target] = tmp
    return ids
  }

  async function moveGoal(goal: GoalNode, delta: number) {
    if (!goals) return
    const index = goals.findIndex((g) => g.id === goal.id)
    const ids = swappedIds(goals, index, delta)
    if (!ids) return
    await runWrite(async () => {
      await reorderGoals(project.id, ids)
      await load(true)
      setSelection({ kind: 'goal', id: goal.id })
      setNotice({ tone: 'ok', text: '顺序已保存（提交的是全部目标的新顺序）。' })
    })
  }

  async function moveActivity(goal: GoalNode, activity: ActivityNode, delta: number) {
    const index = goal.activities.findIndex((a) => a.id === activity.id)
    const ids = swappedIds(goal.activities, index, delta)
    if (!ids) return
    await runWrite(async () => {
      await reorderActivities(goal.id, ids)
      await load(true)
      setSelection({ kind: 'activity', id: activity.id })
      setNotice({ tone: 'ok', text: '用户活动顺序已保存。' })
    })
  }

  async function doDelete() {
    if (!confirm) return
    const { kind, id } = confirm
    setConfirm(null)
    await runWrite(async () => {
      if (kind === 'goal') await deleteGoal(id)
      else if (kind === 'activity') await deleteActivity(id)
      else await deleteStory(id)
      setSelection(null)
      await load()
      setNotice({ tone: 'ok', text: '已删除。' })
    })
  }

  /** 写操作完成后：关掉表单、给一句提示、保持当前选中地重新拉树。 */
  function afterSaved(message: string) {
    setEditor(null)
    setNotice({ tone: 'ok', text: message })
    void load(true)
  }

  function dispatch(action: RowAction) {
    // ⚠️ 导航类动作（open-story）是**读**，必须排在 isPM 守卫**之前**。
    // 代码审查抓到过一次：把它放在守卫之后，只读角色点「打开需求详情页」会毫无反应
    // ——按钮还在，点击被静默吞掉。规则：守卫管**写**，不管导航。
    if (action.type === 'open-story') {
      navigate(`/projects/${project.id}/requirements/${action.id}`)
      return
    }
    if (!isPM) return
    setNotice(null)
    switch (action.type) {
      case 'create-goal':
        setEditor({ kind: 'goal', mode: 'create' })
        return
      case 'create-activity': {
        const goal = findGoalById(action.goalId)
        if (goal) setEditor({ kind: 'activity', mode: 'create', goal })
        return
      }
      case 'create-story': {
        const found = findActivityById(action.activityId)
        if (found) setEditor({ kind: 'story', mode: 'create', activity: found.activity })
        return
      }
      case 'edit-goal': {
        const goal = findGoalById(action.id)
        if (goal) setEditor({ kind: 'goal', mode: 'edit', goal })
        return
      }
      case 'edit-activity': {
        const found = findActivityById(action.id)
        if (found) setEditor({ kind: 'activity', mode: 'edit', goal: found.goal, activity: found.activity })
        return
      }
      case 'move-goal': {
        const goal = findGoalById(action.id)
        if (goal) void moveGoal(goal, action.delta)
        return
      }
      case 'move-activity': {
        const found = findActivityById(action.id)
        if (found) void moveActivity(found.goal, found.activity, action.delta)
        return
      }
      case 'delete':
        setConfirm({ kind: action.kind, id: action.id })
        return
    }
  }

  const storyRows = goals ? collectStoryRows(goals) : []
  const storyColumns: Column<(typeof storyRows)[number]>[] = [
    { key: 'title', header: '标题', render: (row) => row.story.title },
    {
      key: 'priority',
      header: '优先级',
      render: (row) => <PriorityBadge priority={row.story.priority} />,
    },
    { key: 'status', header: '状态', render: (row) => <StoryStatusBadge status={row.story.status} /> },
    { key: 'sensitive', header: '敏感', render: (row) => (row.story.isSensitive ? '是' : '—') },
    { key: 'goal', header: '所属目标', render: (row) => row.goal.name },
    { key: 'activity', header: '所属活动', render: (row) => row.activity.name },
    {
      key: 'open',
      header: '操作',
      render: (row) => (
        <Button variant="ghost" onClick={() => select('story', row.story.id)}>
          查看
        </Button>
      ),
    },
  ]

  // 删除确认框要显示的对象（按 confirm 的类型分别查一次，JSX 里就不用写类型判断）
  const confirmGoal = confirm?.kind === 'goal' ? findGoalById(confirm.id) : null
  const confirmActivity = confirm?.kind === 'activity' ? findActivityById(confirm.id) : null
  const confirmStory = confirm?.kind === 'story' ? findStoryById(confirm.id) : null

  /**
   * 本地**已经能判定**的「删不掉」两种情况：目标下面有活动、活动下面有需求。
   *
   * 需求下面是否还有任务，本页拿不到（任务列表属端点 24），所以那一种仍由服务端裁决 ——
   * 那条 DELETE 是有意义的试探，409 回来再提示是正确做法。
   * 但对上面两种，界面既然已经知道删不掉，就**不该把请求发出去**。
   */
  const confirmBlocked =
    (confirmGoal !== null && confirmGoal.activities.length > 0) ||
    (confirmActivity !== null && confirmActivity.activity.stories.length > 0)
  const confirmStoryCount = confirmGoal
    ? confirmGoal.activities.reduce((sum, a) => sum + a.stories.length, 0)
    : 0

  return (
    <div className="page">
      <PageHeader
        title="需求（用户故事）"
        description={
          <>
            业务目标 → 用户活动 → 用户需求 三级结构。排序固定按服务端的返回顺序展示。
          </>
        }
        actions={
          <Button variant="ghost" onClick={() => void load(true)} disabled={loading}>
            {loading ? '加载中…' : '刷新'}
          </Button>
        }
      />

      <div className="req-tabs">
        {(
          [
            ['tree', '需求层级'],
            ['stories', `需求列表（${storyRows.length}）`],
            ['terms', '术语对照与缺口'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={view === key ? 'req-tab is-active' : 'req-tab'}
            onClick={() => setView(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="req-error">
          <p className="req-error-head">
            加载失败<span className="req-mono">（HTTP {error.status}）</span>
            <span className="req-mono"> code={error.code}</span>
          </p>
          <p className="req-error-message">{error.message}</p>
          <p className="req-error-advice">
            这个项目可能已被删除，或者你不在这个项目里 —— 两种情况给出的是同一个提示。
            如果你刚被移出项目，请返回项目列表。
          </p>
        </div>
      ) : null}

      {loading && goals === null && !error ? <div className="page-loading">加载中…</div> : null}

      {notice ? (
        <div
          className={notice.tone === 'warn' ? 'req-warn' : 'req-ok'}
          style={{ marginBottom: '0.9rem' }}
          role="status"
        >
          {notice.text}
        </div>
      ) : null}

      {/* ⚠️ 空目标时**也必须渲染** .req-split —— 否则 TreePane 不渲染，
          「＋ 新建业务目标」按钮就不存在，用户永远建不出第一个目标（死胡同）。
          这个 bug 是真实走查时由人类第一个发现的：种子数据里没有目标，一进页面就是空态。
          空态本身已移进 TreePane，与它的「出口」放在同一屏。 */}
      {goals !== null ? (
        <div className="req-split">
          <section className="req-main">
            {view === 'tree' ? (
              <TreePane
                goals={goals}
                selection={selection}
                onSelect={select}
                isPM={isPM}
                busy={busy}
                onAction={dispatch}
              />
            ) : null}
            {view === 'stories' ? (
              <DataTable
                columns={storyColumns}
                rows={storyRows}
                rowKey={(row) => row.story.id}
                empty="还没有用户故事"
              />
            ) : null}
            {view === 'terms' ? <TermsPane /> : null}
          </section>
          <aside className="req-detail">
            {view === 'terms' ? (
              <p className="req-placeholder">
                左侧是术语对照与缺口清单。切回「需求层级」或「需求列表」并选中任一节点，
                此处会显示它的字段详情。
              </p>
            ) : editor ? (
              <RequirementEditor
                key={editorKey(editor)}
                projectId={project.id}
                target={editor}
                onSaved={afterSaved}
                onCancel={() => setEditor(null)}
              />
            ) : (
              <DetailPane
                goals={goals}
                projectId={project.id}
                selection={selection}
                tab={detailTab}
                onTab={setDetailTab}
                onSelect={select}
                isPM={isPM}
                busy={busy}
                onAction={dispatch}
              />
            )}
          </aside>
        </div>
      ) : null}

      {confirm ? (
        <ConfirmDialog
          title={
            confirmBlocked
              ? confirmGoal
                ? '这个业务目标还不能删除'
                : '这个用户活动还不能删除'
              : confirmGoal
                ? '确认删除这个业务目标？'
                : confirmActivity
                  ? '确认删除这个用户活动？'
                  : '确认删除这条需求？'
          }
          confirmText={confirmBlocked ? '知道了' : '确认删除'}
          danger={!confirmBlocked}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            // ⚠️ 已知删不掉时，这个按钮**只是「知道了」**，绝不能真发 DELETE ——
            // 那必然 409，而且按钮文案在骗人。
            // 这个 bug 由人类真实走查抓到：点「知道了」竟然发出了一条 DELETE 并返回 409。
            // 教训：文案/标题说"不能删"、而 onClick 仍无条件调删除，就是自相矛盾。
            if (confirmBlocked) {
              setConfirm(null)
              setNotice({
                tone: 'warn',
                text: confirmGoal
                  ? `「${confirmGoal.name}」下还有 ${confirmGoal.activities.length} 个用户活动，请先处理它们再删除。系统不会连带删除。`
                  : `「${confirmActivity?.activity.name ?? ''}」下还有 ${confirmActivity?.activity.stories.length ?? 0} 条用户需求，请先处理它们再删除。系统不会连带删除。`,
              })
              return
            }
            void doDelete()
          }}
        >
          {confirmGoal ? (
            <dl className="req-fields">
              <dt>名称</dt>
              <dd>{confirmGoal.name}</dd>
              <dt>下属活动</dt>
              <dd>{confirmGoal.activities.length} 个</dd>
              <dt>下属需求</dt>
              <dd>{confirmStoryCount} 条</dd>
            </dl>
          ) : confirmActivity ? (
            <dl className="req-fields">
              <dt>名称</dt>
              <dd>{confirmActivity.activity.name}</dd>
              <dt>下属需求</dt>
              <dd>{confirmActivity.activity.stories.length} 条</dd>
            </dl>
          ) : confirmStory ? (
            <dl className="req-fields">
              <dt>需求标题</dt>
              <dd>{confirmStory.story.title}</dd>
              <dt>需求编号</dt>
              <dd className="req-mono">{confirmStory.story.id}</dd>
            </dl>
          ) : (
            <p className="req-placeholder">这一项已经不在当前列表里了，请刷新后重试。</p>
          )}
          <p className="req-hint" style={{ color: confirmBlocked ? '#fcd34d' : '#fecaca' }}>
            {confirmGoal?.activities.length
              ? '请先处理完这些下级内容，再来删除本目标。系统不会连带删除它们。'
              : confirmActivity?.activity.stories.length
                ? '请先把这些需求移走或删除，再来删除本活动。'
                : confirmStory
                  ? '若这条需求下还有任务，删除会被拒绝 —— 任务要先处理掉。'
                  : ''}
          </p>
        </ConfirmDialog>
      ) : null}
    </div>
  )
}

/** 左栏（树）：三层结构 + 下属数量；点任意一行 → 右栏显示其详情。 */
function TreePane({
  goals,
  selection,
  onSelect,
  isPM,
  busy,
  onAction,
}: {
  goals: GoalNode[]
  selection: Selection | null
  onSelect: (kind: Selection['kind'], id: string) => void
  isPM: boolean
  busy: boolean
  onAction: (action: RowAction) => void
}) {
  function rowClass(kind: Selection['kind'], id: string) {
    const active = selection !== null && selection.kind === kind && selection.id === id
    return active ? 'req-node-row is-selected' : 'req-node-row'
  }

  return (
    <div>
      <p className="req-pane-sub">
        目标与用户活动按序号排列，需求按创建时间排列。数量由当前显示的内容统计得出。
      </p>

      {/* 空态放在树的最上方，但**下方仍然渲染「＋ 新建业务目标」** ——
          空态与它的出口必须在同一屏，否则第一个目标永远建不出来。 */}
      {goals.length === 0 ? (
        <EmptyState
          title="该项目还没有业务目标"
          hint={
            isPM
              ? '业务目标是需求层级的第一层。用下面的按钮建立第一个目标，再往下添加用户活动与需求。'
              : '业务目标是需求层级的第一层。你没有写入权限，请让项目经理先建立目标。'
          }
        />
      ) : null}

      {goals.map((goal, goalIndex) => {
        const storyTotal = goal.activities.reduce((sum, activity) => sum + activity.stories.length, 0)
        return (
          <div className="req-tree-goal" key={goal.id}>
            {/* 行 = 容器（负责边框与选中态）+ 只负责选中的按钮 + 右侧操作。
                操作按钮与选中按钮是「兄弟」关系：把 button 嵌在 button 里是非法
                HTML，浏览器会把内层按钮搬到外层之外，缩进与样式都会失控。 */}
            <div className={rowClass('goal', goal.id)}>
              <button
                type="button"
                className="req-node-hit"
                onClick={() => onSelect('goal', goal.id)}
              >
                <span className="req-node-kind">目标</span>
                <span className="req-node-name">{goal.name}</span>
                <GoalStatusBadge status={goal.status} />
                <span className="req-count">{goal.activities.length} 个活动</span>
                <span className="req-count">{storyTotal} 个需求</span>
              </button>
              {isPM ? (
                <span className="req-row-ops">
                  <span className="req-order">#{goal.sortOrder}</span>
                  <button
                    type="button"
                    className="req-button-small"
                    disabled={busy || goalIndex === 0}
                    title={goalIndex === 0 ? '已经是第一个' : '与上一个交换顺序'}
                    onClick={() => onAction({ type: 'move-goal', id: goal.id, delta: -1 })}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="req-button-small"
                    disabled={busy || goalIndex === goals.length - 1}
                    title={goalIndex === goals.length - 1 ? '已经是最后一个' : '与下一个交换顺序'}
                    onClick={() => onAction({ type: 'move-goal', id: goal.id, delta: 1 })}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="req-button-small req-button-plain"
                    disabled={busy}
                    onClick={() => onAction({ type: 'edit-goal', id: goal.id })}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="req-button-small req-button-danger"
                    disabled={busy}
                    onClick={() => onAction({ type: 'delete', kind: 'goal', id: goal.id })}
                  >
                    删除
                  </button>
                </span>
              ) : (
                <span className="req-row-ops">
                  <span className="req-order">#{goal.sortOrder}</span>
                </span>
              )}
            </div>

            {goal.activities.map((activity, activityIndex) => (
              <div className="req-tree-activity" key={activity.id}>
                <div className={rowClass('activity', activity.id)}>
                  <button
                    type="button"
                    className="req-node-hit"
                    onClick={() => onSelect('activity', activity.id)}
                  >
                    <span className="req-node-kind">活动</span>
                    <span className="req-node-name">{activity.name}</span>
                    <GoalStatusBadge status={activity.status} />
                    <span className="req-count">{activity.stories.length} 个需求</span>
                  </button>
                  {isPM ? (
                    <span className="req-row-ops">
                      <span className="req-order">#{activity.sortOrder}</span>
                      <button
                        type="button"
                        className="req-button-small"
                        disabled={busy || activityIndex === 0}
                        title={activityIndex === 0 ? '已经是第一个' : '与上一个交换顺序'}
                        onClick={() => onAction({ type: 'move-activity', id: activity.id, delta: -1 })}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="req-button-small"
                        disabled={busy || activityIndex === goal.activities.length - 1}
                        title={
                          activityIndex === goal.activities.length - 1
                            ? '已经是最后一个'
                            : '与下一个交换顺序'
                        }
                        onClick={() => onAction({ type: 'move-activity', id: activity.id, delta: 1 })}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="req-button-small req-button-plain"
                        disabled={busy}
                        onClick={() => onAction({ type: 'edit-activity', id: activity.id })}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="req-button-small req-button-danger"
                        disabled={busy}
                        onClick={() => onAction({ type: 'delete', kind: 'activity', id: activity.id })}
                      >
                        删除
                      </button>
                    </span>
                  ) : null}
                </div>

                {activity.stories.length === 0 ? (
                  <p className="req-empty-inline">该活动下暂无用户故事。</p>
                ) : null}

                {activity.stories.map((story) => (
                  <div className="req-tree-story" key={story.id}>
                    <div className={rowClass('story', story.id)}>
                      <button
                        type="button"
                        className="req-node-hit"
                        onClick={() => onSelect('story', story.id)}
                      >
                        <span className="req-node-name">{story.title}</span>
                        <PriorityBadge priority={story.priority} />
                        <StoryStatusBadge status={story.status} />
                        {story.isSensitive ? (
                          <span className="req-badge req-badge-sensitive">敏感</span>
                        ) : null}
                      </button>
                      {isPM ? (
                        <span className="req-row-ops">
                          {/* 需求的「编辑」跳到详情页 —— 端点 21 的表单只在那一页做一份 */}
                          <button
                            type="button"
                            className="req-button-small req-button-plain"
                            disabled={busy}
                            onClick={() => onAction({ type: 'open-story', id: story.id })}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className="req-button-small req-button-danger"
                            disabled={busy}
                            onClick={() => onAction({ type: 'delete', kind: 'story', id: story.id })}
                          >
                            删除
                          </button>
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}

                {isPM ? (
                  <div className="req-add-row level-story">
                    <button
                      type="button"
                      className="req-button-small"
                      disabled={busy}
                      onClick={() => onAction({ type: 'create-story', activityId: activity.id })}
                    >
                      ＋ 新建需求
                    </button>
                  </div>
                ) : null}
              </div>
            ))}

            {isPM ? (
              <div className="req-add-row level-activity">
                <button
                  type="button"
                  className="req-button-small"
                  disabled={busy}
                  onClick={() => onAction({ type: 'create-activity', goalId: goal.id })}
                >
                  ＋ 新建用户活动
                </button>
              </div>
            ) : null}
          </div>
        )
      })}

      {/* 新建业务目标放在树的**最下方**：三级的新建入口都在树里、按层级缩进，
          不必去页面顶部找（人类审核时明确要求过这一条）。 */}
      {isPM ? (
        <div className="req-add-row level-goal">
          <button
            type="button"
            className="req-button-small"
            disabled={busy}
            onClick={() => onAction({ type: 'create-goal' })}
          >
            ＋ 新建业务目标
          </button>
        </div>
      ) : null}

      <p className="req-note">
        提示：一条需求还可以继续拆成任务，任务列表在需求详情页查看。
      </p>
    </div>
  )
}

/** 右栏：选中项的详情（面包屑 + 分页签 + 字段 + 子项 + 操作）。 */
function DetailPane({
  goals,
  projectId,
  selection,
  tab,
  onTab,
  onSelect,
  isPM,
  busy,
  onAction,
}: {
  goals: GoalNode[]
  projectId: string
  selection: Selection | null
  tab: DetailTab
  onTab: (tab: DetailTab) => void
  onSelect: (kind: Selection['kind'], id: string) => void
  isPM: boolean
  busy: boolean
  onAction: (action: RowAction) => void
}) {
  if (selection === null) {
    return <p className="req-placeholder">左侧还没有可展示的节点。</p>
  }

  if (selection.kind === 'goal') {
    const goal = findGoal(goals, selection.id)
    if (!goal) return <p className="req-placeholder">未选中的目标。</p>
    const storyTotal = goal.activities.reduce((sum, activity) => sum + activity.stories.length, 0)
    const rows = goal.activities.map((activity) => ({
      id: activity.id,
      name: activity.name,
      status: activity.status,
      storyCount: activity.stories.length,
    }))
    return (
      <div>
        <div className="req-breadcrumb">
          <span>项目</span>
          <span>›</span>
          <button
            type="button"
            className="req-crumb req-crumb-current"
            onClick={() => onSelect('goal', goal.id)}
          >
            {goal.name}
          </button>
        </div>
        <p className="req-pane-title">{goal.name}</p>
        <p className="req-pane-sub">
          <GoalStatusBadge status={goal.status} />{' '}
          <span className="req-count">{goal.activities.length} 个活动</span>{' '}
          <span className="req-count">{storyTotal} 个需求</span>
        </p>
        <Tabs tab={tab} onTab={onTab} />
        {tab === 'ac' ? (
          <p className="req-placeholder">业务目标没有验收标准字段，验收标准挂在用户故事上。</p>
        ) : (
          <dl className="req-fields">
            <dt>名称</dt>
            <dd>{goal.name}</dd>
            <dt>描述</dt>
            <dd>{goal.description ?? '（无）'}</dd>
            <dt>状态</dt>
            <dd>{goal.status}</dd>
            <dt>排序序号</dt>
            <dd>{goal.sortOrder}</dd>
            <dt>目标编号</dt>
            <dd className="req-mono">{goal.id}</dd>
          </dl>
        )}
        <p className="req-placeholder">
          优先级只存在于需求层；业务目标与用户活动没有优先级字段，因此这里不显示优先级。
        </p>
        <Ops
          kind="goal"
          id={goal.id}
          isPM={isPM}
          busy={busy}
          canMoveUp={goals.findIndex((g) => g.id === goal.id) > 0}
          canMoveDown={goals.findIndex((g) => g.id === goal.id) < goals.length - 1}
          onAction={onAction}
        />
        <p className="req-side-title">下属活动</p>
        <DataTable
          columns={[
            { key: 'name', header: '活动', render: (row) => row.name },
            {
              key: 'status',
              header: '状态',
              render: (row) => <GoalStatusBadge status={row.status} />,
            },
            { key: 'count', header: '需求数', render: (row) => row.storyCount },
            {
              key: 'open',
              header: '操作',
              render: (row) => (
                <Button variant="ghost" onClick={() => onSelect('activity', row.id)}>
                  查看
                </Button>
              ),
            },
          ]}
          rows={rows}
          rowKey={(row) => row.id}
          empty="该目标下暂无用户活动。"
        />
      </div>
    )
  }

  if (selection.kind === 'activity') {
    const found = findActivity(goals, selection.id)
    if (!found) return <p className="req-placeholder">未选中的活动。</p>
    const { goal, activity } = found
    const rows = activity.stories.map((story) => ({
      id: story.id,
      title: story.title,
      priority: story.priority,
      status: story.status,
    }))
    return (
      <div>
        <div className="req-breadcrumb">
          <span>项目</span>
          <span>›</span>
          <button type="button" className="req-crumb" onClick={() => onSelect('goal', goal.id)}>
            {goal.name}
          </button>
          <span>›</span>
          <button
            type="button"
            className="req-crumb req-crumb-current"
            onClick={() => onSelect('activity', activity.id)}
          >
            {activity.name}
          </button>
        </div>
        <p className="req-pane-title">{activity.name}</p>
        <p className="req-pane-sub">
          <GoalStatusBadge status={activity.status} />{' '}
          <span className="req-count">{activity.stories.length} 个需求</span>
        </p>
        <Tabs tab={tab} onTab={onTab} />
        {tab === 'ac' ? (
          <p className="req-placeholder">用户活动没有验收标准字段，验收标准挂在用户故事上。</p>
        ) : (
          <dl className="req-fields">
            <dt>名称</dt>
            <dd>{activity.name}</dd>
            <dt>描述</dt>
            <dd>{activity.description ?? '（无）'}</dd>
            <dt>状态</dt>
            <dd>{activity.status}</dd>
            <dt>排序序号</dt>
            <dd>{activity.sortOrder}</dd>
            <dt>活动编号</dt>
            <dd className="req-mono">{activity.id}</dd>
            <dt>所属目标编号</dt>
            <dd className="req-mono">{activity.goalId}</dd>
          </dl>
        )}
        <Ops
          kind="activity"
          id={activity.id}
          isPM={isPM}
          busy={busy}
          canMoveUp={goal.activities.findIndex((a) => a.id === activity.id) > 0}
          canMoveDown={
            goal.activities.findIndex((a) => a.id === activity.id) < goal.activities.length - 1
          }
          onAction={onAction}
        />
        <p className="req-side-title">下属需求</p>
        <DataTable
          columns={[
            { key: 'title', header: '标题', render: (row) => row.title },
            {
              key: 'priority',
              header: '优先级',
              render: (row) => <PriorityBadge priority={row.priority} />,
            },
            {
              key: 'status',
              header: '状态',
              render: (row) => <StoryStatusBadge status={row.status} />,
            },
            {
              key: 'open',
              header: '操作',
              render: (row) => (
                <Button variant="ghost" onClick={() => onSelect('story', row.id)}>
                  查看
                </Button>
              ),
            },
          ]}
          rows={rows}
          rowKey={(row) => row.id}
          empty="该活动下暂无用户故事。"
        />
      </div>
    )
  }

  const found = findStory(goals, selection.id)
  if (!found) return <p className="req-placeholder">未选中的需求。</p>
  const { goal, activity, story } = found
  return (
    <div>
      <div className="req-breadcrumb">
        <span>项目</span>
        <span>›</span>
        <button type="button" className="req-crumb" onClick={() => onSelect('goal', goal.id)}>
          {goal.name}
        </button>
        <span>›</span>
        <button type="button" className="req-crumb" onClick={() => onSelect('activity', activity.id)}>
          {activity.name}
        </button>
        <span>›</span>
        <span className="req-crumb-current">{story.title}</span>
      </div>
      <p className="req-pane-title">{story.title}</p>
      <p className="req-pane-sub">
        <PriorityBadge priority={story.priority} /> <StoryStatusBadge status={story.status} />{' '}
        {story.isSensitive ? <span className="req-badge req-badge-sensitive">敏感</span> : null}
      </p>
      <Tabs tab={tab} onTab={onTab} />
      <p className="req-story-sentence">
        作为 <em>{story.roleText}</em>，我要 <em>{story.capabilityText}</em>，以便{' '}
        <em>{story.valueText}</em>
      </p>
      {tab === 'ac' ? (
        <dl className="req-fields">
          <dt>验收标准</dt>
          <dd>{story.acceptanceCriteria ?? '（未填写）'}</dd>
        </dl>
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
          <dd>{story.priority}</dd>
          <dt>状态</dt>
          <dd>{story.status}</dd>
          <dt>敏感需求</dt>
          <dd>{story.isSensitive ? '是' : '否'}</dd>
          <dt>创建时间</dt>
          <dd>{story.createdAt}</dd>
          <dt>需求编号</dt>
          <dd className="req-mono">{story.id}</dd>
        </dl>
      )}
      <p className="req-hint">
        可深链的详情页：
        {/* 用 <Link> 而不是 button：导航是**读**动作，只读角色也必须能进详情页
            （审查指出原先用 button + dispatch 的 isPM 守卫，会让 MEMBER/VIEWER
            在界面上完全没有入口）。<Link> 还恢复了复制链接与新标签页打开。 */}
        <Link className="link" to={`/projects/${projectId}/requirements/${story.id}`}>
          打开需求详情页
        </Link>
      </p>
      <Ops kind="story" id={story.id} isPM={isPM} busy={busy} onAction={onAction} />
    </div>
  )
}

function Tabs({ tab, onTab }: { tab: DetailTab; onTab: (tab: DetailTab) => void }) {
  const defs: ReadonlyArray<readonly [DetailTab, string]> = [
    ['detail', '详情'],
    ['ac', '验收标准'],
  ]
  return (
    <div className="req-tabs">
      {defs.map(([key, label]) => (
        <button
          key={key}
          type="button"
          className={tab === key ? 'req-tab is-active' : 'req-tab'}
          onClick={() => onTab(key)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/**
 * 右栏的操作区：上移 / 下移 / 编辑 / 删除，按选中节点的类型分派给 `dispatch`。
 *
 * 需求（story）的「编辑」**不在这里编辑**，而是跳到需求详情页 ——
 * 端点 21 的表单只在那一页做一份；同一件事在两地各实现一次，必然漂移。
 */
function Ops({
  kind,
  id,
  isPM,
  busy,
  canMoveUp,
  canMoveDown,
  onAction,
}: {
  kind: 'goal' | 'activity' | 'story'
  id: string
  isPM: boolean
  busy: boolean
  canMoveUp?: boolean
  canMoveDown?: boolean
  onAction: (action: RowAction) => void
}) {
  return (
    <div className="req-op-block">
      <p className="req-side-title">操作</p>
      {isPM ? (
        <>
          <div className="req-op-row">
            {kind === 'story' ? (
              <button
                type="button"
                className="req-button-small req-button-plain"
                disabled={busy}
                onClick={() => onAction({ type: 'open-story', id })}
              >
                编辑
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="req-button-small"
                  disabled={busy || !canMoveUp}
                  title={canMoveUp ? '与上一个交换顺序' : '已经是第一个'}
                  onClick={() =>
                    onAction(
                      kind === 'goal'
                        ? { type: 'move-goal', id, delta: -1 }
                        : { type: 'move-activity', id, delta: -1 },
                    )
                  }
                >
                  ↑ 上移
                </button>
                <button
                  type="button"
                  className="req-button-small"
                  disabled={busy || !canMoveDown}
                  title={canMoveDown ? '与下一个交换顺序' : '已经是最后一个'}
                  onClick={() =>
                    onAction(
                      kind === 'goal'
                        ? { type: 'move-goal', id, delta: 1 }
                        : { type: 'move-activity', id, delta: 1 },
                    )
                  }
                >
                  ↓ 下移
                </button>
                <button
                  type="button"
                  className="req-button-small req-button-plain"
                  disabled={busy}
                  onClick={() =>
                    onAction(
                      kind === 'goal' ? { type: 'edit-goal', id } : { type: 'edit-activity', id },
                    )
                  }
                >
                  编辑
                </button>
              </>
            )}
            <button
              type="button"
              className="req-button-small req-button-danger"
              disabled={busy}
              onClick={() => onAction({ type: 'delete', kind, id })}
            >
              删除
            </button>
          </div>
          <p className="req-hint">
            上移 / 下移提交的是<strong>全部同级项的新顺序</strong>（第 1 个变成 0、第 2 个变成 1）；
            在首 / 末位置时按钮自动禁用。需求下面还有任务时，删除会被服务端拒绝。
          </p>
        </>
      ) : (
        <>
          <p className="req-readonly">你的角色对这个项目只有查看权限。</p>
          <p className="req-hint">
            界面隐藏只是体验优化；即使绕过界面直接发请求，服务端也会拒绝。
          </p>
        </>
      )}
    </div>
  )
}

/** 术语对照与缺口清单：把「懂 PMBOK、且知道差在哪」直接摆在页面上。 */
function TermsPane() {
  return (
    <div>
      <p className="req-pane-sub">
        本页用词与课程材料存在口径差：实验一指导书要求 <b>MoSCoW</b> 与「骨干活动」，
        PMBOK 用「需求 / 工作包 / 需求跟踪矩阵」，而平台线上值冻结为 P0/P1/P2。
        这里把四方用词与<b>已知缺口</b>显式列出，供评审核对。
      </p>

      <p className="req-side-title">术语对照</p>
      <table className="req-table">
        <thead>
          <tr>
            <th>平台界面</th>
            <th>线上字段（不改）</th>
            <th>实验指导书</th>
            <th>PMBOK</th>
            <th>建议</th>
          </tr>
        </thead>
        <tbody>
          {TERM_ROWS.map((row) => (
            <tr key={row.ui}>
              <td>{row.ui}</td>
              <td className="req-mono">{row.field}</td>
              <td>{row.guide}</td>
              <td>{row.pmbok}</td>
              <td>
                {row.change === 'dual' ? (
                  <span className="req-badge req-badge-goal">建议双标签</span>
                ) : null}{' '}
                {row.suggest}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="req-side-title">已知缺口</p>
      <table className="req-table">
        <thead>
          <tr>
            <th>缺口</th>
            <th>出处</th>
            <th>影响</th>
            <th>建议处置</th>
          </tr>
        </thead>
        <tbody>
          {GAP_ROWS.map((row) => (
            <tr key={row.gap}>
              <td>{row.gap}</td>
              <td>{row.source}</td>
              <td>{row.impact}</td>
              <td>{row.plan}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="req-note">
        本期<b>不改线上字段</b>：契约决策 I-1 已把「线上英文常量」与「界面中文标签」分开，
        因此改界面用词不构成契约变更；而补 RTM 字段需要动冻结件（
        <code>src/shared/types.ts</code>、<code>schema.prisma</code>），须走契约变更流程，留 Sprint 2。
      </p>
    </div>
  )
}

