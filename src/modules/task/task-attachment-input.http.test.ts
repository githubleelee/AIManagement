import { it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHttpTestContext, setActiveDatabase } from '../../../test/helpers.js'
import { makeUser, makeProject, makeMember, makeGoal, makeActivity, makeStory, makeTask } from '../../../test/factories.js'

it('production attachment input preserves 413/415/422 and returns all 250 actually uploaded files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'c-attachment-input-'))
  const ctx = await createHttpTestContext({ uploadRoot: root })
  try {
    setActiveDatabase(ctx.db)
    const pm = await makeUser('attachment-input-pm@example.invalid')
    const acceptor = await makeUser('attachment-input-acceptor@example.invalid')
    const { projectId } = await makeProject(pm.id)
    await makeMember(projectId, acceptor.id, 'MEMBER')
    const storyId = await makeStory(await makeActivity(await makeGoal(projectId)))
    const taskId = await makeTask(storyId, pm.id, acceptor.id)
    // The synchronous SQLite session fixture must precede production worker startup.
    const token = ctx.loginAs(pm.id)
    await ctx.app.ready()
    const client = ctx.asUser(token)
    const pdf = Buffer.from('%PDF-1.4\nC actual 250-file input fixture\n')
    const upload = (name: string, body: Buffer, contentType = 'application/pdf') => client
      .post(`/tasks/${taskId}/attachments`).set('Content-Type', contentType)
      .set('X-File-Name', encodeURIComponent(name)).send(body)
    expect((await upload('unsupported.pdf', pdf, 'application/x-c-unsupported')).status).toBe(415)
    expect((await upload('disallowed.svg', pdf)).status).toBe(422)
    const oversizedBusiness = Buffer.alloc(10_000_001); pdf.copy(oversizedBusiness)
    // D contract: the parser admits exactly one extra byte so the strict business limit is 422.
    expect((await upload('oversized.pdf', oversizedBusiness)).status).toBe(422)
    const oversizedFramework = Buffer.alloc(10_000_002); pdf.copy(oversizedFramework)
    // Beyond the route bodyLimit the framework must preserve 413 (frozen I-4).
    // A real TCP client is aborted mid-body with ECONNRESET (recorded in
    // docs/role-c/issue-36/evidence/latest-input-http-2.txt), so the framework envelope
    // is asserted through the same production app instance and parser via inject,
    // matching D's own plugin tests.
    const framework413 = await ctx.app.inject({
      method: 'POST', url: `/tasks/${taskId}/attachments`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/pdf', 'x-file-name': encodeURIComponent('oversized-transport.pdf') },
      payload: oversizedFramework,
    })
    expect(framework413.statusCode).toBe(413)
    expect(await ctx.db.attachment.count()).toBe(0)
    const ids = new Set<string>()
    for (let index = 0; index < 250; index++) {
      const result = await upload(`真实附件-${index}.pdf`, pdf)
      expect(result.status, JSON.stringify(result.body)).toBe(201)
      ids.add(result.body.id)
    }
    expect(ids.size).toBe(250)
    const list = await client.get(`/tasks/${taskId}/attachments`)
    expect(list.status).toBe(200)
    // D contract: { total, items } where items is the complete array (no truncation).
    expect(list.body.total).toBe(250)
    expect(Array.isArray(list.body.items)).toBe(true)
    expect(list.body.items).toHaveLength(250)
    expect(new Set(list.body.items.map((item: { id: string }) => item.id))).toEqual(ids)
    const records = await ctx.db.attachment.findMany({ select: { storagePath: true } })
    expect(records).toHaveLength(250)
    expect(records.every(record => existsSync(join(root, record.storagePath)))).toBe(true)
  } finally {
    await ctx.dispose()
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)
