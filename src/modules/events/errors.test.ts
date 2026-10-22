import Fastify from 'fastify'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registerErrorHandler } from '../../error-handler.js'
import { EventServiceError } from './errors.js'

describe('EventServiceError HTTP mapping', () => {
  const app = Fastify({ logger: false })

  beforeAll(async () => {
    registerErrorHandler(app)
    app.get('/event-error', async () => {
      throw new EventServiceError(422, 'VALIDATION_FAILED', '事件参数不合法')
    })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('uses the shared 4xx envelope instead of falling through to 500', async () => {
    const response = await request(app.server).get('/event-error')

    expect(response.status).toBe(422)
    expect(response.body).toEqual({
      error: { code: 'VALIDATION_FAILED', message: '事件参数不合法' },
    })
  })
})
