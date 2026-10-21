# 验证证据

工作目录：仓库根目录（ROLE-D 临时工作副本）

## 1. 类型检查 + 针对性测试

```text
命令：npm run typecheck && npx vitest run src/modules/ai src/modules/events
结果：通过
- server/web TypeScript：exit 0
- Test Files: 6 passed (6)
- Tests: 30 passed (30)
```

覆盖：共享建议重放/冲突/统计、需求拆分服务与 HTTP、显式 provider 工厂、事件存储/幂等/订阅失败、
定点重投、重放、敏感引用载荷及依赖方向。

## 2. 全仓回归 + 构建

```text
命令：npm test && npm run build
结果：通过
- Test Files: 59 passed (59)
- Tests: 1254 passed (1254)
- build:server exit 0
- build:web exit 0；96 modules transformed
```

## 3. 未验证/不冒充

- 未做浏览器真实界面走查；
- 未落数据库共享建议表、事件表或迁移；
- 未接 `src/shared/`、真实 `can()`、`src/app.ts`、`src/routes.ts`；
- 未调用外部公有云模型；
- 未与 #32/#33 真实生产方联调；
- 未实现 outbox、跨进程可靠投递或 exactly-once。
