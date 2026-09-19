import type { FastifyReply, FastifyRequest } from 'fastify'
import { UnauthenticatedError } from '../shared/errors'
import { resolveSession } from './session'

// Actor 注入：受保护端点的唯一认证入口。认证失败一律 401，响应体为契约的 ErrorResponse。

declare module 'fastify' {
  interface FastifyRequest {
    actorUserId?: string
  }
}

export function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined
  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) return undefined
  return token
}

export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = extractBearerToken(request.headers.authorization)
  const userId = token ? resolveSession(token) : undefined
  if (!userId) throw new UnauthenticatedError()
  request.actorUserId = userId
}
