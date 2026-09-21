/**
 * US-03（M4）前端 —— **临时数据层**（属别的模块的接口尚未交付时使用）
 *
 * ===========================================================================
 * 为什么有这个文件
 * ===========================================================================
 * 人类批准的方案是「薄假数据层」：**界面按最终形态做完**，还没到位的接口先由
 * 本文件供给数据；等那些接口交付后，只换本文件的实现，**界面一行不用改**。
 * 这样四个人才能真正并行 —— 前端不必等 M3 / M5。
 *
 * 本文件现在只为尚未合入主线的 M5 提供一项临时能力：
 *   - 端点 24 `GET /stories/:storyId/tasks` 属 M5（US-05）—— 读，返回造出来的假数据
 *
 * M3 的端点 23 已由 US-02 交付，`saveSensitivity()` 已切换为真实 API。
 *
 * **端点 25（在某条需求下建任务）刻意不放在这里。** 在 M5 交付前，界面上的
 * 「新建任务」不应假装成功。与其加一个「导出了、没人调用、一调用就抛」的假函数
 * ——那正是本项目已裁定为「可被误用的危险 API」（表五序号 44）的一类东西——
 * 不如等 M5 把接口交出来再接。
 *
 * ===========================================================================
 * 怎么换掉（**调用方签名不变**，但有三处调用点要跟着改，别以为只动本文件就够）
 * ===========================================================================
 * 1. `listStoryTasks` 的函数体换成
 *      `return apiFetch<ListResponse<TaskView>>(`/stories/${encodeURIComponent(storyId)}/tasks`).then(p => p.items)`
 * 2. M5 合入后，删掉本文件里 `MOCK_*` 常量与 `console.info` 那一行。
 *
 * ⚠️ 换 M5 接口时**调用方**也要处理：
 *   `RequirementDetailPage` 里 `listStoryTasks` 的 `.catch(() => setTasks([]))` 会把
 *      「取不到」渲染成「这条需求下还没有任务。」—— 真接口失败时这是错的说法；
 *
 * ⚠️ 数据是**造出来的**，不是真的。为避免"演示时看起来像 M5 已经做完"，
 * 本文件在被首次调用时会在浏览器控制台打一行说明（界面上不显示任何
 * "某模块未完成"的字样 —— 那是人类明确否掉的做法）。
 * ===========================================================================
 */
import type { SensitivityInput, SensitivityView, TaskStatus, TaskView } from '../../../../src/shared/types'
import { apiFetch } from '../../api'

/* ===========================================================================
 * 一、任务（端点 24）
 * =========================================================================== */

let warned = false

/** 只在首次调用时提醒一次：这里的数据是造的。 */
function warnOnce(what: string): void {
  if (warned) return
  warned = true
  // eslint 未启用；这行是有意保留的诚实标记，不进界面。
  console.info(
    `[US-03] ${what} 当前来自临时数据层（src/pages/requirement/temporary-data.ts）。` +
      '相关端点属 M3 / M5，尚未交付；接口到位后按该文件头部说明替换实现即可，界面无需改动。',
  )
}

/** 由 id 稳定地推出一个 0..n-1 的数，使同一条需求每次看到同样的假任务。 */
function stableIndex(seed: string, modulo: number): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 100000
  return h % modulo
}

const TASK_TITLES = [
  '拆解这条需求的实现步骤',
  '补齐这条需求的接口测试',
  '与后端联调并核对响应字段',
  '补写验收标准里的边界用例',
  '更新页面文案与空态',
]

const OWNERS = ['member1', 'member2', 'member1']
const ACCEPTORS = ['member2', 'member1', 'pm']
const STATUSES: TaskStatus[] = ['TODO', 'DOING', 'DONE']

/**
 * 端点 24：某条需求下的任务列表。
 *
 * 契约排序：**按 `planStart` 升序，`planStart` 相同按 `createdAt` 升序**。
 * 即使现在是假数据，也照样按这个规则排 —— 免得接口换上来之后界面才暴露排序问题。
 */
export async function listStoryTasks(storyId: string): Promise<TaskView[]> {
  warnOnce('需求下的任务列表（端点 24）')

  const count = stableIndex(storyId, 4) // 0..3 个任务，包含"没有任务"的空态
  const base = new Date('2026-09-21T00:00:00.000Z').getTime()
  const tasks: TaskView[] = []

  for (let i = 0; i < count; i++) {
    const titleIdx = stableIndex(storyId + i, TASK_TITLES.length)
    const owner = OWNERS[(titleIdx + i) % OWNERS.length]
    // 契约要求「验收人 ≠ 负责人」，夹具也必须满足，否则界面会展示出违反约束的数据
    let acceptor = ACCEPTORS[(titleIdx + i) % ACCEPTORS.length]
    if (acceptor === owner) acceptor = owner === 'member1' ? 'member2' : 'member1'

    const start = new Date(base + i * 2 * 86400000)
    const end = new Date(start.getTime() + 2 * 86400000)

    tasks.push({
      id: `TASK-MOCK-${storyId.slice(-4)}-${i + 1}`,
      projectId: '',
      storyId,
      title: TASK_TITLES[titleIdx],
      description: null,
      ownerUserId: owner,
      acceptorUserId: acceptor,
      planStart: start.toISOString().slice(0, 10),
      planEnd: end.toISOString().slice(0, 10),
      status: STATUSES[(stableIndex(storyId + 'status' + i, 3))],
      isSensitive: false,
      createdAt: new Date(start.getTime() - 86400000).toISOString(),
      owner: { id: owner, account: owner, displayName: owner },
      acceptor: { id: acceptor, account: acceptor, displayName: acceptor },
    })
  }

  return tasks.sort((a, b) => {
    if (a.planStart !== b.planStart) return a.planStart < b.planStart ? -1 : 1
    return a.createdAt < b.createdAt ? -1 : 1
  })
}

/* 端点 23 已由 US-02 交付；任务列表仍暂用上面的 M5 薄假数据层。 */
export async function saveSensitivity(
  storyId: string,
  input: SensitivityInput,
): Promise<SensitivityView> {
  return apiFetch<SensitivityView>(`/stories/${encodeURIComponent(storyId)}/sensitivity`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}
