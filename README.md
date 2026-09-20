# 爱管理（AI Management）

新一代 AI 驱动的软件项目管理平台。以「透明、协同、数据驱动」为核心理念，构建需求—任务—进度—质量—风险—AI 建议的一体化管理闭环。

软件项目管理课程项目 · 4 名团队成员 + 多 AI 智能体（4+n）

## 当前状态

**Sprint 1**：交付「项目 → 权限 → 需求 → 任务」的最小可运行链路。

| 编号 | 用户故事 |
|---|---|
| US-01 | 创建项目并添加成员 |
| US-02 | 设置成员权限及敏感资料可见范围 |
| US-03 | 建立业务目标、用户活动和用户故事 |
| US-05 | 把用户故事拆成任务并安排负责人 / 验收人 |

## 文档

| 文档 | 内容 |
|---|---|
| [Sprint 1 基线](docs/sprint1-baseline.md) | 验收标准、实现决策、任务拆解、任务领取约定、风险清单、决策记录 |
| [需求规格说明书 · 接口契约](docs/sprint1-spec-interface-contract.md) | 共享类型与枚举、错误码表、鉴权入口、30 个端点契约、数据模型、测试决策 |

## 技术栈

React + TypeScript + Vite　/　Node + TypeScript + Fastify　/　SQLite + Prisma　/　Zod　/　Vitest + supertest

## 快速开始

> **全新 clone 请先从「首次运行」开始。** `.env` 与 `*.db` 都在 `.gitignore` 里，新 clone 两者都不存在；
> 跳过「创建 `.env`」与「应用迁移」两步的典型症状是**服务能起来、`/health` 也正常，
> 但任何走数据库的接口都返回 500**（错误信息见下）。

### 首次运行（新 clone 必做，按顺序执行）

```bash
# 1. 安装依赖（postinstall 会自动执行 prisma generate）
npm install

# 2. 创建本地环境变量文件
#    缺它的报错：Environment variable not found: DATABASE_URL
#    Windows PowerShell 用：Copy-Item .env.example .env
cp .env.example .env

# 3. 建库并应用迁移（SQLite 文件：src/db/dev.db）
#    缺它的报错：The table main.Project does not exist in the current database
npm run db:migrate

# 4. 写入演示账号与演示项目（幂等，可重复执行）
#    仓库没有注册端点，浏览器登录必须先有账号，故本步不可省
npm run db:seed
```

### 日常命令

```bash
npm run dev        # 同时启动后端（http://localhost:3000）与前端（http://localhost:5173）
npm test           # 运行 Vitest + supertest 测试
npm run typecheck  # 前后端类型检查
npm run build      # 产出 dist/
npm start          # 运行已构建的后端
```

### 演示账号（由 `npm run db:seed` 创建）

| 账号 | 姓名 | 在「演示项目：爱管理」中的角色 |
|---|---|---|
| `pm` | 王经理 | PM（项目经理） |
| `member1` | 李工 | MEMBER（项目成员） |
| `member2` | 张工 | MEMBER（项目成员） |
| `viewer1` | 刘总 | VIEWER（管理者） |
| `outsider` | 外部用户 | 不属于演示项目（另有自己的项目，用于验证列表隔离与非成员 404） |

统一密码 `Passw0rd!`。seed 按账号 upsert，重复执行不会产生重复数据。

后端健康检查：`GET http://localhost:3000/health` 返回 `{ "status": "ok" }`。

## 工作约定

### 接口契约

Sprint 1 期间**接口契约冻结**。任何修改走四步：提出 → 受影响模块确认 → 单人修改 → 通知全员。
契约的权威来源是《需求规格说明书 · 接口契约》；与之冲突时以契约为准，并需在 24 小时内回写基线文档。

### 任务领取

1. 从 Sprint 待办里领**单个任务**（不是整个模块、也不是一批任务）
2. **同一时刻，一个模块只允许一个人**在改
3. 建短分支 `feat/T<编号>-<短描述>`，完成一个任务就合入主干，不留长分支
4. 卡住超过 10 分钟就喊人，不闷头调

### 文件所有权

每人只在自己的模块目录内新增文件。以下三处**只读**，改动需通知技术负责人单人修改：

- 共享类型、枚举与校验器
- 数据库 schema
- 路由注册表

## 进行中的工作

见 [Issues](https://github.com/githubleelee/AIManagement/issues)。

Sprint 1 的前置工单为 T0-01 至 T0-06，构成一条依赖链；其中 T0-04 与 T0-05 可并行。
T0 链现已全部交付；T0-06「骨架冒烟链路收口」的护栏在 `test/skeleton-smoke.test.ts` ——
它逐条断言契约端点确实注册在**生产** app 上（不是注册在测试探针里），并走通主链路。
