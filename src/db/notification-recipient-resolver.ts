/**
 * #34 通知运行时 —— 权威接收者解析器（ROLE-B 单写，`NotificationRecipientResolverPort`）。
 *
 * 依据 `DECISIONS.md` `notifications.public-integration-and-scheduling`：
 *   接收者**只**由权威业务数据解析：`Task.ownerUserId` / `acceptorUserId`、`Risk.ownerUserId`、
 *   `Milestone.ownerUserId?` 与项目 PM；去重后筛**当前成员**与**对象权限**；
 *   逾期用 `planEnd` 作 `dedupeDiscriminator`；**不信任事件 payload 的接收者或正文**；
 *   未接来源（`task.mentioned`）返回 `UNAVAILABLE`，**不用空数组冒充**「无人接收」。
 *
 * 接收者映射（与 `docs/role-d/ROLE-D-US14-interface-protocol.md` §2 对齐）：
 *   - `task.assigned`          → 任务负责人；
 *   - `task.overdue`           → 任务负责人 + PM；
 *   - `acceptance.submitted`   → 任务验收人；
 *   - `acceptance.approved/rejected` → 任务负责人；
 *   - `risk.created/level-raised`    → PM + 风险负责人；
 *   - `milestone.due`          → PM（有节点负责人时再加节点负责人）；
 *   - `task.mentioned`         → UNAVAILABLE（真实来源未接入，见上述裁定）。
 *
 * 正文只在**权威对象当前非敏感**时给出（服务端对敏感事件仍会强制丢弃正文）。
 */
import type { PrismaClient } from '@prisma/client'
import { createAuthorization, type Authorization } from '../modules/authz/permissions.js'
import type {
  NotificationContent,
  NotificationRecipient,
  NotificationRecipientResolverPort,
  NotificationSourceEvent,
  NotificationType,
  RecipientResolution,
} from '../modules/notification/contracts.js'

type TextContent = Extract<NotificationContent, { kind: 'TEXT' }>

const TASK_TITLES: Partial<Record<NotificationSourceEvent['eventName'], string>> = {
  'task.assigned': '新任务分配',
  'task.overdue': '任务已逾期',
  'acceptance.submitted': '任务已提交验收',
  'acceptance.approved': '验收已通过',
  'acceptance.rejected': '验收已驳回',
}

const RISK_TITLES: Partial<Record<NotificationSourceEvent['eventName'], string>> = {
  'risk.created': '新增风险',
  'risk.level-raised': '风险等级提升',
}

function text(title: string, summary: string): TextContent {
  return { kind: 'TEXT', title, summary }
}

export class PrismaNotificationRecipientResolver implements NotificationRecipientResolverPort {
  private readonly can: Authorization['can']

  constructor(
    private readonly prisma: PrismaClient,
    authorization: Authorization = createAuthorization(prisma),
  ) {
    this.can = authorization.can
  }

  async resolve(
    event: NotificationSourceEvent,
    _type: NotificationType,
  ): Promise<RecipientResolution> {
    switch (event.eventName) {
      case 'task.mentioned':
        // 明确未接入的真实来源：绝不返回空数组冒充「无人接收」。
        return { state: 'UNAVAILABLE', note: '@提及真实来源尚未接入，暂无法解析接收者' }
      case 'task.assigned':
      case 'task.overdue':
      case 'acceptance.submitted':
      case 'acceptance.approved':
      case 'acceptance.rejected':
        return this.resolveTask(event)
      case 'risk.created':
      case 'risk.level-raised':
        return this.resolveRisk(event)
      case 'milestone.due':
        return this.resolveMilestone(event)
      default:
        return { state: 'UNAVAILABLE', note: '通知接收者来源尚未接入' }
    }
  }

  private async resolveTask(event: NotificationSourceEvent): Promise<RecipientResolution> {
    const task = await this.prisma.task.findUnique({
      where: { id: event.object.objectId },
      select: {
        id: true,
        projectId: true,
        title: true,
        ownerUserId: true,
        acceptorUserId: true,
        planEnd: true,
        isSensitive: true,
      },
    })
    // 权威对象已不存在（如任务已删）：来源可用但没有可通知对象 → 空接收者（不重试）。
    if (!task || task.projectId !== event.projectId) {
      return { state: 'AVAILABLE', recipients: [] }
    }

    const candidates = new Set<string>()
    switch (event.eventName) {
      case 'task.assigned':
        candidates.add(task.ownerUserId)
        break
      case 'task.overdue':
        candidates.add(task.ownerUserId)
        for (const pm of await this.pmIds(task.projectId)) candidates.add(pm)
        break
      case 'acceptance.submitted':
        candidates.add(task.acceptorUserId)
        break
      case 'acceptance.approved':
      case 'acceptance.rejected':
        candidates.add(task.ownerUserId)
        break
      default:
        break
    }

    const recipients = await this.filterByTaskPermission(
      [...candidates],
      task.projectId,
      task.id,
    )
    const title = TASK_TITLES[event.eventName]
    const content = task.isSensitive || !title ? undefined : text(title, task.title)
    const resolution: RecipientResolution = { state: 'AVAILABLE', recipients: withContent(recipients, content) }
    if (event.eventName === 'task.overdue') {
      return { ...resolution, dedupeDiscriminator: task.planEnd }
    }
    return resolution
  }

  private async resolveRisk(event: NotificationSourceEvent): Promise<RecipientResolution> {
    const risk = await this.prisma.risk.findUnique({
      where: { id: event.object.objectId },
      select: {
        id: true,
        projectId: true,
        title: true,
        ownerUserId: true,
        task: { select: { id: true, isSensitive: true } },
      },
    })
    if (!risk || risk.projectId !== event.projectId) {
      return { state: 'AVAILABLE', recipients: [] }
    }

    const candidates = new Set<string>([risk.ownerUserId, ...(await this.pmIds(risk.projectId))])
    const recipients: string[] = []
    for (const userId of candidates) {
      const decision = await this.can(userId, 'project.read', {
        kind: 'risk',
        projectId: risk.projectId,
        riskId: risk.id,
      })
      if (!decision.allow) continue
      // `can()` 对 risk 不做第 4 条敏感白名单（只覆盖 story/task）；风险敏感继承自关联任务，
      // 这里显式补一次：关联任务敏感且调用者不在白名单（且非 PM）→ 剔除。
      if (risk.task?.isSensitive) {
        const taskDecision = await this.can(userId, 'project.read', {
          kind: 'task',
          projectId: risk.projectId,
          objectId: risk.task.id,
        })
        if (!taskDecision.allow) continue
      }
      recipients.push(userId)
    }
    const title = RISK_TITLES[event.eventName]
    const content = risk.task?.isSensitive || !title ? undefined : text(title, risk.title)
    return { state: 'AVAILABLE', recipients: withContent(recipients, content) }
  }

  private async resolveMilestone(event: NotificationSourceEvent): Promise<RecipientResolution> {
    const milestone = await this.prisma.milestone.findUnique({
      where: { id: event.object.objectId },
      select: { id: true, projectId: true, name: true, ownerUserId: true },
    })
    if (!milestone || milestone.projectId !== event.projectId) {
      return { state: 'AVAILABLE', recipients: [] }
    }

    const links = await this.prisma.taskMilestone.findMany({
      where: { milestoneId: milestone.id },
      select: { task: { select: { id: true, isSensitive: true } } },
    })
    const sensitiveTaskIds = links
      .filter((link) => link.task.isSensitive)
      .map((link) => link.task.id)

    const candidates = new Set<string>(await this.pmIds(milestone.projectId))
    if (milestone.ownerUserId) candidates.add(milestone.ownerUserId)

    const recipients: string[] = []
    for (const userId of candidates) {
      // 当前成员（`project.read` on project 对任何成员放行）。
      const member = await this.can(userId, 'project.read', {
        kind: 'project',
        projectId: milestone.projectId,
      })
      if (!member.allow) continue
      // 里程碑敏感继承自关联任务：所有敏感关联任务都可见才接收（PM 恒可见）。
      if (!(await this.canSeeAllTasks(userId, milestone.projectId, sensitiveTaskIds))) continue
      recipients.push(userId)
    }

    const content = sensitiveTaskIds.length > 0 ? undefined : text('里程碑到期', milestone.name)
    return { state: 'AVAILABLE', recipients: withContent(recipients, content) }
  }

  private async filterByTaskPermission(
    userIds: string[],
    projectId: string,
    taskId: string,
  ): Promise<string[]> {
    const allowed: string[] = []
    for (const userId of userIds) {
      const decision = await this.can(userId, 'project.read', {
        kind: 'task',
        projectId,
        objectId: taskId,
      })
      if (decision.allow) allowed.push(userId)
    }
    return allowed
  }

  private async canSeeAllTasks(
    userId: string,
    projectId: string,
    taskIds: string[],
  ): Promise<boolean> {
    for (const taskId of taskIds) {
      const decision = await this.can(userId, 'project.read', {
        kind: 'task',
        projectId,
        objectId: taskId,
      })
      if (!decision.allow) return false
    }
    return true
  }

  private async pmIds(projectId: string): Promise<string[]> {
    const rows = await this.prisma.projectMember.findMany({
      where: { projectId, role: 'PM' },
      select: { userId: true },
    })
    return rows.map((row) => row.userId)
  }
}

/** 去重后的 userId 列表按需附加同一份安全正文（敏感时 content 为 undefined）。 */
function withContent(userIds: string[], content: TextContent | undefined): NotificationRecipient[] {
  const deduped = [...new Set(userIds)]
  return deduped.map((userId) => (content ? { userId, content } : { userId }))
}
