import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalAttachmentStorage } from './local-storage.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createStorage() {
  const root = await mkdtemp(join(tmpdir(), 'aim-attachment-'))
  roots.push(root)
  return { root, storage: new LocalAttachmentStorage(root) }
}

describe('ATTACH #36 本地实体存储', () => {
  it('按服务端 storageKey 写入、读取并删除', async () => {
    const { root, storage } = await createStorage()
    const key = '00000000-0000-4000-8000-000000000001.pdf'
    await storage.write(key, Buffer.from('content'))
    expect(await readFile(join(root, key), 'utf8')).toBe('content')
    expect((await storage.read(key)).toString()).toBe('content')
    await storage.delete(key)
    await expect(readFile(join(root, key))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('同一 storageKey 不覆盖已有文件', async () => {
    const { storage } = await createStorage()
    const key = '00000000-0000-4000-8000-000000000002.png'
    await storage.write(key, Buffer.from('first'))
    await expect(storage.write(key, Buffer.from('second'))).rejects.toMatchObject({ code: 'EEXIST' })
    expect((await storage.read(key)).toString()).toBe('first')
  })

  it('拒绝路径穿越和非白名单存储键', async () => {
    const { storage } = await createStorage()
    await expect(storage.write('../escape.pdf', Buffer.from('x'))).rejects.toThrow('非法附件存储键')
    await expect(
      storage.write('00000000-0000-4000-8000-000000000003.svg', Buffer.from('x')),
    ).rejects.toThrow('非法附件存储键')
  })
})
