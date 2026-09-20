import { useCallback, useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import type { ActivityNode, GoalNode, ProjectView, StoryNode } from '../../../src/shared/types'
import { ApiError } from '../api'
import Button from '../components/Button'
import DataTable, { type Column } from '../components/DataTable'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import { getGoalTree } from './requirement/api'
import {
  GOAL_STATUS_LABEL,
  GAP_ROWS,
  PRIORITY_LABEL,
  STORY_STATUS_LABEL,
  TERM_ROWS,
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
 */
type View = 'tree' | 'stories' | 'terms'
type DetailTab = 'detail' | 'ac' | 'raw'
type Selection =
  | { kind: 'goal'; id: string }
  | { kind: 'activity'; id: string }
  | { kind: 'story'; id: string }

/** 目标 / 活动状态徽标（决策 I-1：GoalStatus = ACTIVE | DONE）。 */
function GoalStatusBadge({ status }: { status: string }) {
  const label =
    status === 'ACTIVE' || status === 'DONE' ? GOAL_STATUS_LABEL[status] : `${status}（契约外取值）`
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
      : `${status}（契约外取值）`
  return <span className="req-badge req-badge-story">{label}</span>
}

function PriorityBadge({ priority }: { priority: string }) {
  const label =
    priority === 'P0' || priority === 'P1' || priority === 'P2' ? PRIORITY_LABEL[priority] : priority
  return <span className="req-badge req-badge-priority">{label}</span>
}

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

function collectStories(goals: GoalNode[]) {
  const rows: Array<{ goal: GoalNode; activity: ActivityNode; story: StoryNode }> = []
  for (const goal of goals) {
    for (const activity of goal.activities) {
      for (const story of activity.stories) rows.push({ goal, activity, story })
    }
  }
  return rows
}

export default function ProjectRequirementsPage() {
  const project = useOutletContext<ProjectView>()
  const [goals, setGoals] = useState<GoalNode[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('tree')
  const [detailTab, setDetailTab] = useState<DetailTab>('detail')
  const [selection, setSelection] = useState<Selection | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const tree = await getGoalTree(project.id)
      setGoals(tree)
      // 默认选中第一个需求，使右栏一进来就有内容（而不是空白面板）
      const first = collectStories(tree)[0]
      setSelection(first ? { kind: 'story', id: first.story.id } : null)
    } catch (caught) {
      setGoals(null)
      setError(caught instanceof ApiError ? caught : new ApiError(0, 'UNKNOWN', String(caught)))
    } finally {
      setLoading(false)
    }
  }, [project.id])

  useEffect(() => {
    void load()
  }, [load])

  function select(kind: Selection['kind'], id: string) {
    setSelection({ kind, id })
    setDetailTab('detail')
  }

  const storyRows = goals ? collectStories(goals) : []
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

  return (
    <div className="page">
      <PageHeader
        title="需求（用户故事）"
        description={
          <>
            业务目标 → 骨干活动 → 需求 三级结构，来自端点 10（权限 <code>project.read</code>）。
            排序按后端响应序渲染，前端不重排。
          </>
        }
        actions={
          <Button variant="ghost" onClick={() => void load()} disabled={loading}>
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
            契约 I-3 要求「项目不存在」与「你不是该项目成员」返回<b>完全一致</b>的 404，
            因此界面无法区分两者。若刚被移出项目，请返回项目列表。
          </p>
        </div>
      ) : null}

      {loading && goals === null && !error ? <div className="page-loading">加载中…</div> : null}

      {goals !== null && goals.length === 0 ? (
        <EmptyState
          title="该项目还没有业务目标"
          hint="端点 10 返回了空的 items。创建业务目标的界面属后续功能块（端点 11）。"
        />
      ) : null}

      {goals !== null && goals.length > 0 ? (
        <div className="req-split">
          <section className="req-main">
            {view === 'tree' ? (
              <TreePane goals={goals} selection={selection} onSelect={select} />
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
            ) : (
              <DetailPane
                goals={goals}
                projectId={project.id}
                selection={selection}
                tab={detailTab}
                onTab={setDetailTab}
                onSelect={select}
              />
            )}
          </aside>
        </div>
      ) : null}
    </div>
  )
}

/** 左栏（树）：三层结构 + 下属数量；点任意一行 → 右栏显示其详情。 */
function TreePane({
  goals,
  selection,
  onSelect,
}: {
  goals: GoalNode[]
  selection: Selection | null
  onSelect: (kind: Selection['kind'], id: string) => void
}) {
  function rowClass(kind: Selection['kind'], id: string) {
    const active = selection !== null && selection.kind === kind && selection.id === id
    return active ? 'req-node-row is-selected' : 'req-node-row'
  }

  return (
    <div>
      <p className="req-pane-sub">
        层级按后端响应顺序渲染（端点 10：目标与活动按 sortOrder 升序、需求按 createdAt 升序）。
        下属数量由前端从 activities.length / stories.length 得出 —— 契约 I-2 的节点没有计数字段。
      </p>
      {goals.map((goal) => {
        const storyTotal = goal.activities.reduce((sum, activity) => sum + activity.stories.length, 0)
        return (
          <div className="req-tree-goal" key={goal.id}>
            <button
              type="button"
              className={rowClass('goal', goal.id)}
              onClick={() => onSelect('goal', goal.id)}
            >
              <span className="req-node-kind">目标</span>
              <span className="req-node-name">{goal.name}</span>
              <GoalStatusBadge status={goal.status} />
              <span className="req-count">{goal.activities.length} 个活动</span>
              <span className="req-count">{storyTotal} 个需求</span>
            </button>

            {goal.activities.map((activity) => (
              <div className="req-tree-activity" key={activity.id}>
                <button
                  type="button"
                  className={rowClass('activity', activity.id)}
                  onClick={() => onSelect('activity', activity.id)}
                >
                  <span className="req-node-kind">活动</span>
                  <span className="req-node-name">{activity.name}</span>
                  <GoalStatusBadge status={activity.status} />
                  <span className="req-count">{activity.stories.length} 个需求</span>
                </button>

                {activity.stories.length === 0 ? (
                  <p className="req-empty-inline">该活动下暂无用户故事。</p>
                ) : null}

                {activity.stories.map((story) => (
                  <div className="req-tree-story" key={story.id}>
                    <button
                      type="button"
                      className={rowClass('story', story.id)}
                      onClick={() => onSelect('story', story.id)}
                    >
                      <span className="req-node-name">{story.title}</span>
                      <PriorityBadge priority={story.priority} />
                      <StoryStatusBadge status={story.status} />
                      {story.isSensitive ? (
                        <span className="req-badge req-badge-sensitive">敏感</span>
                      ) : null}
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )
      })}
      <p className="req-note">
        提示：用户故事的下属是任务（属 M5）；端点 24 <code>GET /stories/:storyId/tasks</code>
        交付前这里不显示任务数 —— 显示 0 会与「端点不存在」混淆。
      </p>
    </div>
  )
}

/** 右栏：选中项的详情（面包屑 + 分页签 + 字段 + 子项 + 操作占位）。 */
function DetailPane({
  goals,
  projectId,
  selection,
  tab,
  onTab,
  onSelect,
}: {
  goals: GoalNode[]
  projectId: string
  selection: Selection | null
  tab: DetailTab
  onTab: (tab: DetailTab) => void
  onSelect: (kind: Selection['kind'], id: string) => void
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
        {tab === 'raw' ? (
          <pre className="req-mono">
            {JSON.stringify(
              {
                id: goal.id,
                projectId: goal.projectId,
                name: goal.name,
                description: goal.description,
                status: goal.status,
                sortOrder: goal.sortOrder,
              },
              null,
              2,
            )}
          </pre>
        ) : (
          <dl className="req-fields">
            <dt>name</dt>
            <dd>{goal.name}</dd>
            <dt>description</dt>
            <dd>{goal.description ?? '（无）'}</dd>
            <dt>status</dt>
            <dd>{goal.status}</dd>
            <dt>sortOrder</dt>
            <dd>{goal.sortOrder}</dd>
            <dt>goalId</dt>
            <dd className="req-mono">{goal.id}</dd>
          </dl>
        )}
        <p className="req-placeholder">
          契约 I-2 里 <code>BusinessGoal</code> / <code>UserActivity</code>{' '}
          <b>没有 priority 字段</b>（只有 <code>UserStory</code> 有），所以 AC-US-03-09 的
          「名称 / 状态 / 优先级 / 下属数量」只能在需求层完整满足。
        </p>
        <Ops />
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
        {tab === 'raw' ? (
          <pre className="req-mono">
            {JSON.stringify(
              {
                id: activity.id,
                projectId: activity.projectId,
                goalId: activity.goalId,
                name: activity.name,
                description: activity.description,
                status: activity.status,
                sortOrder: activity.sortOrder,
              },
              null,
              2,
            )}
          </pre>
        ) : (
          <dl className="req-fields">
            <dt>name</dt>
            <dd>{activity.name}</dd>
            <dt>description</dt>
            <dd>{activity.description ?? '（无）'}</dd>
            <dt>status</dt>
            <dd>{activity.status}</dd>
            <dt>sortOrder</dt>
            <dd>{activity.sortOrder}</dd>
            <dt>activityId</dt>
            <dd className="req-mono">{activity.id}</dd>
            <dt>goalId</dt>
            <dd className="req-mono">{activity.goalId}</dd>
          </dl>
        )}
        <Ops />
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
      {tab === 'raw' ? (
        <pre className="req-mono">{JSON.stringify(story, null, 2)}</pre>
      ) : tab === 'ac' ? (
        <dl className="req-fields">
          <dt>acceptanceCriteria</dt>
          <dd>{story.acceptanceCriteria ?? '（未填写）'}</dd>
        </dl>
      ) : (
        <dl className="req-fields">
          <dt>title</dt>
          <dd>{story.title}</dd>
          <dt>roleText</dt>
          <dd>{story.roleText}</dd>
          <dt>capabilityText</dt>
          <dd>{story.capabilityText}</dd>
          <dt>valueText</dt>
          <dd>{story.valueText}</dd>
          <dt>businessValue</dt>
          <dd>{story.businessValue}</dd>
          <dt>priority</dt>
          <dd>{story.priority}</dd>
          <dt>status</dt>
          <dd>{story.status}</dd>
          <dt>isSensitive</dt>
          <dd>{story.isSensitive ? 'true（只能经端点 23 修改）' : 'false'}</dd>
          <dt>createdAt</dt>
          <dd>{story.createdAt}</dd>
          <dt>storyId</dt>
          <dd className="req-mono">{story.id}</dd>
        </dl>
      )}
      <p className="req-hint">
        可深链的详情页：
        <Link className="link" to={`/projects/${projectId}/requirements/${story.id}`}>
          在新页面打开
        </Link>
      </p>
      <Ops />
    </div>
  )
}

function Tabs({ tab, onTab }: { tab: DetailTab; onTab: (tab: DetailTab) => void }) {
  const defs: ReadonlyArray<readonly [DetailTab, string]> = [
    ['detail', '详情'],
    ['ac', '验收标准'],
    ['raw', '契约字段'],
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

/** 操作区占位：写路径（端点 11–22）属后续功能块，故按钮全部禁用并说明原因。 */
function Ops() {
  return (
    <div className="req-op-block">
      <p className="req-side-title">操作</p>
      <div className="req-op-row">
        <Button variant="ghost" disabled title="后续功能块：端点 14 / 18 全量替换顺序">
          ↑ 上移
        </Button>
        <Button variant="ghost" disabled title="后续功能块：端点 14 / 18 全量替换顺序">
          ↓ 下移
        </Button>
        <Button variant="ghost" disabled title="后续功能块">
          编辑
        </Button>
        <Button variant="ghost" disabled title="后续功能块">
          删除
        </Button>
      </div>
      <p className="req-hint">
        写操作尚未接入（端点 12/13/14/16/17/18/21/22 后端已交付，前端属后续功能块）。
        可用性最终由后端 <code>can()</code> 判定，前端不复制权限逻辑（契约 I-9）。
      </p>
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
