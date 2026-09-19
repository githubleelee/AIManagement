/**
 * 统一错误处理器接口测试（T0-01）
 *
 * 契约要求（决策 I-2b / I-3 / I-4）：
 *   - 抛 AppError → 契约的 ErrorResponse 结构；status / code / message / details 透传
 *   - 四个 status（403/404/409/422）各自映射到正确的 HTTP 状态码，不得一律 500
 *   - details 为可选：无字段错误时不得输出 `[]` 或 `null`
 *   - 未知异常 → 500，且响应体不含堆栈 / 原始错误文案 / 文件路径
 *   - 未知路由 → 404，结构与其它失败一致
 *   - 非法 JSON 请求体（请求体解析层错误）→ 400 BAD_REQUEST
 *   - 非解析层 4xx（401 / 403 / 413 / 415）保持原始状态码，不得被改写为 422
 *
 * 本测试通过 HTTP seam（supertest）验证，不断言内部实现。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { buildApp } from '../src/app.js'
import { AppError } from '../src/shared/errors.js'

const app = buildApp({ logger: false })

/** 模拟后续中间件（如 T0-04 的 requireAuth）以 `throw errorWithStatus(...)` 报错。 */
function errorWithStatus(statusCode: number, message: string): Error {
  const error = new Error(message)
  ;(error as Error & { statusCode: number }).statusCode = statusCode
  return error
}

// 探针端点：只用于验证错误处理器；生产路由仍集中在 src/routes.ts 注册。
app.get('/__test__/app-error-403', async () => {
  throw new AppError(403, 'FORBIDDEN', '对象可见但该操作不允许')
})

app.get('/__test__/app-error-404', async () => {
  throw new AppError(404, 'NOT_FOUND', '资源不存在')
})

app.get('/__test__/app-error-409', async () => {
  throw new AppError(409, 'CONFLICT', '状态冲突')
})

app.get('/__test__/app-error-422', async () => {
  throw new AppError(422, 'VALIDATION_FAILED', '字段校验失败', [
    { field: 'name', code: 'REQUIRED' },
    { field: 'priority', code: 'INVALID_VALUE' },
  ])
})

app.get('/__test__/app-error-empty-details', async () => {
  throw new AppError(422, 'VALIDATION_FAILED', '空 details', [])
})

app.get('/__test__/app-error-no-details', async () => {
  throw new AppError(403, 'FORBIDDEN', '没有权限执行该操作')
})

app.get('/__test__/boom', async () => {
  const secret = 'password=topsecret-at-internal-db'
  throw new Error(`未预期异常：${secret}`)
})

// 回归探针（B1）：带 4xx statusCode 的 Fastify 风格错误，必须保持原始状态码。
app.get('/__test__/thrown-401', async () => {
  throw errorWithStatus(401, '未认证')
})

app.get('/__test__/thrown-403', async () => {
  throw errorWithStatus(403, '禁止访问')
})

app.get('/__test__/thrown-415', async () => {
  throw errorWithStatus(415, '不支持的媒体类型')
})

app.get('/__test__/thrown-413', async () => {
  throw errorWithStatus(413, '请求体过大')
})

app.post('/__test__/echo', async (req) => ({ got: req.body }))

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
    const response = await request(app.server).get('/__test__/app-error-422')

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

  // 探针 5：AppError.status 必须被真正使用，四个状态各自映射到正确 HTTP 码
  it.each([
    ['/__test__/app-error-403', 403, 'FORBIDDEN'],
    ['/__test__/app-error-404', 404, 'NOT_FOUND'],
    ['/__test__/app-error-409', 409, 'CONFLICT'],
    ['/__test__/app-error-422', 422, 'VALIDATION_FAILED'],
  ])('%s 返回 %i 且 code=%s（而非一律 500）', async (path, status, code) => {
    const response = await request(app.server).get(path)

    expect(response.status).toBe(status)
    expect(response.body.error.code).toBe(code)
  })

  // 探针 2：details 为可选，无字段错误时不得输出 [] / null
  it('无 details 时不输出空的 details 字段', async () => {
    const response = await request(app.server).get('/__test__/app-error-no-details')

    expect(response.status).toBe(403)
    expect(response.body).toEqual({
      error: { code: 'FORBIDDEN', message: '没有权限执行该操作' },
    })
    expect(response.body.error).not.toHaveProperty('details')
  })

  it('显式传入空 details 数组时也不输出 details', async () => {
    const response = await request(app.server).get('/__test__/app-error-empty-details')

    expect(response.status).toBe(422)
    expect(response.body).toEqual({
      error: { code: 'VALIDATION_FAILED', message: '空 details' },
    })
    expect(response.body.error).not.toHaveProperty('details')
    expect(response.body.error.details).toBeUndefined()
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

  // 探针 4：直接对原始响应文本断言，覆盖堆栈 / 文件路径 / 源码后缀
  it('原始响应文本不含堆栈帧、node_modules 或 .ts 源码路径', async () => {
    const response = await request(app.server).get('/__test__/boom')
    const raw = response.text

    expect(raw).not.toContain('\n    at ')
    expect(raw).not.toContain('node_modules')
    expect(raw).not.toContain('.ts:')
    expect(raw).not.toContain('/src/')
    expect(raw).not.toContain('Error:')
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

  it('未匹配路径的失败结构只有 error.code / error.message 两个键', async () => {
    const response = await request(app.server).post('/not-exist-either')

    expect(response.status).toBe(404)
    expect(Object.keys(response.body)).toEqual(['error'])
    expect(Object.keys(response.body.error).sort()).toEqual(['code', 'message'])
  })
})

describe('非法 JSON 请求体 → 400 BAD_REQUEST（不得误报 500，也不得劫持其它 4xx）', () => {
  it('malformed JSON 返回 400 BAD_REQUEST，而非 500', async () => {
    const response = await request(app.server)
      .post('/__test__/echo')
      .set('content-type', 'application/json')
      .send('{"name": ')

    // 契约 I-4：请求体无法解析为 JSON 是语法层错误，归 400 BAD_REQUEST
    expect(response.status).toBe(400)
    expect(response.status).toBeLessThan(500)
    expect(response.body).toEqual({
      error: { code: 'BAD_REQUEST', message: '请求体不是合法的 JSON' },
    })
  })

  it('非法 JSON 的响应不泄漏解析器内部信息', async () => {
    const response = await request(app.server)
      .post('/__test__/echo')
      .set('content-type', 'application/json')
      .send('{"name": ')

    expect(response.text).not.toContain('node_modules')
    expect(response.text).not.toContain('FST_ERR_CTP')
    expect(response.text).not.toContain('.ts:')
    expect(response.text).not.toContain('\n    at ')
  })
})

describe('非解析层 4xx 保持原始状态码（回归 B1，禁止按状态码区间改写）', () => {
  it.each([
    ['/__test__/thrown-401', 401],
    ['/__test__/thrown-403', 403],
    ['/__test__/thrown-415', 415],
    ['/__test__/thrown-413', 413],
  ])('%s 保持原状态码 %i，而非 422', async (path, status) => {
    const response = await request(app.server).get(path)

    expect(response.status).toBe(status)
    expect(response.status).not.toBe(422)
    // 仍走统一 ErrorResponse 信封（形状不变）
    expect(response.body.error).toBeDefined()
    expect(typeof response.body.error.code).toBe('string')
  })

  it('statusCode=401 映射到 UNAUTHENTICATED（不破坏后续鉴权流程）', async () => {
    const response = await request(app.server).get('/__test__/thrown-401')

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('UNAUTHENTICATED')
  })

  it('statusCode=403 映射到 FORBIDDEN', async () => {
    const response = await request(app.server).get('/__test__/thrown-403')

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
  })
})
