import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api'
import SchedulingPage from './SchedulingPage'
import { createSchedulingClient, dispositionInput, makeAttempt, type SchedulingDetailDto } from './api'

const detail: SchedulingDetailDto = {
  id: 's1', projectId: 'p1', status: 'PENDING', disposition: 'PENDING', application: 'PENDING_DISPOSITION',
  model: { provider: 'test', model: 'test', version: '未提供', mode: 'STUB', execution: 'LOCAL' },
  generation: { requestId: 'r1', status: 'SUCCEEDED', generatedAt: '2026-10-23T02:00:00Z', error: null },
  sourceState: 'current', changes: [{ taskId: 't1', planStart: '2026-10-24', planEnd: '2026-10-25' }],
  tasks: [{ id: 't1', title: 'Synthetic task', planStart: '2026-10-23', planEnd: '2026-10-25' }],
  reason: null, finalChanges: null,
}
function clientWith(value: unknown) {
  const spy = vi.fn(async (_path: string, _init?: RequestInit) => value)
  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => await spy(path, init) as T
  return { client: createSchedulingClient('p1', request), spy }
}
describe('C browser DTO/client and server rendering (not browser final acceptance)', () => {
  it('loads a strictly projected detail without backend type imports', async () => {
    const h = clientWith(detail)
    expect(await h.client.get('s1')).toEqual(detail)
    expect(h.spy.mock.calls[0]?.[0]).toBe('/projects/p1/scheduling-suggestions/s1')
  })
  it('rejects unexpected protected fields instead of rendering a repository record', async () => {
    const h = clientWith({ ...detail, serverPrivate: { digest: 'do-not-render' } })
    await expect(h.client.get('s1')).rejects.toThrow()
  })
  it('rejects wrong project or suggestion identity', async () => {
    await expect(clientWith({ ...detail, projectId: 'other' }).client.get('s1')).rejects.toThrow('归属')
    await expect(clientWith({ ...detail, id: 'other' }).client.get('s1')).rejects.toThrow('归属')
  })
  it('keeps accurate list totals and truncation, not items.length as total', async () => {
    const { sourceState: _state, changes: _changes, tasks: _tasks, reason: _reason, finalChanges: _final, ...summary } = detail
    const h = clientWith({ items: [summary], total: 9, limit: 1, truncated: true })
    expect(await h.client.list()).toMatchObject({ total: 9, truncated: true })
    await expect(clientWith({ items: [summary], total: 9, limit: 1, truncated: false }).client.list()).rejects.toThrow()
  })
  it('reuses the same disposition request and exact body after an unresolved attempt', async () => {
    const h = clientWith({ id: 's1', status: 'DISPOSED', disposition: 'REJECTED', application: 'NOT_APPLICABLE' })
    const newId = vi.fn(() => 'stable-request')
    const attempt = makeAttempt('s1', { status: 'REJECTED', note: ' Synthetic reason ' }, newId)
    await h.client.dispose(attempt)
    await h.client.dispose(attempt)
    expect(newId).toHaveBeenCalledOnce()
    expect(h.spy.mock.calls[0]?.[1]?.body).toBe(h.spy.mock.calls[1]?.[1]?.body)
    expect(JSON.parse(h.spy.mock.calls[0]?.[1]?.body as string)).toEqual({ status: 'REJECTED', note: 'Synthetic reason', requestId: 'stable-request' })
  })
  it.each([
    { status: 'REJECTED', note: ' ' },
    { status: 'ACCEPTED', changes: detail.changes },
    { status: 'MODIFIED', note: 'n', changes: [...detail.changes, ...detail.changes] },
    { status: 'MODIFIED', note: 'n', changes: [{ taskId: 't1', planStart: '2026-02-30', planEnd: '2026-03-01' }] },
    { status: 'MODIFIED', note: 'n', changes: [{ taskId: 't1', planStart: '2026-10-25', planEnd: '2026-10-24' }] },
  ])('rejects invalid browser disposition %#', (input) => {
    expect(dispositionInput.safeParse(input).success).toBe(false)
  })
  it('propagates 403/409/network failures without returning a synthetic success', async () => {
    for (const error of [new ApiError(403, 'FORBIDDEN', 'denied'), new ApiError(409, 'CONFLICT', 'stale'), new Error('network')]) {
      const request = async <T,>(): Promise<T> => { throw error }
      await expect(createSchedulingClient('p1', request).get('s1')).rejects.toBe(error)
    }
  })
  it('never renders protected content in forbidden/unauthenticated/not-found/pending state', () => {
    for (const access of ['forbidden', 'unauthenticated', 'not-found', 'pending'] as const) {
      const html = renderToStaticMarkup(createElement(SchedulingPage, { projectId: 'p1', sessionKey: 'u1', access, demo: true, initialDetail: detail }))
      expect(html).not.toContain('Synthetic task')
      expect(html).not.toContain('r1')
    }
  })
  it('renders fixture mode with disabled formal controls and no backend revision', () => {
    const html = renderToStaticMarkup(createElement(SchedulingPage, { projectId: 'p1', sessionKey: 'u1', access: 'allowed', demo: true, initialDetail: { ...detail, sourceState: 'stale' } }))
    expect(html).toContain('Synthetic task')
    expect(html).toContain('仍可填写理由拒绝')
    expect(html).toContain('不允许正式处置')
    expect(html).toMatch(/disabled="">采纳/)
    expect(html).toMatch(/disabled="">拒绝/)
    expect(html).not.toContain('sourceRevision')
  })
})
