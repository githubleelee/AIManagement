import type { FastifyInstance } from 'fastify'
import { currentUserId, requireAuth } from '../../auth/actor.js'
import { AppError } from '../../shared/errors.js'
import { ATTACHMENT_MIME_BY_EXTENSION, MAX_ATTACHMENT_BYTES } from './contracts.js'
import { AttachmentServiceError } from './errors.js'
import type { AttachmentService } from './service.js'

const acceptedMimeTypes = [...new Set(Object.values(ATTACHMENT_MIME_BY_EXTENSION))]

function translate(error: unknown): never {
  if (error instanceof AttachmentServiceError) {
    throw new AppError(error.status, error.kind, error.message, error.details)
  }
  throw error
}

function fileNameFromHeader(value: unknown): string {
  if (typeof value !== 'string') {
    throw new AppError(422, 'VALIDATION_FAILED', '缺少附件名称', [
      { field: 'fileName', code: 'REQUIRED' },
    ])
  }
  try {
    return decodeURIComponent(value)
  } catch {
    throw new AppError(422, 'VALIDATION_FAILED', '附件名称编码不合法', [
      { field: 'fileName', code: 'INVALID_VALUE' },
    ])
  }
}

/**
 * 独立附件插件。上传采用“原始二进制 body + X-File-Name”以避免绑定 multipart SDK。
 * 正式注册和依赖注入由 ROLE-B 在公共组装层完成。
 */
export function registerAttachmentRoutes(app: FastifyInstance, service: AttachmentService): void {
  for (const mimeType of acceptedMimeTypes) {
    if (!app.hasContentTypeParser(mimeType)) {
      app.addContentTypeParser(
        mimeType,
        { parseAs: 'buffer', bodyLimit: MAX_ATTACHMENT_BYTES + 1 },
        (_request, body, done) => done(null, body),
      )
    }
  }

  app.post(
    '/tasks/:taskId/attachments',
    {
      preHandler: requireAuth, bodyLimit: MAX_ATTACHMENT_BYTES + 1,
      // Scope the I-4 translation to this upload endpoint, leaving shared handling unchanged.
      errorHandler(error) {
        if (error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
          throw new AppError(422, 'VALIDATION_FAILED',
            error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ? '附件 MIME 不在白名单中' : '单个附件不能超过 10MB',
            [{ field: error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ? 'mimeType' : 'file',
              code: error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ? 'INVALID_VALUE' : 'TOO_LONG' }],
          )
        }
        throw error
      },
    },
    async (request, reply) => {
      const { taskId } = request.params as { taskId: string }
      if (!Buffer.isBuffer(request.body)) {
        throw new AppError(422, 'VALIDATION_FAILED', '附件请求体必须是二进制文件')
      }
      try {
        const result = await service.upload({
          actorUserId: currentUserId(request),
          taskId,
          originalName: fileNameFromHeader(request.headers['x-file-name']),
          mimeType: request.headers['content-type'] ?? '',
          content: request.body,
        })
        return reply.status(201).send(result)
      } catch (error) {
        translate(error)
      }
    },
  )

  app.get('/tasks/:taskId/attachments', { preHandler: requireAuth }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    try {
      return reply.status(200).send(await service.list(currentUserId(request), taskId))
    } catch (error) {
      translate(error)
    }
  })

  app.get(
    '/attachments/:attachmentId/download',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { attachmentId } = request.params as { attachmentId: string }
      try {
        const result = await service.download(currentUserId(request), attachmentId)
        return reply
          .header('content-type', result.attachment.mimeType)
          .header(
            'content-disposition',
            `attachment; filename*=UTF-8''${encodeURIComponent(result.attachment.originalName)}`,
          )
          .header('content-length', result.content.byteLength)
          .status(200)
          .send(result.content)
      } catch (error) {
        translate(error)
      }
    },
  )

  app.delete(
    '/attachments/:attachmentId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { attachmentId } = request.params as { attachmentId: string }
      try {
        await service.delete(currentUserId(request), attachmentId)
        return reply.status(204).send()
      } catch (error) {
        translate(error)
      }
    },
  )
}
