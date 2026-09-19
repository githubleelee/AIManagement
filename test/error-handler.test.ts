import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { buildApp } from '../src/app'
import { AppError } from '../src/shared/errors'

// T0-01 验收：统一错误处理器输出符合契约（决策 I-3、I-4）。

describe('统一错误处理器（T0-01）', () => {
  it('健康检查返回 200', async () => {
    const app = buildApp()
    await app.ready()
    const res = await request(app.server).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
    await app.close()
  })

  it('AppError → 契约的 ErrorResponse 结构', async () => {
    const app = buildApp()
    app.get('/__forbidden', async () => {
      throw new AppError(403, 'FORBIDDEN', '该操作需要项目经理权限')
    })
    await app.ready()
    const res = await request(app.server).get('/__forbidden')
    expect(res.status).toBe(403)
    expect(res.body).toEqual({
      error: { code: 'FORBIDDEN', message: '该操作需要项目经理权限' },
    })
    await app.close()
  })

  it('未预期异常 → 500，响应体不含堆栈或原始错误信息', async () => {
    const app = buildApp()
    app.get('/__boom', async () => {
      throw new Error('内部数据库连接串泄漏风险')
    })
    await app.ready()
    const res = await request(app.server).get('/__boom')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: { code: 'INTERNAL', message: '服务器内部错误' } })
    expect(JSON.stringify(res.body)).not.toContain('内部数据库连接串泄漏风险')
    expect(JSON.stringify(res.body)).not.toMatch(/stack|at /i)
    await app.close()
  })
})
