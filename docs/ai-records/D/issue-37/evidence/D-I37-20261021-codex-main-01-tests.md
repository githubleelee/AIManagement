# D-I37-20261021-codex-main-01 验证证据

实际工作目录：`/workspace/scratch/05204396b77e/work/AIManagement`

## 1. 类型检查

- 命令：`npm run typecheck`
- 结果：通过。

## 2. #37 针对性测试

- 命令：`npx vitest run src/modules/events/service.test.ts src/modules/events/dependency-direction.test.ts`
- 结果：通过；2 个测试文件、9 项测试全部通过。

## 3. 构建

- 命令：`npm run build`
- 结果：通过；后端 TypeScript 构建和前端 Vite 构建完成，前端共转换 104 个模块。

## 4. 全量回归

- 命令：`npm test`
- 结果：通过；63 个测试文件、1429 项测试全部通过。

## 5. 范围核对

- 分支基线：`origin/main@37287c26a2d867e938132a906f9422354f66eb7c`。
- 本分支不修改 `src/shared/*`、`src/db/schema.prisma`、迁移、`src/app.ts`、`src/routes.ts`、`src/modules/authz/permissions.ts` 或前端公共骨架。
- 未执行真实数据库持久化、跨进程投递、outbox、外部消息队列或业务生产方联调；这些未实现项没有被记录为通过。
- 未执行 PR 合并或 main 写入。
