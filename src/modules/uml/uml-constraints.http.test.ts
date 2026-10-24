import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest'
import { createHttpTestContext, setActiveDatabase, type HttpTestContext } from '../../../test/helpers.js'
import { makeUser, makeProject, makeGoal } from '../../../test/factories.js'
let ctx: HttpTestContext, pm: string, projectId: string, goalId: string
beforeAll(async () => { ctx = await createHttpTestContext(); setActiveDatabase(ctx.db); await ctx.app.ready() })
afterAll(async () => { await ctx.dispose() })
beforeEach(async () => {
  await ctx.reset(); pm = (await makeUser('uml-constraints@example.invalid')).id
  projectId = (await makeProject(pm)).projectId; goalId = await makeGoal(projectId)
})
const graph = () => ({ nodes: [{ id: 'a', nodeType: 'ACTOR', name: '角色' }, { id: 'u', nodeType: 'USECASE', name: '用例' }],
  edges: [{ edgeType: 'ASSOCIATION', sourceNodeId: 'a', targetNodeId: 'u' }] })
async function requestWithTrigger(sql: string, input: object) {
  await ctx.db.$executeRawUnsafe(sql)
  try {
    const response = await ctx.asUser(ctx.loginAs(pm)).post(`/projects/${projectId}/uml-diagrams`).send({ title: '合成约束回归', kind: 'USECASE', ...input })
    expect(await ctx.db.umlDiagram.count({ where: { projectId } })).toBe(0)
    return response
  } finally { await ctx.db.$executeRawUnsafe('DROP TRIGGER c_uml_constraint') }
}
describe('real SQLite constraint errors retain only meaningful input field locations', () => {
  it('non-edge FK failure has generic 422 without fabricated edges details', async () => {
    const response = await requestWithTrigger('CREATE TRIGGER c_uml_constraint AFTER INSERT ON "UmlDiagramGoal" BEGIN UPDATE "UmlDiagramGoal" SET "goalId"=\'missing\' WHERE "diagramId"=NEW."diagramId"; END', { goalIds: [goalId] })
    expect(response.status, JSON.stringify(response.body)).toBe(422)
    expect(response.body.error.code).toBe('VALIDATION_FAILED')
    expect(response.body.error).not.toHaveProperty('details')
  })
  it('project/owner FK failure without an edges body is also field-free', async () => {
    const response = await requestWithTrigger('CREATE TRIGGER c_uml_constraint AFTER INSERT ON "UmlDiagram" BEGIN UPDATE "UmlDiagram" SET "ownerUserId"=\'missing\' WHERE "id"=NEW."id"; END', {})
    expect(response.status).toBe(422); expect(response.body.error).not.toHaveProperty('details')
  })
  it('actual edge FK failure retains edges.sourceNodeId', async () => {
    const response = await requestWithTrigger('CREATE TRIGGER c_uml_constraint AFTER INSERT ON "UmlEdge" BEGIN UPDATE "UmlEdge" SET "sourceNodeId"=\'missing\' WHERE "id"=NEW."id"; END', graph())
    expect(response.status).toBe(422)
    expect(response.body.error.details).toEqual([{ field: 'edges.sourceNodeId', code: 'INVALID_VALUE' }])
  })
  it('known edge uniqueness failure includes DUPLICATE without guessing an individual index', async () => {
    const response = await requestWithTrigger('CREATE TRIGGER c_uml_constraint AFTER INSERT ON "UmlEdge" BEGIN INSERT INTO "UmlEdge" SELECT * FROM "UmlEdge" WHERE "id"=NEW."id"; END', graph())
    expect(response.status).toBe(409)
    expect(response.body.error.details).toEqual([{ field: 'edges', code: 'DUPLICATE' }])
  })
  it('association uniqueness failure locates the real association field', async () => {
    const response = await requestWithTrigger('CREATE TRIGGER c_uml_constraint AFTER INSERT ON "UmlDiagramGoal" BEGIN INSERT INTO "UmlDiagramGoal" SELECT * FROM "UmlDiagramGoal" WHERE "diagramId"=NEW."diagramId" AND "goalId"=NEW."goalId"; END', { goalIds: [goalId] })
    expect(response.status).toBe(409)
    expect(response.body.error.details).toEqual([{ field: 'goalIds', code: 'DUPLICATE' }])
  })
})
