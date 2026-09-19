/**
 * 统一错误处理器接口测试（T0-01）
 *
 * 契约要求（决策 I-2b / I-3）：
 *   - 抛 AppError → 契约的 ErrorResponse 结构，details[].field / code 透传
 *   - 未知异常 → 500，且响应体不含堆栈 / 原始错误文案
 *
 * 本测试通过 HTTP seam（supertest）验证，不断言内部实现。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { buildApp } from '../src/app.js'
import { AppError } from '../src/shared/errors.js'

const app = buildApp({ logger: false })

// 探针端点：只用于验证错误处理器；生产路由仍集中在 src/routes.ts 注册。
app.get('/__test__/app-error', async () => {
  throw new AppError(422, 'VALIDATION_FAILED', '字段校验失败', [
    { field: 'name', code: 'REQUIRED' },
    { field: 'priority', code: 'INVALID_VALUE' },
  ])
})

app.get('/__test__/app-error-no-details', async () => {
  throw new AppError(403, 'FORBIDDEN', '没有权限执行该操作')
})

app.get('/__test__/boom', async () => {
  const secret = 'password=topsecret-at-internal-db'
  throw new Error(`未预期异常：${secret}`)
})

beforeAll(async () => {
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe('健康检查', () => {
  it('GET /health 返回 200', async () => {
    const response = await request(app.server).get('/health')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok' })
  })
})

describe('AppError → ErrorResponse', () => {
  it('422 VALIDATION_FAILED 带 details，字段与错误码与契约一致', async () => {
    const response = await request(app.server).get('/__test__/app-error')

    expect(response.status).toBe(422)
    expect(response.body).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: '字段校验失败',
        details: [
          { field: 'name', code: 'REQUIRED' },
          { field: 'priority', code: 'INVALID_VALUE' },
        ],
      },
    })
  })

  it('无 details 时不输出空的 details 字段', async () => {
    const response = await request(app.server).get('/__test__/app-error-no-details')

    expect(response.status).toBe(403)
    expect(response.body).toEqual({
      error: { code: 'FORBIDDEN', message: '没有权限执行该操作' },
    })
    expect(response.body.error).not.toHaveProperty('details')
  })
})

describe('未知异常 → 500 且不泄漏堆栈', () => {
  it('返回统一信封、500，响应体不含堆栈与原始错误文案', async () => {
    const response = await request(app.server).get('/__test__/boom')
    const serialized = JSON.stringify(response.body)

    expect(response.status).toBe(500)
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' },
    })
    expect(response.body).not.toHaveProperty('stack')
    expect(serialized).not.toContain('topsecret-at-internal-db')
    expect(serialized).not.toContain('未预期异常')
    expect(serialized).not.toContain('at ')
  })
})

describe('未知路由 → 统一 404 信封', () => {
  it('GET /not-exist 返回 ErrorResponse 结构', async () => {
    const response = await request(app.server).get('/not-exist')

    expect(response.status).toBe(404)
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: '资源不存在' },
    })
  })
})
