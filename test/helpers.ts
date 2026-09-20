/**
 * 测试辅助：app 实例、临时库、登录（T0.5 交付）
 *
 * ===========================================================================
 * 本文件与 `test/http-support.ts` 的关系（**只有一套实现**）
 * ===========================================================================
 *
 * 契约「测试基础设施」规定 T0.5 交付：
 *   `test/helpers.ts ← T0.5 提供的 app 实例与登录辅助`
 *   `test/factories.ts ← T0.5 提供的数据工厂（全员只读）`
 *
 * 但本仓库的历史是：T0.5 当时未交付，于是后续任务各自想办法 —— 先是有人补了
 * `test/http-support.ts`（含 app 实例 + 临时库 + 登录辅助 + 3 个工厂），
 * 再有各模块自建夹具（`src/modules/requirement/test-fixtures.ts`、
 * `src/modules/task/_test-harness.ts` + `_t0-stubs.ts`）。
 *
 * 因此本文件**刻意不重新实现一遍**，而是把 `http-support.ts` 的能力**原样导出**，
 * 使契约点名的两个名字落到同一套实现上：
 *
 *   - 已有 14 个测试文件 `import ... from '../../../test/http-support.js'` 的写法
 *     **一字不用改**（本文件不改动 `http-support.ts`，零破坏）；
 *   - 新代码从 `test/helpers.js` / `test/factories.js` 引入，符合契约命名；
 *   - 仓库里**始终只有一套** app 实例与临时库机制。
 *
 * 为什么需要「当前库」这个概念（`setActiveDatabase` / `getActiveDatabase`）
 *   契约给数据工厂的签名**不带数据库参数**（`makeGoal(projectId, name)`），
 *   而 `buildApp({ prisma })` 的注入点在建上下文时才产生。两者只能靠一个
 *   「当前库」句柄接起来 —— 这也是那份不可用的旧实现（`getPrisma()`）当时的做法。
 *   代价与护栏写在 `setActiveDatabase` 的注释里。
 *
 * ===========================================================================
 * 用法（新测试的标准写法）
 * ===========================================================================
 *
 *   import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
 *   import { createTestContext, type HttpTestContext } from '../test/helpers.js'
 *   import { makeUser, makeProject, makeGoal } from '../test/factories.js'
 *
 *   let ctx: HttpTestContext
 *   beforeAll(async () => { ctx = await createTestContext() })
 *   afterAll(async () => { await ctx.dispose() })
 *   beforeEach(async () => { await ctx.reset() })
 *
 *   it('...', async () => {
 *     const pm = await makeUser('pm', '项目经理')      // 工厂直接写库
 *     const { projectId } = await makeProject(pm.id)    // 工厂直接写库
 *     const res = await ctx.asUser(ctx.loginAs(pm.id)).get(`/projects/${projectId}/goals`)
 *     expect(res.status).toBe(200)
 *   })
 *
 * 要点：**造数用工厂（直接写库）、验证一律走 HTTP**（契约「唯一 seam」）。工厂只
 * 负责把前置数据摆好，不替代接口断言 —— 契约明确禁止用「前端不渲染按钮」之类
 * 非接口证据代替越权用例。
 */
import type { HttpTestContext } from './http-support.js'
import { createHttpTestContext } from './http-support.js'

// 原样转出，保持契约命名的同时不产生第二套实现（`http-support.ts` 未被改动）
export { createHttpTestContext, TEST_PASSWORD } from './http-support.js'
export type { HttpTestContext } from './http-support.js'

/** 工厂函数使用的数据库句柄类型（与 app 指向同一个临时库）。 */
export type TestDb = HttpTestContext['db']

/**
 * 「当前测试库」句柄。
 *
 * ⚠️ 这是一个**模块级可变状态**，是本文件唯一的妥协，理由与护栏如实写在这里：
 *
 *   ① 为什么必须有：契约给工厂的签名不带 db 参数，而 db 是运行时才有的对象。
 *   ② 隔离性由 vitest 保证：默认每个测试文件在**独立模块注册表**里运行，
 *      所以模块级状态不会跨文件泄漏；同一文件内应当只创建一个上下文。
 *   ③ 若一个文件里创建了**多个**上下文（例如同时用两个临时库），后创建的那个会
 *      成为「当前库」—— 此时请显式调用 `setActiveDatabase(ctx.db)` 指明你要用哪个，
 *      或干脆拆成两个测试文件。
 *   ④ `clearActiveDatabase()` 在 `dispose()` 之后调用，可让「忘了建上下文就调工厂」
 *      立刻失败并给出可读错误，而不是悄悄写到上一个库里。
 */
let activeDb: TestDb | null = null

/** 显式指定工厂要写入的库（仅在一个文件里存在多个上下文时才需要）。 */
export function setActiveDatabase(db: TestDb): void {
  activeDb = db
}

/** 清空「当前库」。`dispose()` 之后调用，使误用立刻报错而不是写错库。 */
export function clearActiveDatabase(): void {
  activeDb = null
}

/**
 * 取「当前库」。未设置时**立刻抛错**并说明怎么修 ——
 * 让「忘了 createTestContext」表现为一条可读的失败，而不是 `undefined.id`。
 */
export function getActiveDatabase(): TestDb {
  if (activeDb === null) {
    throw new Error(
      '当前没有激活的测试数据库：工厂函数只写库、不建库。请先 `const ctx = await createTestContext()`，' +
        '或在已有上下文后用 `setActiveDatabase(ctx.db)` 指定（见 test/helpers.ts 顶部说明）。',
    )
  }
  return activeDb
}

/**
 * 创建测试上下文，并把它的临时库登记为「当前库」。
 *
 * 这是工厂 + HTTP 断言组合的**推荐入口**：等价于 `createHttpTestContext()` 再加
 * 一行 `setActiveDatabase(ctx.db)`，并把清理也一并包好。
 */
export async function createTestContext(): Promise<HttpTestContext> {
  const ctx = await createHttpTestContext()
  setActiveDatabase(ctx.db)

  // 包装 dispose：断开与删库之后清空「当前库」，避免后续误用写到已删除的库上
  const originalDispose = ctx.dispose
  return {
    ...ctx,
    dispose: async () => {
      await originalDispose()
      clearActiveDatabase()
    },
  }
}
