/**
 * Fastify 应用装配（T0-01）
 *
 * 只做三件事：注册统一错误处理器、集中注册路由、提供依赖注入缝隙。
 * 业务模块不得在这里 import 自己的 handler；统一走 routes.ts。
 *
 * ---------------------------------------------------------------------------
 * 【本次扩展】为什么新增 `prisma` 可选注入（T0 缺口修补）
 *
 * 契约「Testing Decisions → 唯一 seam」规定：**HTTP 接口层是唯一测试 seam**，
 * 且「越权用例必须打接口，不能用『前端不渲染按钮』代替」。
 *
 * 但原装配只有 `buildApp({ logger })`，而数据库来自 `src/db/client.ts` 的
 * **模块级单例**——该单例在首次构造时绑定当时的 `DATABASE_URL`，之后不再重新绑定
 * （见 test/db-client-isolation.test.ts 的探针结论）。
 *
 * 后果：`buildApp()` 构造出的 app 永远查单例，也就是**永远连 `.env` 的 dev.db**，
 * 无法指向测试用临时库。于是「打接口」的测试要么污染开发库，要么无法隔离。
 * 这是 T0 交付的真缺口：数据层可测（97 例），但 **HTTP 层没有注入缝隙**，
 * 导致契约要求的「接口层越权测试」在四个模块上都写不出来。
 *
 * 修补方式（**向后兼容，不改变任何既有行为**）：
 *   - 新增可选参数 `prisma`。**不传时行为与原先完全一致**（回落全局单例）。
 *   - 现有调用 `buildApp({ logger: false })` 与 `buildApp()` 均无需改动。
 *   - 测试改为 `buildApp({ prisma: tempDb.prisma })`，即可让 app 指向独立临时库。
 *
 * 本扩展不改动 `src/db/client.ts`（仍保持单例语义），不触碰 `AppError`、
 * 错误码表或任何既有签名，因此**不构成契约变更**；待模块负责人接管后可调整。
 * ---------------------------------------------------------------------------
 */
import Fastify, { type FastifyInstance } from 'fastify'
import type { Prisma, PrismaClient } from '@prisma/client'
import { registerErrorHandler } from './error-handler.js'
import { registerRoutes, type RouteContext } from './routes.js'
import { registerActorResolver } from './auth/actor.js'
import { prisma as defaultPrisma } from './db/client.js'
import { PrismaEventRepository, createEventAuthorizationPort } from './db/event-repository.js'
import { createGanttEventPort } from './modules/gantt/event-port.js'
import { createRequirementEventPort } from './modules/requirement/event-port.js'
import { createRiskEventPort } from './modules/risk/event-port.js'
import { PrismaAiSuggestionRepository, createAiAuthorizationPort } from './db/ai-repository.js'
import { createDomainEventInfrastructure } from './modules/events/factory.js'
import { createAiBreakdownService } from './modules/ai/factory.js'
import { createPrismaAiStorySource } from './modules/ai/story-source.js'
import { createTaskStartGuardPort } from './modules/task/rules.js'
import type { RequirementBreakdownRecord } from './shared/ai.js'
import type {
  DomainEventPublisherPort,
  DomainEventQueryPort,
  DomainEventReplayPort,
  DomainEventSubscriberPort,
} from './shared/events.js'

/**
 * 挂到 Fastify 实例上的事件公共端口（业务域只依赖这些端口，不 import D 的 service）。
 *
 * 组装点唯一（`DECISIONS.md` `arch.shared-ports-and-assembly`）：仓储适配器、权限适配器、
 * D 的事件实现都在这里显式注入；生命周期由 `onReady` / `onClose` 驱动。
 */
export type EventPorts = {
  publisher: DomainEventPublisherPort
  subscriber: DomainEventSubscriberPort
  query: DomainEventQueryPort
  replay: DomainEventReplayPort
}

declare module 'fastify' {
  interface FastifyInstance {
    /** 领域事件公共端口（由 `buildApp` 组装注入）。 */
    events: EventPorts
  }
}

export type BuildAppOptions = {
  /** 是否开启 Fastify 日志。测试环境建议关闭，避免噪声。 */
  logger?: boolean
  /**
   * 数据库客户端注入点。
   *
   * 不传时回落到 `src/db/client.ts` 的全局单例（生产 / 本地开发路径）；
   * 测试传入 `createTempDatabase().prisma` 以使用独立临时库，避免污染 dev.db。
   */
  prisma?: PrismaClient
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? process.env.NODE_ENV !== 'test',
  })

  // 不传 prisma 时与原先行为完全一致（回落单例）
  const context: RouteContext = { prisma: options.prisma ?? defaultPrisma }

  // #31 US-11 AI 建议：显式组装模型端口（本轮 `LOCAL_STUB`）、DB 仓储、统一鉴权适配器与只读
  // 故事来源，注入路由总表。业务域通过服务端口复用，不 import D 的 service（契约 I-9）。
  // 外部模式必须显式注入 adapter；配置错误直接阻止启动，禁止静默降级为桩。
  context.aiService = createAiBreakdownService({
    ai: { mode: 'LOCAL_STUB' },
    authorization: createAiAuthorizationPort(context.prisma),
    repository: new PrismaAiSuggestionRepository<RequirementBreakdownRecord>(context.prisma),
    storySource: createPrismaAiStorySource(context.prisma),
  })

  // #37 领域事件：显式注入 DB 仓储 + 统一鉴权适配器，组装 D 的事件实现。
  // 业务域通过 `app.events` 使用 publisher / query 端口，不 import D 的 service（契约 I-9）。
  // ★ 同一个 `PrismaEventRepository` 实例同时供 D 的基础设施与两个域内事件适配器使用：
  //   两套连接语义（同一 prisma 客户端）才不会出现「查询看不到域内写入」的裂缝。
  const eventRepository = new PrismaEventRepository(context.prisma)
  const infrastructure = createDomainEventInfrastructure({
    repository: eventRepository,
    authorization: createEventAuthorizationPort(context.prisma),
  })
  const events: EventPorts = {
    publisher: { publish: (input) => infrastructure.publish(input) },
    subscriber: { subscribe: (eventName, subscriberId, handler) =>
      infrastructure.subscribe(eventName, subscriberId, handler) },
    // ★ 组装层把 actor 注入 filter：D 的 service 原样透传给仓储，
    //   DB 适配器据此在**查询层**做对象级可见性过滤（契约 I-6）。
    query: { query: (actorUserId, query) => infrastructure.query(actorUserId, { ...query, actorUserId }) },
    replay: {
      redeliver: (actorUserId, eventId) => infrastructure.redeliver(actorUserId, eventId),
      replay: (actorUserId, query) => infrastructure.replay(actorUserId, { ...query, actorUserId }),
    },
  }
  app.decorate('events', events)

  // 业务域事件端口：域内适配器把草稿映射为信封，在**调用方事务**内追加（不自行提交）。
  // 与 D 的基础设施共用同一个仓储实例（见上）。
  context.ganttEvents = createGanttEventPort({ repository: eventRepository })
  context.requirementEvents = createRequirementEventPort({ repository: eventRepository })
  context.riskEvents = createRiskEventPort({ repository: eventRepository })
  // 生命周期：Fastify 启动完成 / 关闭时驱动 D 的事件基础设施。
  app.addHook('onReady', async () => {
    await infrastructure.start()
  })
  app.addHook('onClose', async () => {
    await infrastructure.stop()
  })

  // FS 开工守卫窄端口（#13）：显式装配 `src/modules/task/rules.ts` 的**同一**守卫实现，
  // 供需要“进入 DOING”的其他域（当前为验收 REJECT）在同一事务内调用。不是第二套复制，
  // 也没有 no-op / 默认放行；引用方缺省时应 fail-fast。
  context.taskStartGuard = createTaskStartGuardPort<Prisma.TransactionClient>()

  registerErrorHandler(app)
  // Actor 解析：只把「当前是谁」注入 request，不做权限判定（权限一律由 can() 现查库）。
  // 采用 onRequest 钩子而非全局强制鉴权，避免误拦公开端点（如端点 1 登录）。
  registerActorResolver(app, context.prisma)
  registerRoutes(app, context)

  return app
}
