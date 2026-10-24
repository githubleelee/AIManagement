import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import { AppError } from '../../shared/errors.js'
import { createAuthorization } from '../authz/permissions.js'
import { UML_LIMITS, type UmlContentInput, type UmlCreateInput, type UmlKind, type UmlPatchInput } from './schemas.js'

const notFound = () => new AppError(404, 'NOT_FOUND', '图不存在')
const invalid = (field: string, message: string) => new AppError(422, 'VALIDATION_FAILED', message, [{ field, code: 'INVALID_VALUE' }])
type Db = Prisma.TransactionClient

async function authorizeWrite(db: Db, actor: string, projectId: string, byId = false): Promise<void> {
  const decision = await createAuthorization(db).can(actor, 'uml.write', { kind: 'project', projectId })
  if (!decision.allow) throw new AppError(decision.status, decision.code,
    decision.status === 404 ? (byId ? '图不存在' : '项目不存在') : '该操作需要项目经理权限')
}
async function diagramProject(db: Db, id: string): Promise<string> {
  const diagram = await db.umlDiagram.findUnique({ where: { id }, select: { projectId: true } })
  if (!diagram) throw notFound()
  return diagram.projectId
}

/** Current visibility intersection plus the approved persistent no-declassification guard.
 * Only central PM scopes bypass the guard. Even whitelisted non-PMs cannot read a
 * diagram once everRestricted is true; unlink/Cascade never resets that history.
 */
async function readWhere(db: Db, actor: string, projectId: string): Promise<Prisma.UmlDiagramWhereInput> {
  const auth = createAuthorization(db)
  const decision = await auth.can(actor, 'project.read', { kind: 'project', projectId })
  if (!decision.allow) throw new AppError(decision.status, decision.code, '项目不存在')
  const [tasks, stories] = await Promise.all([
    auth.visibilityScope(actor, projectId, 'task'),
    auth.visibilityScope(actor, projectId, 'story'),
  ])
  if (tasks.mode === 'all' && stories.mode === 'all') return { projectId }
  return { projectId, AND: [
    { tasks: { every: { task: { id: { in: tasks.mode === 'all' ? undefined : tasks.ids } } } } },
    { stories: { every: { story: { id: { in: stories.mode === 'all' ? undefined : stories.ids } } } } },
    { everRestricted: false },
  ] }
}

const summarySelect = {
  id: true, projectId: true, kind: true, title: true, description: true,
  ownerUserId: true, createdAt: true, updatedAt: true,
  owner: { select: { displayName: true } },
  _count: { select: { goals: true, activities: true, stories: true, tasks: true } },
} satisfies Prisma.UmlDiagramSelect
const viewSelect = {
  ...summarySelect,
  nodes: { select: { id: true, nodeType: true, name: true, orderIndex: true }, orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] },
  edges: { select: { id: true, edgeType: true, sourceNodeId: true, targetNodeId: true, label: true, seq: true }, orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] },
  goals: { select: { goal: { select: { id: true, name: true } } }, orderBy: { goalId: 'asc' } },
  activities: { select: { activity: { select: { id: true, name: true, goalId: true } } }, orderBy: { activityId: 'asc' } },
  stories: { select: { story: { select: { id: true, title: true, activityId: true } } }, orderBy: { storyId: 'asc' } },
  tasks: { select: { task: { select: { id: true, title: true, storyId: true } } }, orderBy: { taskId: 'asc' } },
} satisfies Prisma.UmlDiagramSelect
function summary(row: Prisma.UmlDiagramGetPayload<{ select: typeof summarySelect }>) {
  return { id: row.id, projectId: row.projectId, kind: row.kind as UmlKind,
    title: row.title, description: row.description, ownerUserId: row.ownerUserId,
    ownerDisplayName: row.owner.displayName, goalCount: row._count.goals,
    activityCount: row._count.activities, storyCount: row._count.stories, taskCount: row._count.tasks,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
}
async function view(db: Db, where: Prisma.UmlDiagramWhereInput) {
  const row = await db.umlDiagram.findFirst({ where, select: viewSelect })
  if (!row) throw notFound()
  return { ...summary(row), nodes: row.nodes, edges: row.edges,
    goalRefs: row.goals.map(x => x.goal), activityRefs: row.activities.map(x => x.activity),
    storyRefs: row.stories.map(x => x.story), taskRefs: row.tasks.map(x => x.task) }
}

/** All checks and writes are in one transaction; no retry can silently overwrite a winner. */
async function transaction<T>(prisma: PrismaClient, work: (db: Db) => Promise<T>): Promise<T> {
  try { return await prisma.$transaction(work) }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') throw notFound()
      if (['P2002', 'P2034', 'P1008', 'P2028'].includes(error.code)) {
        throw new AppError(409, 'CONFLICT', '并发冲突，请重试')
      }
      // Project/owner/ref foreign keys are not edge fields; unknown context stays field-free.
      if (error.code === 'P2003') throw new AppError(422, 'VALIDATION_FAILED', '关联对象或项目成员已变更，请刷新后重试')
    }
    throw error
  }
}

/** Only a known write context may attach a field to a database constraint error. */
async function constraintWrite<T>(field: string, work: () => Promise<T>, edgeEndpoints = false): Promise<T> {
  try { return await work() }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') throw new AppError(409, 'CONFLICT', '关联或关系已存在', [{ field, code: 'DUPLICATE' }])
      if (error.code === 'P2003' && edgeEndpoints) throw invalid('edges.sourceNodeId', '边端点不属于本图或关联对象已变更')
    }
    throw error
  }
}

function validateContent(kind: string, content: UmlContentInput): void {
  const nodes = new Map<string, UmlContentInput['nodes'][number]>()
  content.nodes.forEach((node, i) => {
    if (kind === 'USECASE' ? node.nodeType === 'LIFELINE' : node.nodeType !== 'LIFELINE') {
      throw invalid(`nodes.${i}.nodeType`, '节点类型与图类型不匹配')
    }
    if (node.id !== undefined) {
      if (nodes.has(node.id)) throw invalid(`nodes.${i}.id`, '节点临时编号不能重复')
      nodes.set(node.id, node)
    }
  })
  const keys = new Set<string>()
  content.edges.forEach((edge, i) => {
    const from = nodes.get(edge.sourceNodeId), to = nodes.get(edge.targetNodeId)
    if (!from || !to) throw invalid(`edges.${i}.sourceNodeId`, '边端点不属于本图')
    if (kind === 'USECASE') {
      if (!['ASSOCIATION', 'INCLUDE', 'EXTEND'].includes(edge.edgeType)) throw invalid(`edges.${i}.edgeType`, '关系类型与图类型不匹配')
      if (edge.seq != null) throw invalid(`edges.${i}.seq`, '用例图不能指定消息序号')
      if (edge.sourceNodeId === edge.targetNodeId) throw invalid(`edges.${i}.targetNodeId`, '用例图不能自环')
      const valid = edge.edgeType === 'ASSOCIATION'
        ? from.nodeType !== to.nodeType
        : from.nodeType === 'USECASE' && to.nodeType === 'USECASE'
      if (!valid) throw invalid(`edges.${i}.edgeType`, '关系端点类型不匹配')
      const key = JSON.stringify([edge.edgeType, edge.sourceNodeId, edge.targetNodeId])
      if (keys.has(key)) throw new AppError(409, 'CONFLICT', '该关系已存在', [{ field: `edges.${i}.edgeType`, code: 'DUPLICATE' }])
      keys.add(key)
    } else if (!['SYNC', 'ASYNC', 'RETURN'].includes(edge.edgeType)) {
      throw invalid(`edges.${i}.edgeType`, '消息类型与图类型不匹配')
    }
  })
}

async function replaceContent(db: Db, diagramId: string, kind: string, content: UmlContentInput): Promise<void> {
  validateContent(kind, content)
  // A supplied node id is a request-local alias, NEVER an existing database id to update.
  const aliases = new Map<string, string>()
  const nodes = content.nodes.map((node, index) => {
    const id = randomUUID()
    if (node.id !== undefined) aliases.set(node.id, id)
    return { id, diagramId, nodeType: node.nodeType, name: node.name,
      orderIndex: kind === 'SEQUENCE' ? node.orderIndex ?? index : 0 }
  })
  await db.umlEdge.deleteMany({ where: { diagramId } })
  await db.umlNode.deleteMany({ where: { diagramId } })
  if (nodes.length) await db.umlNode.createMany({ data: nodes })
  if (content.edges.length) await constraintWrite('edges', () => db.umlEdge.createMany({ data: content.edges.map((edge, index) => ({
    id: randomUUID(), diagramId, edgeType: edge.edgeType,
    sourceNodeId: aliases.get(edge.sourceNodeId)!, targetNodeId: aliases.get(edge.targetNodeId)!,
    label: edge.label ?? null, seq: kind === 'SEQUENCE' ? index + 1 : null,
  })) }), true)
  // Explicit update even when content becomes empty: metadata PATCH and content share updatedAt.
  await db.umlDiagram.update({ where: { id: diagramId }, data: { updatedAt: new Date() } })
}

async function validateOwner(db: Db, projectId: string, userId: string): Promise<void> {
  if (!await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } }, select: { userId: true } })) {
    throw new AppError(422, 'VALIDATION_FAILED', '负责人必须是本项目成员', [{ field: 'ownerUserId', code: 'NOT_PROJECT_MEMBER' }])
  }
}
async function replaceRefs(db: Db, diagramId: string, projectId: string, input: UmlPatchInput): Promise<void> {
  const specs = [
    { field: 'goalIds', model: 'businessGoal', links: 'umlDiagramGoal' },
    { field: 'activityIds', model: 'userActivity', links: 'umlDiagramActivity' },
    { field: 'storyIds', model: 'userStory', links: 'umlDiagramStory' },
    { field: 'taskIds', model: 'task', links: 'umlDiagramTask' },
  ] as const
  // Keep delegates explicit (no any/dynamic Prisma signatures) while sharing validation semantics.
  for (const spec of specs) {
    const values = input[spec.field]
    if (values === undefined) continue
    const ids = [...new Set(values)]
    const where = { projectId, id: { in: ids } }
    // Read sensitivity from the real same-project targets, never from request data.
    const restrictedTargets = spec.model === 'userStory'
      ? await db.userStory.findMany({ where, select: { isSensitive: true } })
      : spec.model === 'task' ? await db.task.findMany({ where, select: { isSensitive: true } }) : null
    const count = restrictedTargets !== null ? restrictedTargets.length
      : spec.model === 'businessGoal' ? await db.businessGoal.count({ where }) : await db.userActivity.count({ where })
    if (count !== ids.length) throw new AppError(422, 'VALIDATION_FAILED', '关联对象不属于本项目', [{ field: spec.field, code: 'CROSS_PROJECT_REF' }])
    if (restrictedTargets?.some(target => target.isSensitive)) {
      // Same transaction as the join replacement. Never write false, including [].
      await db.umlDiagram.update({ where: { id: diagramId }, data: { everRestricted: true } })
    }
    if (spec.links === 'umlDiagramGoal') {
      await db.umlDiagramGoal.deleteMany({ where: { diagramId } })
      if (ids.length) await constraintWrite(spec.field, () => db.umlDiagramGoal.createMany({ data: ids.map(goalId => ({ diagramId, goalId })) }))
    } else if (spec.links === 'umlDiagramActivity') {
      await db.umlDiagramActivity.deleteMany({ where: { diagramId } })
      if (ids.length) await constraintWrite(spec.field, () => db.umlDiagramActivity.createMany({ data: ids.map(activityId => ({ diagramId, activityId })) }))
    } else if (spec.links === 'umlDiagramStory') {
      await db.umlDiagramStory.deleteMany({ where: { diagramId } })
      if (ids.length) await constraintWrite(spec.field, () => db.umlDiagramStory.createMany({ data: ids.map(storyId => ({ diagramId, storyId })) }))
    } else {
      await db.umlDiagramTask.deleteMany({ where: { diagramId } })
      if (ids.length) await constraintWrite(spec.field, () => db.umlDiagramTask.createMany({ data: ids.map(taskId => ({ diagramId, taskId })) }))
    }
  }
}

export async function listUmlDiagrams(prisma: PrismaClient, actor: string, projectId: string, kind?: UmlKind) {
  return transaction(prisma, async db => {
    const where = { ...await readWhere(db, actor, projectId), ...(kind ? { kind } : {}) }
    const total = await db.umlDiagram.count({ where })
    const rows = await db.umlDiagram.findMany({ where, select: summarySelect,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: UML_LIMITS.list })
    return { items: rows.map(summary), total, truncated: total > UML_LIMITS.list }
  })
}
export async function getUmlDiagram(prisma: PrismaClient, actor: string, diagramId: string) {
  return transaction(prisma, async db => {
    const projectId = await diagramProject(db, diagramId)
    try { return await view(db, { ...await readWhere(db, actor, projectId), id: diagramId }) }
    catch (error) {
      // Never distinguish another project's existing id from a nonexistent id.
      if (error instanceof AppError && error.status === 404) throw notFound()
      throw error
    }
  })
}
export async function createUmlDiagram(prisma: PrismaClient, actor: string, projectId: string, input: UmlCreateInput) {
  return transaction(prisma, async db => {
    await authorizeWrite(db, actor, projectId)
    const ownerUserId = input.ownerUserId ?? actor
    await validateOwner(db, projectId, ownerUserId)
    const diagram = await db.umlDiagram.create({ data: {
      projectId, kind: input.kind, title: input.title, description: input.description, ownerUserId,
    }, select: { id: true } })
    await replaceRefs(db, diagram.id, projectId, input)
    await replaceContent(db, diagram.id, input.kind, input)
    // 【事件占位】uml.diagram.created — D #37 not connected, no fake event.
    return view(db, { id: diagram.id, projectId })
  })
}
export async function patchUmlDiagram(prisma: PrismaClient, actor: string, diagramId: string, input: UmlPatchInput) {
  return transaction(prisma, async db => {
    const projectId = await diagramProject(db, diagramId)
    await authorizeWrite(db, actor, projectId, true)
    if (input.ownerUserId !== undefined) await validateOwner(db, projectId, input.ownerUserId)
    await replaceRefs(db, diagramId, projectId, input)
    await db.umlDiagram.update({ where: { id: diagramId }, data: {
      title: input.title, description: input.description, ownerUserId: input.ownerUserId, updatedAt: new Date(),
    } })
    // 【事件占位】uml.diagram.updated
    return view(db, { id: diagramId, projectId })
  })
}
export async function putUmlContent(prisma: PrismaClient, actor: string, diagramId: string, input: UmlContentInput) {
  return transaction(prisma, async db => {
    const projectId = await diagramProject(db, diagramId)
    await authorizeWrite(db, actor, projectId, true)
    const diagram = await db.umlDiagram.findUnique({ where: { id: diagramId }, select: { kind: true } })
    if (!diagram) throw notFound()
    await replaceContent(db, diagramId, diagram.kind, input)
    // 【事件占位】uml.diagram.content.replaced
    return view(db, { id: diagramId, projectId })
  })
}
export async function deleteUmlDiagram(prisma: PrismaClient, actor: string, diagramId: string): Promise<void> {
  return transaction(prisma, async db => {
    const projectId = await diagramProject(db, diagramId)
    await authorizeWrite(db, actor, projectId, true)
    await db.umlDiagram.delete({ where: { id: diagramId } })
    // 【事件占位】uml.diagram.deleted
  })
}
