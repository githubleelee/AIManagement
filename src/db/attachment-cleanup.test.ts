/**
 * #36 任务附件 —— 清理执行器与任务删除联动测试（ROLE-B 单写）
 *
 * 覆盖：
 *   ④ 任务删除联动：事务内标记 DELETING + 外键 SetNull；提交后清理删文件与行；
 *      清理失败 → 任务删除仍成功 + `CLEANUP_FAILED` + attempts/lastError，重试成功；
 *   ⑤ 事务回滚：任务删除事务失败 → 标记回滚、任务仍在；上传写库失败 → 磁盘无残留文件；
 *   ⑥ 目录穿越：越界 `storagePath` 被拒绝（落 CLEANUP_FAILED，不删存储根以外文件）。
 *
 * ⚠️ 本文件只模拟任务删除事务（`requestTaskAttachmentCleanup` + `task.delete`）：
 *    真实端点 29 的接入点属 ROLE-C 的 `src/modules/task/**`，B 不得直接改，
 *    精确补丁见交付报告（B 走窗口后替换本文件的模拟事务）。
 */
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createAttachmentLifecycle,
  requestTaskAttachmentCleanup,
  runAttachmentCleanup,
  SAFE_CLEANUP_REASON,
} from './attachment-cleanup.js'
import { PrismaAttachmentRepository } from './attachment-repository.js'
import { createTempDatabase, resetDatabase, type TestDatabase } from './test-support.js'
import { AttachmentService } from '../modules/attachment/service.js'
import { LocalAttachmentStorage } from '../modules/attachment/local-storage.js'
import type { AttachmentRecord, AttachmentStoragePort } from '../shared/attachments.js'

class FakeStorage implements AttachmentStoragePort {
  readonly files = new Map<string, Buffer>()
  failDelete = false

  async write(storageKey: string, content: Buffer): Promise<void> {
    this.files.set(storageKey, Buffer.from(content))
  }
  async read(storageKey: string): Promise<Buffer> {
    const content = this.files.get(storageKey)
    if (!content) throw new Error('missing')
    return Buffer.from(content)
  }
  async delete(storageKey: string): Promise<void> {
    if (this.failDelete) throw new Error('disk unavailable')
    this.files.delete(storageKey)
  }
}

let db: TestDatabase
let repository: PrismaAttachmentRepository

beforeAll(() => {
  db = createTempDatabase()
  repository = new PrismaAttachmentRepository(db.prisma)
})

afterAll(async () => {
  await db.dispose()
})

beforeEach(async () => {
  await resetDatabase(db.prisma)
})

type Seed = { pmId: string; memberId: string; projectId: string; taskId: string }

async function seedTask(prisma: PrismaClient): Promise<Seed> {
  const pm = await prisma.user.create({ data: { account: 'pm', displayName: 'PM', passwordHash: 'x' } })
  const member = await prisma.user.create({
    data: { account: 'member', displayName: '成员', passwordHash: 'x' },
  })
  const project = await prisma.project.create({
    data: {
      name: '项目',
      ownerUserId: pm.id,
      members: { create: [{ userId: pm.id, role: 'PM' }, { userId: member.id, role: 'MEMBER' }] },
    },
  })
  const goal = await prisma.businessGoal.create({
    data: { projectId: project.id, name: '目标', sortOrder: 0 },
  })
  const activity = await prisma.userActivity.create({
    data: { projectId: project.id, goalId: goal.id, name: '活动', sortOrder: 0 },
  })
  const story = await prisma.userStory.create({
    data: {
      projectId: project.id,
      activityId: activity.id,
      title: '故事',
      roleText: 'r',
      capabilityText: 'c',
      valueText: 'v',
      businessValue: 'b',
      priority: 'P0',
    },
  })
  const task = await prisma.task.create({
    data: {
      projectId: project.id,
      storyId: story.id,
      title: '任务',
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      planStart: '2026-01-01',
      planEnd: '2026-01-02',
    },
  })
  return { pmId: pm.id, memberId: member.id, projectId: project.id, taskId: task.id }
}

/** 直接插一条带实体文件的附件记录，返回附件 id。 */
async function seedAttachment(
  storage: AttachmentStoragePort,
  seed: Seed,
  options: { storageKey?: string } = {},
): Promise<string> {
  const id = randomUUID()
  const storageKey = options.storageKey ?? `${id}.pdf`
  const content = Buffer.from('%PDF-cleanup')
  await storage.write(storageKey, content)
  const record: AttachmentRecord = {
    id,
    taskId: seed.taskId,
    projectId: seed.projectId,
    originalName: '材料.pdf',
    extension: 'pdf',
    mimeType: 'application/pdf',
    sizeBytes: content.byteLength,
    storageKey,
    uploaderUserId: seed.memberId,
    uploadedAt: new Date('2026-10-23T00:00:00.000Z').toISOString(),
    state: 'ACTIVE',
    cleanupAttempts: 0,
    cleanupError: null,
  }
  await repository.insert(record)
  return id
}

/** 模拟端点 29 的任务删除事务：标记 DELETING + 清可见性 + 删任务（外键 SetNull）。 */
async function deleteTaskTransaction(taskId: string): Promise<number> {
  return db.prisma.$transaction(async (tx) => {
    const marked = await requestTaskAttachmentCleanup(tx, taskId)
    await tx.objectVisibility.deleteMany({ where: { objectType: 'task', objectId: taskId } })
    await tx.task.delete({ where: { id: taskId } })
    return marked
  })
}

describe('④ 任务删除联动与清理', () => {
  it('事务内标记 DELETING + 外键 SetNull；提交后清理删除实体与行', async () => {
    const seed = await seedTask(db.prisma)
    const storage = new FakeStorage()
    const id = await seedAttachment(storage, seed)
    expect(storage.files.size).toBe(1)

    const marked = await deleteTaskTransaction(seed.taskId)
    expect(marked).toBe(1)

    // 任务已删除；附件行保留（taskId 被 SetNull），状态 DELETING —— 未先删实体
    expect(await db.prisma.task.findUnique({ where: { id: seed.taskId } })).toBeNull()
    const row = await db.prisma.attachment.findUnique({ where: { id } })
    expect(row).toMatchObject({ state: 'DELETING', taskId: null })

    const result = await runAttachmentCleanup({ repository, storage })
    expect(result.removed).toBe(1)
    expect(result.failed).toEqual([])
    expect(storage.files.size).toBe(0)
    expect(await db.prisma.attachment.findUnique({ where: { id } })).toBeNull()
  })

  it('清理失败时任务删除仍成功；行保留 CLEANUP_FAILED + attempts/lastError，重试成功', async () => {
    const seed = await seedTask(db.prisma)
    const storage = new FakeStorage()
    const id = await seedAttachment(storage, seed)
    storage.failDelete = true

    await expect(deleteTaskTransaction(seed.taskId)).resolves.toBe(1)
    expect(await db.prisma.task.findUnique({ where: { id: seed.taskId } })).toBeNull()

    const first = await runAttachmentCleanup({ repository, storage })
    expect(first.removed).toBe(0)
    expect(first.failed).toEqual([{ attachmentId: id, reason: SAFE_CLEANUP_REASON }])

    const failedRow = await db.prisma.attachment.findUnique({ where: { id } })
    expect(failedRow).toMatchObject({
      state: 'CLEANUP_FAILED',
      cleanupAttempts: 1,
      cleanupLastError: SAFE_CLEANUP_REASON,
      taskId: null,
    })

    // 重试：存储恢复后同一行被清理
    storage.failDelete = false
    const retry = await runAttachmentCleanup({ repository, storage })
    expect(retry.removed).toBe(1)
    expect(retry.failed).toEqual([])
    expect(await db.prisma.attachment.findUnique({ where: { id } })).toBeNull()
    expect(storage.files.size).toBe(0)
  })

  it('runAttachmentCleanup 遵守 limit（一次只处理指定条数，其余下次再清）', async () => {
    const seed = await seedTask(db.prisma)
    const storage = new FakeStorage()
    await seedAttachment(storage, seed)
    await seedAttachment(storage, seed)
    await seedAttachment(storage, seed)
    // 先进入待清理状态（模拟任务删除联动标记）
    await requestTaskAttachmentCleanup(db.prisma, seed.taskId)

    const result = await runAttachmentCleanup({ repository, storage, limit: 2 })
    expect(result.removed).toBe(2)
    expect(await db.prisma.attachment.count()).toBe(1)
  })

  it('窄生命周期端口：事务内 markForTaskDeletion（可回滚）、提交后 run() 清理', async () => {
    const seed = await seedTask(db.prisma)
    const storage = new FakeStorage()
    const id = await seedAttachment(storage, seed)
    const lifecycle = createAttachmentLifecycle({ repository, storage })

    // 事务内标记；此处模拟端点 29：标记 + 清可见性 + 删任务（SetNull），同一事务提交
    await db.prisma.$transaction(async (tx) => {
      const marked = await lifecycle.markForTaskDeletion(tx, seed.taskId)
      expect(marked).toBe(1)
      await tx.objectVisibility.deleteMany({ where: { objectType: 'task', objectId: seed.taskId } })
      await tx.task.delete({ where: { id: seed.taskId } })
    })
    expect(await db.prisma.attachment.findUnique({ where: { id } })).toMatchObject({
      state: 'DELETING',
      taskId: null,
    })

    // 提交后 run()：批次结果 {removed, failed}，不含 taskId
    const result = await lifecycle.run()
    expect(result).toEqual({ removed: 1, failed: [] })
    expect(await db.prisma.attachment.findUnique({ where: { id } })).toBeNull()
    expect(storage.files.size).toBe(0)
  })

  it('窄生命周期端口：markForTaskDeletion 回滚后不残留 DELETING', async () => {
    const seed = await seedTask(db.prisma)
    const storage = new FakeStorage()
    const id = await seedAttachment(storage, seed)
    const lifecycle = createAttachmentLifecycle({ repository, storage })

    await expect(
      db.prisma.$transaction(async (tx) => {
        await lifecycle.markForTaskDeletion(tx, seed.taskId)
        throw new Error('rollback')
      }),
    ).rejects.toThrow('rollback')

    expect(await db.prisma.attachment.findUnique({ where: { id } })).toMatchObject({
      state: 'ACTIVE',
      taskId: seed.taskId,
    })
  })
})

describe('⑤ 事务回滚', () => {
  it('任务删除事务失败 → 标记回滚，任务仍在、附件仍 ACTIVE 且实体未删', async () => {
    const seed = await seedTask(db.prisma)
    const storage = new FakeStorage()
    const id = await seedAttachment(storage, seed)

    await expect(
      db.prisma.$transaction(async (tx) => {
        await requestTaskAttachmentCleanup(tx, seed.taskId)
        throw new Error('任务删除失败')
      }),
    ).rejects.toThrow('任务删除失败')

    expect(await db.prisma.task.findUnique({ where: { id: seed.taskId } })).not.toBeNull()
    expect(await db.prisma.attachment.findUnique({ where: { id } })).toMatchObject({
      state: 'ACTIVE',
      taskId: seed.taskId,
    })
    expect(storage.files.size).toBe(1)
  })

  it('上传写库失败 → 磁盘无残留文件（service 回滚已写入的实体）', async () => {
    const seed = await seedTask(db.prisma)
    const storage = new FakeStorage()

    // 先占住一个 id（连同实体键），使后续同 id 的 insert 触发唯一约束（写库失败）
    const fixedId = randomUUID()
    await storage.write(`${fixedId}.pdf`, Buffer.from('place'))
    await repository.insert({
      id: fixedId,
      taskId: seed.taskId,
      projectId: seed.projectId,
      originalName: '先占位.pdf',
      extension: 'pdf',
      mimeType: 'application/pdf',
      sizeBytes: 3,
      storageKey: `${fixedId}.pdf`,
      uploaderUserId: seed.memberId,
      uploadedAt: new Date().toISOString(),
      state: 'ACTIVE',
      cleanupAttempts: 0,
      cleanupError: null,
    })

    const conflictService = new AttachmentService({
      repository,
      storage,
      authorization: { async decide() { return { allow: true as const, projectId: seed.projectId } } },
      now: () => new Date('2026-10-23T00:00:00.000Z'),
      createId: () => fixedId,
    })
    await expect(
      conflictService.upload({
        actorUserId: seed.memberId,
        taskId: seed.taskId,
        originalName: '冲突.pdf',
        mimeType: 'application/pdf',
        content: Buffer.from('conflict'),
      }),
    ).rejects.toBeTruthy()

    // 冲突写入的实体文件已被 service 回滚删除，磁盘无残留
    expect(storage.files.size).toBe(0)
    expect(await db.prisma.attachment.count()).toBe(1)
  })
})

describe('⑥ 目录穿越防护', () => {
  it('存储端口拒绝越界存储键（解析后必须仍在存储根内）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aim-attach-escape-'))
    const storage = new LocalAttachmentStorage(root)
    await expect(storage.read('../../etc/passwd')).rejects.toThrow()
    await expect(storage.write('../escape.pdf', Buffer.from('x'))).rejects.toThrow()
    rmSync(root, { recursive: true, force: true })
  })

  it('越界 storagePath 的清理行落 CLEANUP_FAILED，不删除存储根以外的文件', async () => {
    const seed = await seedTask(db.prisma)
    const root = mkdtempSync(join(tmpdir(), 'aim-attach-escape2-'))
    const storage = new LocalAttachmentStorage(root)

    // 直接写入一条越界的「清理中」行（模拟脏数据 / 手工篡改）
    const id = randomUUID()
    await db.prisma.attachment.create({
      data: {
        id,
        projectId: seed.projectId,
        taskId: null,
        uploaderUserId: seed.memberId,
        originalName: 'evil.pdf',
        extension: 'pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        storagePath: '../escape.pdf',
        state: 'DELETING',
        deleteRequestedAt: new Date(),
        cleanupAttempts: 0,
      },
    })

    const result = await runAttachmentCleanup({ repository, storage })
    expect(result.failed).toEqual([{ attachmentId: id, reason: SAFE_CLEANUP_REASON }])
    expect(await db.prisma.attachment.findUnique({ where: { id } })).toMatchObject({
      state: 'CLEANUP_FAILED',
    })
    // 存储根以外的目标文件不存在
    expect(existsSync(resolve(root, '..', 'escape.pdf'))).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })
})
