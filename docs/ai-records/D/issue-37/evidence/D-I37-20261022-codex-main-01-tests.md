# D-I37-20261022-codex-main-01 验证证据

## 自动化检查

命令：`npm run typecheck`

工作目录：#37 独立工作树根目录

结果：通过。

命令：`npx vitest run src/modules/events/service.test.ts src/modules/events/in-memory-repository.test.ts src/modules/events/errors.test.ts`

工作目录：#37 独立工作树根目录

结果：通过；3 个测试文件、16 项测试全部通过。

命令：`npm test`

工作目录：#37 独立工作树根目录

结果：通过；72 个测试文件、1506 项测试全部通过。

命令：`npm run build`

工作目录：#37 独立工作树根目录

结果：通过；服务端与 Vite Web 生产构建成功，Web 共转换 104 个模块。

命令：`git diff --check`

工作目录：#37 独立工作树根目录

结果：通过；未发现空白符错误。

## 未测项

- 未执行真实浏览器人工界面走查；本票新增行为由服务、仓库和 Fastify HTTP 注入测试覆盖。
