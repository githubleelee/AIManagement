/**
 * #34 站内通知 —— 数据库仓储适配器（ROLE-B 单写）
 *
 * 实现 `src/modules/notification/contracts.ts` 的 `NotificationRepositoryPort`（D 的
 * `NotificationService` 依赖它），把通知落到 `Notification` 表（迁移
 * `20261023180000_add_notification_runtime`）。D 的消费模块零改动（禁止改
 * `src/modules/notification/**`，见本批任务约束）。
 *
 * 依据：`DECISIONS.md` `notifications.committed-consumption-and-query-contract`、
 *   `notifications.source-event-provenance`；`docs/role-d/ROLE-D-US14-interface-protocol.md` §4–§6。
 *
 * ===========================================================================
 * 三个必须点
 * ===========================================================================
 *
 * 1. **查询层可见性（契约 I-6 / `notifications.source-event-provenance`）**：
 *    `listByRecipient` / `findById` / `findAccessMetadata` / `markRead` 都在**同一条 SQL** 里
 *    校验：收件人 = actor、actor 是当前项目成员、来源事件存在且归属一致、原敏感
 *    `payload.references` 的**全部** task/story 引用对 actor 可见、以及**当前业务关联**
 *    （task/story 本身、Risk.taskId、Milestone 经 TaskMilestone 关联的任务）可见。
 *    任一缺失/撤权/解绑/来源缺失都 fail-closed（整条不返回），**绝不**降级为空引用或先取后滤。
 *
 * 2. **一次快照**：`listByRecipient` 用**单条** SQL 同时算出 items / total / unreadCount；
 *    `total` 是 `unreadOnly` 条件下的真实可见总数，`unreadCount` 是全部当前可见未读数。
 *
 * 3. **追加时校验来源**：`appendIfAbsent` 先核对原事件存在且 `projectId` / `eventName` /
 *    `object` 与通知一致，拒绝缺失或伪造来源（`notifications.source-event-provenance`）；
 *    幂等冲突走鸭子类型判 `P2002`（不用 `instanceof`，见 `src/db/event-repository.ts` 同款理由）。
 */
import { Prisma, type PrismaClient } from '@prisma/client'
import type {
  AppendNotificationResult,
  NotificationAccessMetadata,
  NotificationContent,
  NotificationEventName,
  NotificationRecord,
  NotificationRepositoryPort,
  NotificationSnapshot,
} from '../modules/notification/contracts.js'

/** 读出的行形状（Prisma `$queryRaw` 已按列类型反序列化）。 */
type NotificationRow = {
  id: string
  projectId: string
  recipientUserId: string
  type: string
  sourceEventId: string
  sourceEventName: string
  dedupeKey: string
  referenceObjectType: string
  referenceObjectId: string
  contentKind: string
  contentTitle: string | null
  contentSummary: string | null
  sensitive: boolean
  occurredAt: Date | string
  storedAt: Date | string
  latencyMs: number | bigint
  withinDeliveryTarget: boolean
  isRead: boolean
  readAt: Date | string | null
}

/**
 * 读出 Prisma 已知错误码（`P2002` 等），非 Prisma 错误返回 `null`。
 *
 * 用鸭子类型而非 `instanceof`：注入的 client 与错误类可能不是同一模块实例，构造器身份
 * 不一致会让错误映射静默退化为 500。同款写法见 `src/db/event-repository.ts`。
 */
function prismaErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const code: unknown = (error as { code?: unknown }).code
  return typeof code === 'string' && /^P\d{4}$/.test(code) ? code : null
}

/** 时间列 → ISO 8601 UTC 字符串（`$queryRaw` 可能给 Date，也可能给字符串）。 */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

/** 行 → `NotificationRecord`（content 判别联合由 `contentKind` 重建）。 */
function fromRow(row: NotificationRow): NotificationRecord {
  const content: NotificationContent =
    row.contentKind === 'TEXT'
      ? { kind: 'TEXT', title: row.contentTitle ?? '', summary: row.contentSummary ?? null }
      : { kind: 'REFERENCE_ONLY', title: null, summary: null }
  return {
    id: row.id,
    projectId: row.projectId,
    recipientUserId: row.recipientUserId,
    type: row.type as NotificationRecord['type'],
    sourceEventId: row.sourceEventId,
    sourceEventName: row.sourceEventName as NotificationEventName,
    dedupeKey: row.dedupeKey,
    reference: { objectType: row.referenceObjectType, objectId: row.referenceObjectId },
    content,
    sensitive: row.sensitive === true,
    occurredAt: toIso(row.occurredAt),
    storedAt: toIso(row.storedAt),
    latencyMs: Number(row.latencyMs),
    withinDeliveryTarget: row.withinDeliveryTarget === true,
    isRead: row.isRead === true,
    readAt: row.readAt === null ? null : toIso(row.readAt),
  }
}

/** `NotificationRecord` → Prisma 插入行。 */
function toRow(record: NotificationRecord): Prisma.NotificationUncheckedCreateInput {
  return {
    id: record.id,
    projectId: record.projectId,
    recipientUserId: record.recipientUserId,
    type: record.type,
    sourceEventId: record.sourceEventId,
    sourceEventName: record.sourceEventName,
    dedupeKey: record.dedupeKey,
    referenceObjectType: record.reference.objectType,
    referenceObjectId: record.reference.objectId,
    contentKind: record.content.kind,
    contentTitle: record.content.kind === 'TEXT' ? record.content.title : null,
    contentSummary: record.content.kind === 'TEXT' ? record.content.summary : null,
    sensitive: record.sensitive,
    occurredAt: new Date(record.occurredAt),
    storedAt: new Date(record.storedAt),
    latencyMs: record.latencyMs,
    withinDeliveryTarget: record.withinDeliveryTarget,
    isRead: record.isRead,
    readAt: record.readAt === null ? null : new Date(record.readAt),
  }
}

// ---------------------------------------------------------------------------
// 可见性 SQL 片段（契约 I-6 + notifications.source-event-provenance）
// ---------------------------------------------------------------------------

/**
 * `taskId` 对 `actor` 是否可见（查询层，非「先取后滤」）。
 *
 * 可见 = actor 在 `projectId` 下是 PM，或任务存在且（非敏感，或 actor 在对象白名单里）。
 * 非成员自然为 false（成员资格另由通知可见性片段校验）。
 */
function taskVisibleSql(
  actor: string,
  taskId: Prisma.Sql,
  projectId: Prisma.Sql,
): Prisma.Sql {
  return Prisma.sql`(
    EXISTS (
      SELECT 1 FROM "ProjectMember" pm_task
      WHERE pm_task."projectId" = ${projectId} AND pm_task."userId" = ${actor} AND pm_task."role" = 'PM'
    )
    OR EXISTS (
      SELECT 1 FROM "Task" t_vis
      WHERE t_vis."id" = ${taskId} AND t_vis."projectId" = ${projectId}
        AND (t_vis."isSensitive" = 0 OR EXISTS (
          SELECT 1 FROM "ObjectVisibility" ov_task
          WHERE ov_task."objectType" = 'task' AND ov_task."objectId" = t_vis."id" AND ov_task."userId" = ${actor}
        ))
    )
  )`
}

/** `storyId` 对 `actor` 是否可见（与 `taskVisibleSql` 同构）。 */
function storyVisibleSql(
  actor: string,
  storyId: Prisma.Sql,
  projectId: Prisma.Sql,
): Prisma.Sql {
  return Prisma.sql`(
    EXISTS (
      SELECT 1 FROM "ProjectMember" pm_story
      WHERE pm_story."projectId" = ${projectId} AND pm_story."userId" = ${actor} AND pm_story."role" = 'PM'
    )
    OR EXISTS (
      SELECT 1 FROM "UserStory" s_vis
      WHERE s_vis."id" = ${storyId} AND s_vis."projectId" = ${projectId}
        AND (s_vis."isSensitive" = 0 OR EXISTS (
          SELECT 1 FROM "ObjectVisibility" ov_story
          WHERE ov_story."objectType" = 'story' AND ov_story."objectId" = s_vis."id" AND ov_story."userId" = ${actor}
        ))
    )
  )`
}

/**
 * 通知对 `actor` 可见的完整查询层条件（引用表名 `"Notification"`，故 SELECT / UPDATE 通用）。
 *
 * 依次校验：
 *   1. 收件人 = actor；
 *   2. actor 是通知所属项目的当前成员（或项目 owner）；
 *   3. 来源事件存在，且 `projectId` / `eventName` / `object` 归属与通知一致（拒绝伪造/错配）；
 *   4. 敏感事件的原 `payload.references` 里**所有** task/story 引用对 actor 可见；
 *   5. 通知引用对象的**当前业务关联**对 actor 可见（task/story 本体、Risk.taskId、Milestone 关联任务）。
 *
 * 任一不满足 → 该行不返回（fail-closed）。**不**依赖「先取全量再内存过滤」。
 */
function notificationVisibleSql(actor: string): Prisma.Sql {
  const projectId = Prisma.sql`"Notification"."projectId"`
  const referenceId = Prisma.sql`"Notification"."referenceObjectId"`

  const referenceVisible = Prisma.sql`(
    CASE "Notification"."referenceObjectType"
      WHEN 'task' THEN ${taskVisibleSql(actor, referenceId, projectId)}
      WHEN 'story' THEN ${storyVisibleSql(actor, referenceId, projectId)}
      WHEN 'risk' THEN EXISTS (
        SELECT 1 FROM "Risk" r_vis
        WHERE r_vis."id" = ${referenceId} AND r_vis."projectId" = ${projectId}
          AND (r_vis."taskId" IS NULL OR ${taskVisibleSql(actor, Prisma.sql`r_vis."taskId"`, projectId)})
      )
      WHEN 'milestone' THEN EXISTS (
        SELECT 1 FROM "Milestone" m_vis
        WHERE m_vis."id" = ${referenceId} AND m_vis."projectId" = ${projectId}
      ) AND NOT EXISTS (
        SELECT 1 FROM "TaskMilestone" tm_vis
        JOIN "Task" t_vis ON t_vis."id" = tm_vis."taskId"
        WHERE tm_vis."milestoneId" = ${referenceId} AND t_vis."isSensitive" = 1
          AND NOT ${taskVisibleSql(actor, Prisma.sql`t_vis."id"`, projectId)}
      )
      ELSE 1
    END
  )`

  return Prisma.sql`(
    "Notification"."recipientUserId" = ${actor}
    AND (
      EXISTS (
        SELECT 1 FROM "ProjectMember" pm_actor
        WHERE pm_actor."projectId" = ${projectId} AND pm_actor."userId" = ${actor}
      )
      OR EXISTS (
        SELECT 1 FROM "Project" p_actor
        WHERE p_actor."id" = ${projectId} AND p_actor."ownerUserId" = ${actor}
      )
    )
    AND EXISTS (
      SELECT 1 FROM "DomainEvent" e_src
      WHERE e_src."id" = "Notification"."sourceEventId"
        AND e_src."projectId" = "Notification"."projectId"
        AND e_src."eventName" = "Notification"."sourceEventName"
        AND e_src."objectType" = "Notification"."referenceObjectType"
        AND e_src."objectId" = "Notification"."referenceObjectId"
        AND (
          e_src."sensitive" = 0
          OR NOT EXISTS (
            SELECT 1 FROM json_each(e_src."payload", '$.references') AS ref
            WHERE (
              json_extract(ref.value, '$.objectType') = 'task'
              AND NOT ${taskVisibleSql(actor, Prisma.sql`json_extract(ref.value, '$.objectId')`, Prisma.sql`e_src."projectId"`)}
            ) OR (
              json_extract(ref.value, '$.objectType') = 'story'
              AND NOT ${storyVisibleSql(actor, Prisma.sql`json_extract(ref.value, '$.objectId')`, Prisma.sql`e_src."projectId"`)}
            )
          )
        )
        AND ${referenceVisible}
    )
  )`
}

export class PrismaNotificationRepository implements NotificationRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * 幂等追加。先核对原事件存在且归属一致（拒绝缺失/伪造来源），再插入；
   * `dedupeKey` 唯一冲突（`P2002`）→ 返回既有行，`kind = 'DUPLICATE'`。
   */
  async appendIfAbsent(record: NotificationRecord): Promise<AppendNotificationResult> {
    const sourceEvent = await this.prisma.domainEvent.findUnique({
      where: { id: record.sourceEventId },
      select: { projectId: true, eventName: true, objectType: true, objectId: true },
    })
    if (!sourceEvent) {
      throw new Error('拒绝写入通知：来源事件缺失或已不可用')
    }
    if (
      sourceEvent.projectId !== record.projectId ||
      sourceEvent.eventName !== record.sourceEventName ||
      sourceEvent.objectType !== record.reference.objectType ||
      sourceEvent.objectId !== record.reference.objectId
    ) {
      throw new Error('拒绝写入通知：来源事件归属与通知不一致')
    }

    try {
      const row = await this.prisma.notification.create({ data: toRow(record) })
      return { kind: 'APPENDED', record: fromRow(row as NotificationRow) }
    } catch (error) {
      if (prismaErrorCode(error) !== 'P2002') throw error
      const existing = await this.prisma.notification.findUnique({
        where: { dedupeKey: record.dedupeKey },
      })
      // 理论上 P2002 后必能查到既有行；查不到说明不是本唯一约束冲突，原样抛出。
      if (!existing) throw error
      return { kind: 'DUPLICATE', record: fromRow(existing as NotificationRow) }
    }
  }

  /** 一次快照：单条 SQL 同时给出 items / total / unreadCount / limit / truncated。 */
  async listByRecipient(
    actorUserId: string,
    unreadOnly: boolean,
    limit: number,
  ): Promise<NotificationSnapshot> {
    const bounded = Math.max(1, Math.min(200, Math.trunc(limit)))
    const unreadFilter = unreadOnly ? Prisma.sql`AND "Notification"."isRead" = 0` : Prisma.empty
    const countExpr = unreadOnly
      ? Prisma.sql`COUNT(*) OVER () AS "totalVisible", COUNT(*) OVER () AS "totalUnread"`
      : Prisma.sql`COUNT(*) OVER () AS "totalVisible", SUM(CASE WHEN "Notification"."isRead" = 0 THEN 1 ELSE 0 END) OVER () AS "totalUnread"`

    const rows = await this.prisma.$queryRaw<Array<NotificationRow & {
      totalVisible: number | bigint
      totalUnread: number | bigint
    }>>(Prisma.sql`
      SELECT "Notification".*, ${countExpr}
      FROM "Notification"
      WHERE ${notificationVisibleSql(actorUserId)}
        ${unreadFilter}
      ORDER BY "Notification"."storedAt" DESC, "Notification"."id" DESC
      LIMIT ${bounded}
    `)

    const visibleTotal = rows.length > 0 ? Number(rows[0]!.totalVisible) : 0
    const visibleUnread = rows.length > 0 ? Number(rows[0]!.totalUnread) : 0
    const total = unreadOnly ? visibleUnread : visibleTotal
    return {
      items: rows.map(fromRow),
      total,
      unreadCount: visibleUnread,
      limit: bounded,
      truncated: total > bounded,
    }
  }

  async findAccessMetadata(
    id: string,
    actorUserId: string,
  ): Promise<NotificationAccessMetadata | null> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; recipientUserId: string }>>(Prisma.sql`
      SELECT "Notification"."id" AS "id", "Notification"."recipientUserId" AS "recipientUserId"
      FROM "Notification"
      WHERE "Notification"."id" = ${id} AND ${notificationVisibleSql(actorUserId)}
    `)
    return rows[0] ?? null
  }

  async findById(id: string, actorUserId: string): Promise<NotificationRecord | null> {
    const rows = await this.prisma.$queryRaw<NotificationRow[]>(Prisma.sql`
      SELECT "Notification".*
      FROM "Notification"
      WHERE "Notification"."id" = ${id} AND ${notificationVisibleSql(actorUserId)}
    `)
    return rows[0] ? fromRow(rows[0]) : null
  }

  /**
   * 条件已读：一条带可见性条件的 UPDATE，`readAt` 用 `COALESCE` 保留首次写入的时间。
   * 越权 / 不存在 / 当前不可见 → 影响行数 0 → 返回 `null`（由服务统一映射为 404）。
   */
  async markRead(id: string, actorUserId: string, readAt: string): Promise<NotificationRecord | null> {
    const affected = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "Notification"
      SET "isRead" = 1, "readAt" = COALESCE("readAt", ${new Date(readAt)})
      WHERE "Notification"."id" = ${id} AND ${notificationVisibleSql(actorUserId)}
    `)
    if (Number(affected) === 0) return null
    return this.findById(id, actorUserId)
  }
}
