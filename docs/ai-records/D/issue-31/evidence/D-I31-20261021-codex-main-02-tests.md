# D-I31-20261021-codex-main-02 验证证据

工作目录：项目根目录。

## 1. 首次类型检查

```text
命令：npm run typecheck
结果：失败。
原因：本地 Prisma Client 仍按旧 schema 生成，无法识别最新 main 新增的 UML model。
归因：本地生成物陈旧，不是 #31 源码类型错误。
```

随后执行：

```text
命令：npm run db:generate
结果：通过；Prisma Client v6.19.3 重新生成。
```

## 2. 类型检查与针对性测试

```text
命令：npm run typecheck
结果：通过；服务端与 Web TypeScript 均无错误。

命令：npx vitest run src/modules/ai/factory.test.ts src/modules/ai/plugin.test.ts src/modules/ai/service.test.ts src/modules/ai/store.test.ts
结果：4 个文件、21 项测试全部通过。
```

## 3. 构建

```text
命令：npm run build
结果：通过；服务端编译通过，Web 生产构建 104 modules transformed。
```

## 4. 全仓回归与隔离复跑

```text
命令：npm test
结果：64 个文件通过、1 个文件失败；1440 项通过、1 项失败。
唯一失败：src/modules/requirement/requirement.adversarial2.test.ts
用例：端点 11 并发 10 条 → 落库 10 行，序号集合恰好 0..9
现象：达到 5000ms 超时；失败文件不属于 #31 修改范围。
```

```text
命令：npx vitest run src/modules/requirement/requirement.adversarial2.test.ts -t '端点 11 并发 10 条'
结果：该用例隔离复跑通过，1 passed / 70 skipped，耗时约 1.08s。
```

结论：#31 针对性测试、类型检查和构建通过；全仓首次运行不是全绿，唯一超时用例隔离复跑通过，
因此不得把本批证据描述为“全仓一次性全部通过”。

## 5. 未验证项

- 数据库共享建议表与迁移：未实现，ROLE-B 公共层范围。
- 真实 `can()`、`src/app.ts`、`src/routes.ts` 接线：未实现。
- 真实 #32/#33 生产方联调：未执行。
- 外部模型 API：未实现。
- 浏览器端到端：模块未挂载，未执行。
