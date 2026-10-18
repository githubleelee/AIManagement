import type { DateChange, SchedulingAssessment, SchedulingSnapshot } from './schemas.js'

/** Pure #32 policy. No DB, authorization, AI call, or formal-plan write is performed here. */
export function shanghaiToday(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** Only an already query-authorized snapshot may reach this boundary. This is not visibilityScope. */
export function buildSchedulingInput(snapshot: SchedulingSnapshot) {
  const tasks = snapshot.tasks.filter((task) => !task.isSensitive && task.projectId === snapshot.projectId)
  const taskIds = new Set(tasks.map((task) => task.id))
  return {
    scenario: 'scheduling' as const,
    projectId: snapshot.projectId,
    revision: snapshot.revision,
    capturedAt: snapshot.capturedAt,
    scope: '已授权且非敏感任务子集（不是 PM 全项目基数）',
    tasks: tasks.map(({ id, title, ownerUserId, status, planStart, planEnd }) => ({
      id, title, ownerUserId, status, planStart, planEnd,
    })),
    dependencies: snapshot.dependencies.filter((edge) => taskIds.has(edge.predecessorId) && taskIds.has(edge.successorId)),
    milestones: snapshot.milestones.flatMap((milestone) => {
      // Mixed-sensitivity associations are excluded, not partially described to the AI.
      if (milestone.taskIds.length === 0 || !milestone.taskIds.every((id) => taskIds.has(id))) return []
      return [{ id: milestone.id, taskIds: [...milestone.taskIds], date: milestone.date }]
    }),
    workload: snapshot.memberIds.map((userId) => ({
      userId, openTaskCount: tasks.filter((task) => task.ownerUserId === userId && task.status !== 'CLOSED').length,
    })),
  }
}

/** Deterministic baseline comparison for a future transactional adapter, NOT a concurrency lock. */
export function sameSchedulingBaseline(a: SchedulingSnapshot, b: SchedulingSnapshot): boolean {
  const canonical = (snapshot: SchedulingSnapshot) => JSON.stringify({
    projectId: snapshot.projectId, revision: snapshot.revision,
    members: [...snapshot.memberIds].sort(),
    tasks: snapshot.tasks.map((task) => [task.id, task.projectId, task.ownerUserId, task.acceptorUserId,
      task.status, task.planStart, task.planEnd, task.isSensitive]).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))),
    dependencies: snapshot.dependencies.map((edge) => [edge.predecessorId, edge.successorId]).sort(),
    milestones: snapshot.milestones.map((milestone) => [milestone.id, milestone.date, [...milestone.taskIds].sort()]).sort(),
  })
  return canonical(a) === canonical(b)
}

/** Assesses proposed dates only. A true result never authorizes or commits a write. */
export function assessSchedulingDates(snapshot: SchedulingSnapshot, changes: DateChange[], now: Date): SchedulingAssessment {
  const input = buildSchedulingInput(snapshot)
  const blockers: SchedulingAssessment['blockers'] = []
  const warnings: SchedulingAssessment['warnings'] = []
  const block = (code: string, taskIds: string[], message: string) => blockers.push({ code, taskIds, message })
  const warn = (code: string, taskIds: string[], message: string) => warnings.push({ code, taskIds, message })
  const eligible = snapshot.tasks.filter((task) => !task.isSensitive && task.projectId === snapshot.projectId)
  const tasks = new Map(eligible.map((task) => [task.id, { ...task }]))
  const changed = new Set<string>()
  const today = shanghaiToday(now)

  if (new Set(snapshot.tasks.map((task) => task.id)).size !== snapshot.tasks.length) {
    block('INVALID_SNAPSHOT', [], '输入快照含重复任务，需由数据适配器修复')
  }
  if (changes.length === 0) block('EMPTY_CHANGES', [], '至少选择一项日期调整')
  for (const change of changes) {
    const task = tasks.get(change.taskId)
    // Never echo an inaccessible ID or its attributes in an error.
    if (!task) { block('UNAVAILABLE_TASK', [], '调整包含不可用任务'); continue }
    if (changed.has(task.id)) { block('DUPLICATE_TASK', [task.id], '同一任务只能调整一次'); continue }
    changed.add(task.id)
    if (task.status !== 'TODO') block('NOT_TODO', [task.id], '非 TODO 任务只能提示，不能改期')
    if (snapshot.memberIds.length < 2 || !snapshot.memberIds.includes(task.ownerUserId)
      || !snapshot.memberIds.includes(task.acceptorUserId) || task.ownerUserId === task.acceptorUserId) {
      block('ASSIGNMENT_INVALID', [task.id], '成员或验收独立性已变化，不能应用')
    }
    if (change.planEnd < change.planStart) block('END_BEFORE_START', [task.id], '计划结束不能早于开始')
    if (change.planStart < today) block('START_BEFORE_TODAY', [task.id], '新开始不能早于北京时间今天')
    if (change.planEnd > task.planEnd) warn('LATER_THAN_BASELINE', [task.id], '新结束晚于原计划')
    tasks.set(task.id, { ...task, planStart: change.planStart, planEnd: change.planEnd })
  }

  for (const edge of snapshot.dependencies) {
    if (!changed.has(edge.predecessorId) && !changed.has(edge.successorId)) continue
    const predecessor = tasks.get(edge.predecessorId)
    const successor = tasks.get(edge.successorId)
    if (!predecessor || !successor) {
      block('INCOMPLETE_DEPENDENCY', [], '关联依赖不在本次可用范围，需完整受控校验')
      continue
    }
    // ISO date lexical ordering means strictly later = at least next natural day.
    if (successor.planStart <= predecessor.planEnd) {
      block('FS_PLAN_VIOLATION', [predecessor.id, successor.id], 'FS 后继开始不得早于前置结束次日')
    }
  }
  const projected = [...tasks.values()]
  for (let i = 0; i < projected.length; i++) {
    const a = projected[i]!
    for (let j = i + 1; j < projected.length; j++) {
      const b = projected[j]!
      if ((!changed.has(a.id) && !changed.has(b.id)) || a.status === 'CLOSED' || b.status === 'CLOSED') continue
      if (a.ownerUserId === b.ownerUserId && a.planStart <= b.planEnd && b.planStart <= a.planEnd) {
        warn('OWNER_DATE_OVERLAP', [a.id, b.id], '同一负责人任务日期重叠（仅提示，起止日均计入）')
      }
    }
  }
  for (const milestone of input.milestones) {
    for (const id of milestone.taskIds) {
      const task = tasks.get(id)
      if (task && changed.has(id) && task.planEnd > milestone.date) {
        warn('AFTER_MILESTONE', [id], `计划结束超过已关联里程碑日期 ${milestone.date}`)
      }
    }
  }
  return {
    canApplyDates: blockers.length === 0, blockers, warnings, workload: input.workload,
    scope: { label: input.scope, participatingTaskIds: input.tasks.map((task) => task.id), taskCount: input.tasks.length },
  }
}
