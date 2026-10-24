/** Diagnostic only: report actual HTTP outcomes of the unresolved late-sensitivity boundary.
 * No acceptance assertion that disclosure is correct. Isolated synthetic migrated DB only.
 */
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { createHttpTestContext, setActiveDatabase } from '../../../test/helpers.js'
import { makeActivity, makeGoal, makeMember, makeProject, makeStory, makeTask, makeUser } from '../../../test/factories.js'
import { registerUmlRoutes } from '../../../src/modules/uml/plugin.js'
const expectProtected = process.argv.includes('--expect-protected')
const ctx = await createHttpTestContext()
setActiveDatabase(ctx.db)
try {
  const pm = (await makeUser('late-guard-pm@example.invalid')).id
  const viewer = (await makeUser('late-guard-viewer@example.invalid')).id
  const allowed = (await makeUser('late-guard-member@example.invalid')).id
  const { projectId } = await makeProject(pm)
  await makeMember(projectId, viewer, 'VIEWER')
  await makeMember(projectId, allowed, 'MEMBER')
  const goal = await makeGoal(projectId), activity = await makeActivity(goal)
  if (!ctx.app.hasRoute({ method: 'POST', url: '/projects/:projectId/uml-diagrams' })) registerUmlRoutes(ctx.app, { prisma: ctx.db })
  await ctx.app.ready()
  const manager = ctx.asUser(ctx.loginAs(pm)), reader = ctx.asUser(ctx.loginAs(viewer)), whitelisted = ctx.asUser(ctx.loginAs(allowed))
  const observations = []
  for (const kind of ['task', 'story'] as const) {
    const story = await makeStory(activity)
    const id = kind === 'task' ? await makeTask(story, allowed, pm) : story
    const field = kind === 'task' ? 'taskIds' : 'storyIds'
    const base = `/${kind === 'task' ? 'tasks' : 'stories'}/${id}`
    const diagrams: string[] = []
    for (let i = 0; i < 3; i++) {
      const res = await manager.post(`/projects/${projectId}/uml-diagrams`).send({ title: '合成边界诊断', kind: 'USECASE', [field]: [id] })
      assert.equal(res.status, 201)
      diagrams.push(res.body.id)
    }
    const read = async (diagram: string, client = reader) => (await client.get(`/uml-diagrams/${diagram}`)).status
    const initial = await read(diagrams[0]!)
    assert.equal((await manager.put(`${base}/sensitivity`).send({ isSensitive: true, visibleMemberIds: [allowed] })).status, 200)
    const currentHidden = await read(diagrams[0]!)
    const whitelistAfterSensitivity = await read(diagrams[0]!, whitelisted)
    assert.equal((await manager.patch(`/uml-diagrams/${diagrams[0]}`).send({ [field]: [] })).status, 200)
    const afterUnlink = await read(diagrams[0]!)
    assert.equal((await manager.put(`${base}/sensitivity`).send({ isSensitive: false, visibleMemberIds: [] })).status, 200)
    const afterTargetOrdinary = await read(diagrams[1]!)
    assert.equal((await manager.put(`${base}/sensitivity`).send({ isSensitive: true, visibleMemberIds: [] })).status, 200)
    const beforeDelete = await read(diagrams[2]!)
    assert.equal((await manager.delete(base)).status, 204)
    const afterDelete = await read(diagrams[2]!)
    const result = { kind, initial, currentHidden, whitelistAfterSensitivity, afterUnlink, afterTargetOrdinary, beforeDelete, afterDelete }
    observations.push(result)
    console.log(JSON.stringify(result))
    if (expectProtected) assert.deepEqual(result, { kind, initial: 200, currentHidden: 404,
      whitelistAfterSensitivity: 404, afterUnlink: 404, afterTargetOrdinary: 404, beforeDelete: 404, afterDelete: 404 })
  }
  await writeFile(`docs/role-c/issue-35/evidence/guard-late-sensitivity-${expectProtected ? 'protected' : 'observed'}.json`, JSON.stringify({
    diagnosticOnly: !expectProtected, acceptancePassed: expectProtected,
    limitation: expectProtected ? 'Actual isolated HTTP late-sensitivity protection only; does not establish formal UI routing or full-ticket acceptance.'
      : 'Observational mode only; inspect statuses against the current write-side baseline, not an acceptance assertion.',
    observations,
  }, null, 2))
} finally { await ctx.dispose() }
