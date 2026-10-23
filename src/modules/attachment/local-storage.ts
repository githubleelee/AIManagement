import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import type { AttachmentStoragePort } from './contracts.js'

const SAFE_STORAGE_KEY = /^[0-9a-f-]{36}\.(png|jpg|jpeg|webp|pdf|docx|xlsx|zip)$/

export class LocalAttachmentStorage implements AttachmentStoragePort {
  private readonly root: string

  constructor(root = resolve(process.cwd(), 'var/uploads')) {
    this.root = resolve(root)
  }

  async write(storageKey: string, content: Buffer): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await writeFile(this.pathFor(storageKey), content, { flag: 'wx' })
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.pathFor(storageKey))
  }

  async delete(storageKey: string): Promise<void> {
    try {
      await unlink(this.pathFor(storageKey))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  private pathFor(storageKey: string): string {
    if (!SAFE_STORAGE_KEY.test(storageKey)) throw new Error('非法附件存储键')
    const target = resolve(this.root, storageKey)
    if (!target.startsWith(`${this.root}${sep}`)) throw new Error('附件路径越界')
    return target
  }
}
