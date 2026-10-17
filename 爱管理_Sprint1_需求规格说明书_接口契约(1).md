# 爱管理 Sprint 1 需求规格说明书（接口契约基线）

| 项目 | 内容 |
|---|---|
| 项目名称 | 爱管理 —— 新一代 AI 驱动的软件项目管理平台 |
| 文档类型 | Spec（需求规格说明书），重点为跨任务接口契约 |
| 适用范围 | Sprint 1：US-01、US-02、US-03、US-05 |
| 修订日期 | 2026-09-19 |
| 状态 | ready-for-agent |
| 配套文档 | 《爱管理_Sprint1基线_US-01_02_03_05.md》（验收标准 / 实现决策 / 任务拆解 / 领取约定） |

**本文档的目的**：4 名成员并行开发时，各自实现的模块必须能拼装成可运行的增量。拼装失败的唯一原因通常是接口不一致。本文档把**所有跨模块接口冻结成契约**，任何人不得单方面修改。

**阅读约定**：`?` 表示可选字段，`|` 表示联合类型，所有 id 为 `string`，所有时间戳为 ISO 8601 UTC 字符串。

---

## Problem Statement

Sprint 1 由 4 名成员在 55 分钟内并行开发，每人负责一个模块（M2 项目与成员 / M3 授权与敏感可见 / M4 需求层级 / M5 任务）。成员之间无法实时对齐彼此的字段命名、响应结构、错误码和权限判定结果。

如果接口不一致，会出现以下具体失败：

- 成员 1 的接口返回 `{ projectName }`，成员 3 按 `{ name }` 读取，页面显示空白
- 成员 2 的 `can()` 返回布尔值，成员 4 不知道该返回 403 还是 404，同一种越权行为在不同端点给出不同状态码，验收脚本无法统一断言
- 成员 3 在需求列表里用内存过滤敏感对象，成员 5 的任务列表用 SQL 过滤，同一个敏感对象在两个视图里可见性不一致
- 成员 4 直接用整数自增 id，成员 3 用字符串 id，跨模块传参时类型不匹配
- 成员之间互相调用对方的 service 函数，形成循环依赖，主干无法编译

**从使用者角度看**：项目经理打开项目后看到的是残缺或自相矛盾的界面 —— 项目列表有数据但点进去 404，用户故事建好了但任务挂不上去，同一个人在这个页面能看见敏感需求、在那个页面又能看见。

## Solution

发布一份**接口契约基线**，在任何人动手写代码之前冻结以下五项：

1. **共享类型与枚举** —— 跨模块传递的所有数据形状，含线上（wire）取值与界面中文标签的映射
2. **统一响应信封与错误码表** —— 成功与失败的结构一致，错误码可被测试断言
3. **唯一鉴权入口 `can()` 与列表可见性作用域 `visibilityScope()`** —— 权限判定集中在一处，并由它返回该用的 HTTP 状态码
4. **REST 端点全量契约** —— 每个端点的路径、请求体、响应体、错误、权限、副作用
5. **模块依赖方向规则** —— 禁止模块间互相调用 service，只共享数据访问层与类型定义

契约冻结后，4 名成员各自实现自己的模块，彼此的代码无需阅读即可拼装。任何契约变更走「提出 → 全员确认 → 单人修改 → 通知」流程。

## User Stories

### 产品使用者视角

1. 作为项目经理，我要创建项目并自动成为该项目的项目经理，以便立刻拥有一个可操作的项目空间。
2. 作为项目经理，我要在项目列表中只看到自己参与的项目，以便不被无关项目干扰。
3. 作为项目经理，我要查看项目详情，以便确认项目名称与描述是否符合预期。
4. 作为项目经理，我要通过账号添加已有用户为项目成员，以便让同事进入同一个工作空间。
5. 作为项目经理，我要为新成员指定项目角色，以便控制他能做什么。
6. 作为项目经理，我要看到成员列表中的姓名、账号、角色与加入时间，以便核对成员构成。
7. 作为项目经理，我要调整已有成员的角色，以便成员职责变化时及时更新权限。
8. 作为项目经理，我要移除成员，以便离职或转岗人员立即失去访问权。
9. 作为项目经理，我要无法移除自己，以便项目不会因为误操作而失去唯一的管理者。
10. 作为项目经理，我要无法把最后一个项目经理降级，以便项目始终有人能管理成员。
11. 作为项目成员，我要访问非我参与的项目时被拒绝，以便他人项目的数据不会被我看到。
12. 作为项目成员，我要在本项目内看到非敏感的需求与任务，以便开展工作。
13. 作为项目成员，我要无法创建、编辑或删除需求与任务，以便需求口径不被随意改动。
14. 作为项目成员，我要无法增删成员或修改角色，以便成员边界稳定。
15. 作为管理者，我要在本项目内只读查看，以便了解项目情况而不干预执行。
16. 作为项目经理，我要把某条用户故事或某个任务标记为敏感，以便控制资料可见范围。
17. 作为项目经理，我要指定哪些成员可以看到某条敏感对象，以便敏感资料只对必要的人开放。
18. 作为项目经理，我要在关闭敏感标记后让全项目成员恢复可见，以便标记错误可以回退。
19. 作为被授权成员，我要能看到指定给我的敏感对象，以便获取完成工作所需的资料。
20. 作为未被授权的成员，我要在列表、详情、统计计数中都看不到敏感对象，以便不通过数字差异推断出敏感对象的存在。
21. 作为未被授权的成员，我要在直接请求敏感对象接口时得到与「不存在」一致的响应，以便无法通过响应差异探测敏感对象是否存在。
22. 作为项目经理，我要在权限或可见范围变更后立即生效，以便无需等待被授权人重新登录。
23. 作为项目经理，我要能查到角色变更与可见范围变更的记录，以便事后追溯谁改了权限。
24. 作为项目经理，我要建立业务目标，以便把需求挂在明确的业务价值之下。
25. 作为项目经理，我要为业务目标填写描述并设置状态，以便区分正在推进与已完成的目标。
26. 作为项目经理，我要调整业务目标的排序，以便把最重要的目标排在前面。
27. 作为项目经理，我要在业务目标下建立用户活动，以便把目标拆解为用户的关键行为。
28. 作为项目经理，我要无法建立没有归属的用户活动，以便层级结构不出现孤儿节点。
29. 作为项目经理，我要调整用户活动的排序，以便活动顺序与业务流程一致。
30. 作为项目经理，我要在用户活动下建立用户故事，以便把活动细化为可交付的需求单元。
31. 作为项目经理，我要用「作为〈角色〉，我要〈能力〉，以便〈价值〉」三段式分字段录入用户故事，以便每个字段都能被独立检索与展示。
32. 作为项目经理，我要为用户故事填写业务价值与优先级，以便排期时有依据。
33. 作为项目经理，我要在一个层级树中看到 目标 → 活动 → 故事 的完整归属关系，以便理解需求结构。
34. 作为项目经理，我要在层级树中看到每条用户故事的状态、优先级与下级数量，以便快速判断进度。
35. 作为项目经理，我要无法删除仍有下级节点的目标或活动，以便不会因为一次误删而丢失整批需求。
36. 作为项目经理，我要无法把一条用户故事挂到其他项目的用户活动下，以便项目数据不互相污染。
37. 作为项目经理，我要在用户故事详情中创建任务，以便把需求转为可执行工作。
38. 作为项目经理，我要为一个用户故事创建多个任务，以便一条需求可以由多项工作共同完成。
39. 作为项目经理，我要为任务指定负责人，以便明确谁来做。
40. 作为项目经理，我要为任务指定验收人，以便明确谁来验收。
41. 作为项目经理，我要无法把负责人与验收人指定为同一人，以便验收具有独立性。
42. 作为项目经理，我要在项目成员不足两人时无法创建任务，以便不会产生无法满足独立性要求的任务。
43. 作为项目经理，我要为任务填写计划开始与计划结束日期，以便后续甘特图与排期建议有数据基础。
44. 作为项目经理，我要在计划结束早于计划开始时被拒绝，以便计划时间始终合法。
45. 作为项目经理，我要在任务详情中修改负责人、验收人与计划时间，以便计划变化时及时调整。
46. 作为项目经理，我要在任务列表中标出负责人、验收人、计划时间与状态，以便一眼看清执行安排。
47. 作为项目经理，我要维护任务状态（未开始 / 进行中 / 已完成），以便反映执行进展。
48. 作为项目经理，我要无法删除仍有任务挂载的用户故事，以便不会产生孤儿任务。
49. 作为项目经理，我要把任务标记为敏感并指定可见成员，以便对敏感工作任务做同样的访问控制。
50. 作为项目成员，我要在未登录时被拦截，以便项目数据不对匿名访问开放。

### 开发协作者视角（接口契约本身）

51. 作为模块开发者，我要一份共享类型与枚举定义，以便我写的字段名与其他模块完全一致。
52. 作为模块开发者，我要枚举在传输层使用固定的英文常量、在界面层映射为中文标签，以便前后端不因为显示文案变化而破坏契约。
53. 作为模块开发者，我要所有成功响应与失败响应结构统一，以便前端可以写一份通用的请求处理逻辑。
54. 作为模块开发者，我要一份错误码表，以便我对每一种校验失败返回可被测试断言的固定代码。
55. 作为模块开发者，我要调用同一个鉴权入口 `can()` 而不是自己写角色判断，以便同一种越权行为在所有端点返回相同状态码。
56. 作为模块开发者，我要 `can()` 直接返回该使用的 HTTP 状态码，以便我不必在每个调用点重新判断 403 还是 404。
57. 作为模块开发者，我要 `can()` 自己按 id 加载目标对象，以便我无法通过传入伪造的敏感标记绕过鉴权。
58. 作为模块开发者，我要一个列表可见性作用域接口 `visibilityScope()`，以便我在查询层过滤敏感对象而不是在内存里过滤。
59. 作为模块开发者，我要 `visibilityScope()` 在调用者是项目经理时返回「无限制」，以便我不必为管理者单独写一条查询分支。
60. 作为模块开发者，我要所有 id 都是字符串类型，以便跨模块传参不会出现类型不匹配。
61. 作为模块开发者，我要所有日期字段使用 `YYYY-MM-DD` 固定格式，以便日期解析在各模块行为一致。
62. 作为模块开发者，我要一份端点全量索引表，以便我快速找到某个能力该调用哪个端点。
63. 作为模块开发者，我要每个端点明确标注所需权限动作，以便我在实现时直接引用而不用推断。
64. 作为模块开发者，我要每个端点明确列出可能的错误码，以便我的测试可以精确断言。
65. 作为模块开发者，我要任务响应内嵌负责人与验收人的简要信息，以便前端不必为每个任务再发起一次用户查询。
66. 作为模块开发者，我要模块间只共享数据访问层与类型定义、不互相调用 service，以便四人的代码不会形成循环依赖。
67. 作为模块开发者，我要一份共享文件冻结清单，以便我知道哪些文件改动需要先通知全员。
68. 作为模块开发者，我要一份「任务编号 → 我负责的端点」对照表，以便我明确自己的交付范围与边界。
69. 作为模块开发者，我要契约变更走固定流程（提出 → 全员确认 → 单人修改 → 通知），以便并行开发期间接口不会被我单方面改掉。
70. 作为质量负责人，我要一套按端点组织的接口测试，以便任何模块的实现都能被独立验证。
71. 作为质量负责人，我要一个越权矩阵测试，覆盖三种项目角色对五种权限动作的组合，以便权限边界被穷举验证。
72. 作为质量负责人，我要测试数据由工厂函数自建、不依赖全局种子数据，以便测试之间互不污染。
73. 作为质量负责人，我要在 Sprint 1 结束前能跑通一条从建项目到拆任务的主链路脚本，以便 Sprint 评审时可直接演示。

## Implementation Decisions

### 决策 I-0：技术栈与工程结构（已确认）

| 层 | 选型 |
|---|---|
| 前端 | React + TypeScript + Vite |
| 后端 | Node + TypeScript + Fastify |
| 数据库 | SQLite |
| ORM | Prisma |
| 校验 | Zod |
| 测试 | Vitest + supertest |

**工程结构（决定四人的文件所有权）**

```text
src/
  shared/       ← 冻结：共享类型、枚举、错误类、校验器（技术负责人唯一修改人）
  db/           ← 冻结：schema.prisma、Prisma client 单例（技术负责人）
  auth/         ← M1 会话与 Actor 注入（T0.3）
  modules/
    project/       ← M2  模块 A 独占
    authz/         ← M3  模块 B 独占
    requirement/   ← M4  模块 C 独占
    task/          ← M5  模块 D 独占
  routes.ts     ← 冻结：路由注册表（技术负责人）
web/src/pages/  ← 每人只在自己的页面目录下新增文件
test/factories.ts ← T0.5 提供，全员只读
```

**文件所有权的唯一规则**：**每人只在自己的模块目录内新增文件。** `shared/`、`db/`、`routes.ts` 三处只读，需要改动时通知技术负责人单人修改。

这条规则把 merge 冲突从「可能发生」变成「结构上不可能」—— 两人永远不会碰同一个文件。

### 两条 SQLite 特有的工程约束

| 约束 | 后果 | 应对 |
|---|---|---|
| Prisma 在 SQLite 上不支持原生 `enum` | 写了 `enum` 会直接报错，主干无法启动 | 数据库列用 `String`；取值约束的唯一来源是 TypeScript 联合类型 + Zod 枚举 |
| SQLite 的外键约束需要 `PRAGMA foreign_keys=ON` | `onDelete: Restrict` 静默失效，删除保护形同虚设 | Prisma 默认启用；但 T0.2 必须写一条测试验证「删除有子项的目标确实被拒绝」，不能只依赖配置 |

第二条是全文档最隐蔽的风险：若外键约束未生效，端点 13、17、22 的 `HAS_CHILDREN` 约定会全部失效，而错误现象只是在删除后出现孤儿数据 —— 不会报错，只会静默损坏。

### 决策 I-1：线上格式与展示标签分离

枚举在**传输层使用英文常量**，界面层映射为中文标签。理由：中文显示文案会随界面调整，若作为契约值会导致跨模块断裂。

| 类型 | 线上常量 | 界面标签 |
|---|---|---|
| ProjectRole | `PM` / `MEMBER` / `VIEWER` | 项目经理 / 项目成员 / 管理者 |
| GoalStatus | `ACTIVE` / `DONE` | 进行中 / 已完成 |
| StoryStatus | `DRAFT` / `PLANNING` / `DONE` | 待规划 / 规划中 / 已完成 |
| Priority | `P0` / `P1` / `P2` | P0 / P1 / P2 |
| TaskStatus | `TODO` / `DOING` / `DONE` | 未开始 / 进行中 / 已完成 |

**接口陷阱（必须显式处理）**：`GoalStatus`、`StoryStatus`、`TaskStatus` 三者都存在取值 `DONE`。它们语义不同且互相不可赋值，**禁止共用同一个类型别名**，也禁止把三者的状态值互相传递。类型定义必须是三个独立类型（即使底层都是字符串）。

### 决策 I-2：共享类型定义

```ts
// ---------- 枚举（见决策 I-1） ----------
type ProjectRole = 'PM' | 'MEMBER' | 'VIEWER'
type GoalStatus  = 'ACTIVE' | 'DONE'
type StoryStatus = 'DRAFT' | 'PLANNING' | 'DONE'
type Priority    = 'P0' | 'P1' | 'P2'
type TaskStatus  = 'TODO' | 'DOING' | 'DONE'
type VisibilityObjectType = 'story' | 'task'

// ---------- 基础形状 ----------
type UserBrief = { id: string; account: string; displayName: string }

// 所有 id 为 string；所有 createdAt 为 ISO 8601 UTC 字符串
// 所有 planStart / planEnd 为 'YYYY-MM-DD' 字符串

type Project = {
  id: string; name: string; description: string | null
  ownerUserId: string; createdAt: string
}
type ProjectView = Project & { myRole: ProjectRole }

type ProjectMemberView = {
  userId: string; role: ProjectRole; joinedAt: string; user: UserBrief
}

type BusinessGoal = {
  id: string; projectId: string; name: string; description: string | null
  status: GoalStatus; sortOrder: number
}
type UserActivity = {
  id: string; projectId: string; goalId: string; name: string
  description: string | null; status: GoalStatus; sortOrder: number
}
type UserStory = {
  id: string; projectId: string; activityId: string; title: string
  roleText: string; capabilityText: string; valueText: string
  businessValue: string; priority: Priority; status: StoryStatus
  acceptanceCriteria: string | null; isSensitive: boolean; createdAt: string
}
type Task = {
  id: string; projectId: string; storyId: string; title: string
  description: string | null
  ownerUserId: string; acceptorUserId: string
  planStart: string; planEnd: string
  status: TaskStatus; isSensitive: boolean; createdAt: string
}
type TaskView = Task & { owner: UserBrief; acceptor: UserBrief }

// 层级树节点（GET /projects/:id/goals 的响应元素）
type StoryNode = UserStory
type ActivityNode = UserActivity & { stories: StoryNode[] }
type GoalNode = BusinessGoal & { activities: ActivityNode[] }

// 敏感可见性（PUT .../sensitivity 的请求与响应）
type SensitivityInput = { isSensitive: boolean; visibleMemberIds: string[] }
type SensitivityView  = { objectType: VisibilityObjectType; objectId: string
                          isSensitive: boolean; visibleMemberIds: string[] }
```

**上述内容即 `src/shared/types.ts` 的内容**，前后端共同引用（同一份类型定义，不各自声明）。

### 决策 I-2b：Zod 校验器与字段错误码的桥接

决策 I-4 的字段级错误码由这一层产生。以下为 `src/shared/validation.ts` 的内容。

```ts
import { z } from 'zod'

export const projectRoleSchema = z.enum(['PM', 'MEMBER', 'VIEWER'])
export const goalStatusSchema  = z.enum(['ACTIVE', 'DONE'])
export const storyStatusSchema = z.enum(['DRAFT', 'PLANNING', 'DONE'])
export const prioritySchema    = z.enum(['P0', 'P1', 'P2'])
export const taskStatusSchema  = z.enum(['TODO', 'DOING', 'DONE'])
export const dateSchema        = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

// Zod issue → 决策 I-4 的字段级错误码
export function toFieldErrors(issues: z.ZodIssue[]): FieldError[] {
  return issues.map(issue => ({
    field: issue.path.join('.'),
    code:
      issue.code === 'invalid_type'       ? 'REQUIRED'
    : issue.code === 'too_small'          ? 'REQUIRED'
    : issue.code === 'too_big'            ? 'TOO_LONG'
    : issue.code === 'invalid_enum_value' ? 'INVALID_VALUE'
    : issue.code === 'invalid_string'     ? 'INVALID_FORMAT'
    :                                       'INVALID_VALUE',
  }))
}
```

**职责边界（关键）**

| 校验类型 | 由谁负责 | 产出的错误码 |
|---|---|---|
| **单字段形状**（必填、长度、格式、枚举取值） | Zod schema | `REQUIRED` / `TOO_LONG` / `INVALID_FORMAT` / `INVALID_VALUE` |
| **业务规则**（跳字段比较、需查库） | 处理器主动抛出 `AppError` | `ACCEPTOR_EQUALS_OWNER` / `END_BEFORE_START` / `NOT_PROJECT_MEMBER` / `INSUFFICIENT_MEMBERS` / `HAS_CHILDREN` / `DUPLICATE` / `LAST_PM` / `SELF_REMOVAL_FORBIDDEN` / `USER_NOT_FOUND` / `CROSS_PROJECT_REF` |

业务规则不塞进 Zod 的原因：它们需要跳字段比较（`planEnd >= planStart`、`acceptor !== owner`）或需要查库（「是不是本项目成员」）。塞进 Zod 会让 schema 依赖数据库，破坏测试的独立性。

**`src/shared/errors.ts`（冻结）**

```ts
export class AppError extends Error {
  constructor(
    public status: 403 | 404 | 409 | 422,
    public code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_FAILED',
    message: string,
    public details?: FieldError[]
  ) { super(message) }
}
```

Fastify 的统一错误处理器把它转成决策 I-3 的 `ErrorResponse`；未抛 `AppError` 的异常一律转 `500`，且响应体不包含堆栈。

**唯一错误出口**：所有端点不得自行拼装 `ErrorResponse`，一律通过抛 `AppError` 或由 Zod 校验失败自动转换。这是保证「同种失败返回同种结构」的机制。

### 决策 I-3：统一响应信封

**成功**：HTTP 2xx，响应体即资源本身或列表包装，不额外套壳。

```ts
// 单个资源
type ItemResponse<T> = T
// 列表
type ListResponse<T> = { items: T[] }
// 删除成功
// HTTP 204，无响应体
```

**失败**：HTTP 4xx，响应体固定为

```ts
type ErrorResponse = {
  error: {
    code: ErrorCode                 // 见决策 I-4
    message: string                 // 面向人的提示，可直接展示
    details?: Array<{ field: string; code: FieldErrorCode }>
  }
}
```

**关键约束**：当对象对调用者不可见时，`ErrorResponse` **不得包含该对象的任何字段**（标题、描述、名称等）。`message` 使用与「对象不存在」完全一致的文案，不得出现「无权限」「敏感」等字样。

### 决策 I-4：错误码表

**顶层错误码**

| code | HTTP | 含义 | 使用场景 |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | 未登录或凭证失效 | 缺少或无效的 Authorization 头 |
| `FORBIDDEN` | 403 | 对象可见，但该操作不允许 | 项目成员尝试写入 |
| `NOT_FOUND` | 404 | 对象不存在，或对调用者不可见 | 非项目成员访问、敏感对象未授权、id 不存在 |
| `VALIDATION_FAILED` | 422 | 字段校验失败 | 必填缺失、格式非法、业务规则不满足 |
| `CONFLICT` | 409 | 状态冲突 | 重复添加成员、删除仍有子项的对象 |

**字段级错误码**（位于 `details[].code`）

| code | 含义 | 典型字段 |
|---|---|---|
| `REQUIRED` | 必填缺失或纯空白 | name, title, roleText |
| `TOO_LONG` | 超出长度上限 | name（50） |
| `INVALID_FORMAT` | 格式非法 | planStart, planEnd |
| `INVALID_VALUE` | 枚举取值非法 | role, status, priority |
| `DUPLICATE` | 唯一性冲突 | account（成员重复） |
| `USER_NOT_FOUND` | 账号对应的用户不存在 | account |
| `NOT_PROJECT_MEMBER` | 目标用户/被指定人不是本项目成员 | ownerUserId, acceptorUserId, visibleMemberIds |
| `ACCEPTOR_EQUALS_OWNER` | 验收人与负责人为同一人 | acceptorUserId |
| `END_BEFORE_START` | 计划结束早于计划开始 | planEnd |
| `INSUFFICIENT_MEMBERS` | 项目成员不足 2 人，无法满足验收独立性 | — |
| `SELF_REMOVAL_FORBIDDEN` | 不能移除自己 | userId |
| `LAST_PM` | 不能移除或降级最后一个项目经理 | userId, role |
| `CROSS_PROJECT_REF` | 引用了其他项目的对象 | goalId, activityId, storyId |
| `HAS_CHILDREN` | 仍有下级对象，禁止删除 | — |

### 决策 I-5：唯一鉴权入口 `can()`

权限判定集中在单一函数中。业务代码**禁止**写 `if (role === 'PM')` 之类的判断。

```ts
type Action =
  | 'project.read'            // 读取项目及其下需求与任务
  | 'project.manage_members'  // 增删成员、改角色
  | 'requirement.write'       // 业务目标 / 用户活动 / 用户故事的增删改
  | 'task.write'              // 任务的增删改
  | 'sensitivity.manage'      // 设置敏感标记与可见成员

// 调用方只传 id，不传任何权限相关字段
type ObjectRef =
  | { kind: 'project';  projectId: string }
  | { kind: 'goal';     projectId: string; objectId: string }
  | { kind: 'activity'; projectId: string; objectId: string }
  | { kind: 'story';    projectId: string; objectId: string }
  | { kind: 'task';     projectId: string; objectId: string }

type Decision =
  | { allow: true }
  | { allow: false; status: 403 | 404; code: 'FORBIDDEN' | 'NOT_FOUND' }

can(actorUserId: string, action: Action, ref: ObjectRef): Promise<Decision>
```

**四条接口约束**

1. `can()` **必须自己按 `ref` 中的 id 加载目标对象**。调用方无法通过传入 `isSensitive`、`visibleMemberIds` 等字段影响判定结果。
2. `can()` **返回 `status` 与 `code`**，调用方直接使用，不自行判断 403 还是 404。这消除了同一越权行为在不同端点产生不同状态码的可能。
3. 判定顺序短路：非项目成员 → 拒绝（404）；调用者为 `PM` → 允许；目标敏感且调用者不在可见名单 → 拒绝（404）；写类动作且调用者为 `MEMBER` 或 `VIEWER` → 拒绝（403）；否则允许。
4. `can()` 只读数据库，不调用其他模块的 service（见决策 I-9）。

### 决策 I-6：列表可见性作用域 `visibilityScope()`

列表查询**必须在查询层过滤**，禁止「取出全量再在内存中过滤」。内存过滤会在统计计数上泄漏敏感对象的存在性。

```ts
type Scope =
  | { mode: 'all' }                       // 调用者为 PM，无需过滤
  | { mode: 'subset'; ids: string[] }     // 仅这些对象 id 可见

visibilityScope(
  actorUserId: string,
  projectId: string,
  objectType: VisibilityObjectType
): Promise<Scope>
```

**使用约定**

- `mode === 'all'` → 查询不加可见性条件
- `mode === 'subset'` → 查询追加 `id IN (:ids)`；若 `ids` 为空则该列表返回空集合
- 所有返回敏感对象集合的端点**必须**调用此函数，包括：层级树、任务列表、统计计数、按负责人过滤的任务列表

### 决策 I-7：数据模型

字段类型见决策 I-2。表与外键删除规则如下。

| 表 | 主键 | 外键与删除规则 |
|---|---|---|
| `User` | `id` | — |
| `Project` | `id` | — |
| `ProjectMember` | `(projectId, userId)` | `projectId → Project` CASCADE |
| `BusinessGoal` | `id` | `projectId → Project` RESTRICT |
| `UserActivity` | `id` | `goalId → BusinessGoal` **RESTRICT** |
| `UserStory` | `id` | `activityId → UserActivity` **RESTRICT** |
| `Task` | `id` | `storyId → UserStory` **RESTRICT** |
| `ObjectVisibility` | `(objectType, objectId, userId)` | `userId → User` CASCADE |
| `AuditLog` | `id` | `projectId → Project` CASCADE |

**`RESTRICT` 的作用**：把「有子项时禁止删除」这条业务规则下沉到数据库层，是最可靠的实现，且不依赖任何模块的代码正确性。

**`ObjectVisibility` 的特殊约定**：`objectId` 是多态列（指向 `UserStory` 或 `Task`），**无法建立真实外键**。因此删除用户故事或任务时，必须由该模块在同一事务内手动清理对应的可见性记录。这是唯一需要人工保证的引用完整性，必须在测试中覆盖。

### `src/db/schema.prisma`（冻结，与上表一一对应）

枚举列均为 `String`（见决策 I-0 的第一条约束）。取值合法性由 `src/shared/validation.ts` 的 Zod 枚举保证。

```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")   // "file:./dev.db"
}

generator client { provider = "prisma-client-js" }

model User {
  id           String   @id @default(uuid())
  account      String   @unique
  displayName  String
  passwordHash String
  createdAt    DateTime @default(now())

  memberships   ProjectMember[]
  ownedProjects Project[]        @relation("ProjectOwner")
  ownedTasks    Task[]           @relation("TaskOwner")
  acceptedTasks Task[]           @relation("TaskAcceptor")
  visibility    ObjectVisibility[]
}

model Project {
  id          String   @id @default(uuid())
  name        String
  description String?
  ownerUserId String
  createdAt   DateTime @default(now())

  owner      User            @relation("ProjectOwner", fields: [ownerUserId], references: [id])
  members    ProjectMember[]
  goals      BusinessGoal[]
  stories    UserStory[]
  tasks      Task[]
  visibility ObjectVisibility[]
  auditLogs  AuditLog[]
}

model ProjectMember {
  projectId String
  userId    String
  role      String   // ProjectRole
  joinedAt  DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId],    references: [id], onDelete: Cascade)

  @@id([projectId, userId])
}

model BusinessGoal {
  id          String  @id @default(uuid())
  projectId   String
  name        String
  description String?
  status      String  @default("ACTIVE")  // GoalStatus
  sortOrder   Int

  project    Project        @relation(fields: [projectId], references: [id], onDelete: Restrict)
  activities UserActivity[]
}

model UserActivity {
  id          String  @id @default(uuid())
  projectId   String
  goalId      String
  name        String
  description String?
  status      String  @default("ACTIVE")  // GoalStatus
  sortOrder   Int

  goal    BusinessGoal @relation(fields: [goalId], references: [id], onDelete: Restrict)
  stories UserStory[]
}

model UserStory {
  id                 String   @id @default(uuid())
  projectId          String
  activityId         String
  title              String
  roleText           String
  capabilityText     String
  valueText          String
  businessValue      String
  priority           String   // Priority
  status             String   @default("DRAFT")  // StoryStatus
  acceptanceCriteria String?
  isSensitive        Boolean  @default(false)
  createdAt          DateTime @default(now())

  project  Project      @relation(fields: [projectId],  references: [id], onDelete: Restrict)
  activity UserActivity @relation(fields: [activityId], references: [id], onDelete: Restrict)
  tasks    Task[]
}

model Task {
  id             String   @id @default(uuid())
  projectId      String
  storyId        String
  title          String
  description    String?
  ownerUserId    String
  acceptorUserId String
  planStart      String   // 'YYYY-MM-DD'
  planEnd        String   // 'YYYY-MM-DD'
  status         String   @default("TODO")  // TaskStatus
  isSensitive    Boolean  @default(false)
  createdAt      DateTime @default(now())

  project  Project   @relation(fields: [projectId],      references: [id], onDelete: Restrict)
  story    UserStory @relation(fields: [storyId],        references: [id], onDelete: Restrict)
  owner    User      @relation("TaskOwner",    fields: [ownerUserId],    references: [id], onDelete: Restrict)
  acceptor User      @relation("TaskAcceptor", fields: [acceptorUserId], references: [id], onDelete: Restrict)
}

model ObjectVisibility {
  projectId  String
  objectType String  // VisibilityObjectType: 'story' | 'task'
  objectId   String  // 多态列，无外键（见上方特殊约定）
  userId     String

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId],    references: [id], onDelete: Cascade)

  @@id([objectType, objectId, userId])
  @@index([objectType, objectId])
  @@index([projectId, objectType])
}

model AuditLog {
  id          String   @id @default(uuid())
  projectId   String
  actorUserId String
  action      String
  objectType  String
  objectId    String
  before      String?
  after       String?
  createdAt   DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}
```

**七条数据层约定**

1. 所有主键为 `uuid()` 字符串（决策 I-2 的 id 类型）。
2. 枚举列为 `String`，**取值不靠数据库约束**，只能靠 Zod 写入前校验。绕过校验直接写库就会产生非法值。
3. `planStart` / `planEnd` 为 `String` 而非 `DateTime`，与接口契约的 `'YYYY-MM-DD'` 完全一致，序列化层不需转换。
4. `createdAt` 为 `DateTime`，**序列化层必须转为 ISO 8601 UTC 字符串**后才能出现在响应中。
5. 删除保护全部用 `onDelete: Restrict`（`ProjectMember` 除外，用 `Cascade`）。
6. `ObjectVisibility` 用复合主键 `(objectType, objectId, userId)`，三个索引覆盖两种查询方向。
7. `before` / `after` 存 JSON 字符串，读取时解析；避免为审计单独建一套类型。

### 决策 I-8：端点契约

端点索引（按模块分组）。每条契约的完整定义见下方分节。

| # | 方法与路径 | 权限动作 | 所属任务 |
|---|---|---|---|
| 1 | `POST /auth/login` | 无需 | T0.3 |
| 2 | `GET /auth/me` | 已登录 | T0.3 |
| 3 | `POST /projects` | 已登录 | T1.1 |
| 4 | `GET /projects` | 已登录 | T1.2 |
| 5 | `GET /projects/:projectId` | `project.read` | T1.2 |
| 6 | `POST /projects/:projectId/members` | `project.manage_members` | T1.3 |
| 7 | `GET /projects/:projectId/members` | `project.read` | T1.4 |
| 8 | `PATCH /projects/:projectId/members/:userId` | `project.manage_members` | T1.5 |
| 9 | `DELETE /projects/:projectId/members/:userId` | `project.manage_members` | T1.6 |
| 10 | `GET /projects/:projectId/goals` | `project.read` | T3.8, T3.10 |
| 11 | `POST /projects/:projectId/goals` | `requirement.write` | T3.1 |
| 12 | `PATCH /goals/:goalId` | `requirement.write` | T3.2 |
| 13 | `DELETE /goals/:goalId` | `requirement.write` | T3.9 |
| 14 | `PUT /projects/:projectId/goals/order` | `requirement.write` | T3.3 |
| 15 | `POST /goals/:goalId/activities` | `requirement.write` | T3.4 |
| 16 | `PATCH /activities/:activityId` | `requirement.write` | T3.5 |
| 17 | `DELETE /activities/:activityId` | `requirement.write` | T3.9 |
| 18 | `PUT /goals/:goalId/activities/order` | `requirement.write` | T3.5 |
| 19 | `POST /activities/:activityId/stories` | `requirement.write` | T3.6 |
| 20 | `GET /stories/:storyId` | `project.read` | T3.7 |
| 21 | `PATCH /stories/:storyId` | `requirement.write` | T3.7 |
| 22 | `DELETE /stories/:storyId` | `requirement.write` | T3.9 |
| 23 | `PUT /stories/:storyId/sensitivity` | `sensitivity.manage` | T2.3, T2.4 |
| 24 | `GET /stories/:storyId/tasks` | `project.read` | T5.5, T5.8 |
| 25 | `POST /stories/:storyId/tasks` | `task.write` | T5.1–T5.4 |
| 26 | `GET /projects/:projectId/tasks` | `project.read` | T5.9 |
| 27 | `GET /tasks/:taskId` | `project.read` | T5.5 |
| 28 | `PATCH /tasks/:taskId` | `task.write` | T5.6, T5.3 |
| 29 | `DELETE /tasks/:taskId` | `task.write` | T5.7 |
| 30 | `PUT /tasks/:taskId/sensitivity` | `sensitivity.manage` | T5.8 |

**认证约定**：除 `POST /auth/login` 外，所有端点需要请求头 `Authorization: Bearer <token>`。凭证为不透明随机串，存库校验，不使用 JWT（避免密钥管理）。

---

#### M1 身份与会话（T0.3）

**1. `POST /auth/login`** — 权限：无需

```text
请求  { account: string, password: string }
响应  200 { token: string, user: UserBrief }
错误  422 VALIDATION_FAILED（account/password: REQUIRED）
      401 UNAUTHENTICATED（账号或密码错误，不区分是哪一个）
```

**2. `GET /auth/me`** — 权限：已登录

```text
请求  —
响应  200 UserBrief
错误  401 UNAUTHENTICATED
```

---

#### M2 项目与成员（T1.1–T1.7）

**3. `POST /projects`** — 权限：已登录

```text
请求  { name: string, description?: string }
响应  201 Project
错误  422 VALIDATION_FAILED（name: REQUIRED | TOO_LONG）
副作用 同一事务内写入 ProjectMember(projectId, 当前用户, 'PM')
```

**4. `GET /projects`** — 权限：已登录

```text
请求  —
响应  200 ListResponse<ProjectView>
说明  只返回当前用户参与的项目；myRole 为该项目中的角色
```

**5. `GET /projects/:projectId`** — 权限：`project.read`

```text
请求  —
响应  200 ProjectView
错误  401 UNAUTHENTICATED
      404 NOT_FOUND（非项目成员、或项目不存在，两者响应完全一致）
```

**6. `POST /projects/:projectId/members`** — 权限：`project.manage_members`

```text
请求  { account: string, role: ProjectRole }
响应  201 ProjectMemberView
错误  403 FORBIDDEN（调用者为 MEMBER / VIEWER）
      422 VALIDATION_FAILED（account: REQUIRED | USER_NOT_FOUND
                             role: REQUIRED | INVALID_VALUE）
      409 CONFLICT（account: DUPLICATE，该用户已是项目成员）
约束  不得通过此端点把成员角色设为 PM 而绕过 LAST_PM 检查（见端点 8）
```

**7. `GET /projects/:projectId/members`** — 权限：`project.read`

```text
请求  —
响应  200 ListResponse<ProjectMemberView>
错误  404 NOT_FOUND（非项目成员）
说明  按 joinedAt 升序
```

**8. `PATCH /projects/:projectId/members/:userId`** — 权限：`project.manage_members`

```text
请求  { role: ProjectRole }
响应  200 ProjectMemberView
错误  403 FORBIDDEN
      404 NOT_FOUND（userId 不是本项目成员）
      422 VALIDATION_FAILED（role: INVALID_VALUE
                             userId: LAST_PM，不能把最后一个 PM 降级）
```

**9. `DELETE /projects/:projectId/members/:userId`** — 权限：`project.manage_members`

```text
请求  —
响应  204
错误  403 FORBIDDEN
      404 NOT_FOUND（userId 不是本项目成员）
      422 VALIDATION_FAILED（userId: SELF_REMOVAL_FORBIDDEN
                             userId: LAST_PM）
副作用 该用户立即失去本项目全部访问权（无需重新登录，见决策 I-10）
```

---

#### M3 授权与敏感可见（T2.1–T2.7）

**10. `GET /projects/:projectId/goals`** — 权限：`project.read`

```text
请求  —
响应  200 ListResponse<GoalNode>
说明  返回完整层级树；goals 按 sortOrder 升序，activities 按 sortOrder 升序，
      stories 按 createdAt 升序
      敏感用户故事按 visibilityScope(actor, projectId, 'story') 过滤；
      被过滤掉的 story 不出现在 stories 数组中，其父级 activity 与 goal 仍正常返回
错误  404 NOT_FOUND（非项目成员）
```

**23. `PUT /stories/:storyId/sensitivity`** — 权限：`sensitivity.manage`

```text
请求  SensitivityInput
响应  200 SensitivityView
错误  403 FORBIDDEN（调用者不是 PM）
      404 NOT_FOUND（故事不存在或不可见）
      422 VALIDATION_FAILED（visibleMemberIds: NOT_PROJECT_MEMBER）
语义  该端点为全量覆盖：请求中的 visibleMemberIds 替换原有名单，不追加
      isSensitive 为 false 时忽略 visibleMemberIds（保留其值以备重新开启）
副作用 写入 AuditLog（action='sensitivity.update'，before/after 为 SensitivityView）
      变更立即生效，无需被授权人重新登录
```

---

#### M4 需求层级（T3.1–T3.10）

**11. `POST /projects/:projectId/goals`** — 权限：`requirement.write`

```text
请求  { name: string, description?: string }
响应  201 BusinessGoal
错误  403 FORBIDDEN（MEMBER / VIEWER）
      404 NOT_FOUND（非项目成员）
      422 VALIDATION_FAILED（name: REQUIRED | TOO_LONG）
副作用 status 默认 'ACTIVE'；sortOrder = 当前项目内最大值 + 1
```

**12. `PATCH /goals/:goalId`** — 权限：`requirement.write`

```text
请求  { name?: string, description?: string, status?: GoalStatus }
响应  200 BusinessGoal
错误  403 FORBIDDEN
      404 NOT_FOUND
      422 VALIDATION_FAILED（name: REQUIRED | TOO_LONG
                             status: INVALID_VALUE）
说明  部分更新：请求体中未出现的字段保持不变
```

**13. `DELETE /goals/:goalId`** — 权限：`requirement.write`

```text
请求  —
响应  204
错误  403 FORBIDDEN
      404 NOT_FOUND
      409 CONFLICT（HAS_CHILDREN，该目标下仍有用户活动）
说明  由外键 RESTRICT 保证，不依赖应用层判断
```

**14. `PUT /projects/:projectId/goals/order`** — 权限：`requirement.write`

```text
请求  { orderedIds: string[] }
响应  200 ListResponse<BusinessGoal>
错误  403 FORBIDDEN
      404 NOT_FOUND
      422 VALIDATION_FAILED（orderedIds: INVALID_VALUE
                             —— 集合与本项目现有目标集合不一致）
语义  全量替换顺序：第 i 个 id 的 sortOrder 置为 i
      幂等，可重复调用
```

**15. `POST /goals/:goalId/activities`** — 权限：`requirement.write`

```text
请求  { name: string, description?: string }
响应  201 UserActivity
错误  403 FORBIDDEN
      404 NOT_FOUND
      422 VALIDATION_FAILED（name: REQUIRED | TOO_LONG）
副作用 projectId 取自 goalId 所属目标（不接受请求体传入，防止 CROSS_PROJECT_REF）
      status 默认 'ACTIVE'；sortOrder = 该目标下最大值 + 1
```

**16. `PATCH /activities/:activityId`** — 权限：`requirement.write`

```text
请求  { name?: string, description?: string, status?: GoalStatus }
响应  200 UserActivity
错误  同端点 12
```

**17. `DELETE /activities/:activityId`** — 权限：`requirement.write`

```text
请求  —
响应  204
错误  409 CONFLICT（HAS_CHILDREN，该活动下仍有用户故事）
```

**18. `PUT /goals/:goalId/activities/order`** — 权限：`requirement.write`

```text
请求  { orderedIds: string[] }
响应  200 ListResponse<UserActivity>
语义  同端点 14，范围限定在该目标下的用户活动
```

**19. `POST /activities/:activityId/stories`** — 权限：`requirement.write`

```text
请求  { title: string
        roleText: string
        capabilityText: string
        valueText: string
        businessValue: string
        priority: Priority
        acceptanceCriteria?: string }
响应  201 UserStory
错误  403 FORBIDDEN
      404 NOT_FOUND
      422 VALIDATION_FAILED（title / roleText / capabilityText / valueText /
                             businessValue: REQUIRED | TOO_LONG
                             priority: REQUIRED | INVALID_VALUE）
副作用 projectId 取自 activityId 所属活动
      status 默认 'DRAFT'；isSensitive 默认 false
```

**20. `GET /stories/:storyId`** — 权限：`project.read`

```text
请求  —
响应  200 UserStory
错误  404 NOT_FOUND（不存在、非项目成员、或敏感且未授权 —— 三者响应一致）
```

**21. `PATCH /stories/:storyId`** — 权限：`requirement.write`

```text
请求  { title?, roleText?, capabilityText?, valueText?, businessValue?,
        priority?, status?, acceptanceCriteria? }
响应  200 UserStory
错误  403 FORBIDDEN / 404 NOT_FOUND / 422 VALIDATION_FAILED
说明  不含 isSensitive —— 该字段只能通过端点 23 修改
```

**22. `DELETE /stories/:storyId`** — 权限：`requirement.write`

```text
请求  —
响应  204
错误  409 CONFLICT（HAS_CHILDREN，该故事下仍有任务）
副作用 同一事务内清理 ObjectVisibility(objectType='story', objectId=storyId)
```

---

#### M5 任务（T5.1–T5.9）

**24. `GET /stories/:storyId/tasks`** — 权限：`project.read`

```text
请求  —
响应  200 ListResponse<TaskView>
说明  按 visibilityScope(actor, projectId, 'task') 过滤
      按 planStart 升序，planStart 相同按 createdAt 升序
错误  404 NOT_FOUND
```

**25. `POST /stories/:storyId/tasks`** — 权限：`task.write`

```text
请求  { title: string
        description?: string
        ownerUserId: string
        acceptorUserId: string
        planStart: string   // 'YYYY-MM-DD'
        planEnd: string     // 'YYYY-MM-DD' }
响应  201 TaskView
错误  403 FORBIDDEN（MEMBER / VIEWER）
      404 NOT_FOUND（故事不存在或不可见）
      422 VALIDATION_FAILED（title: REQUIRED | TOO_LONG
                             ownerUserId / acceptorUserId: REQUIRED | NOT_PROJECT_MEMBER
                             acceptorUserId: ACCEPTOR_EQUALS_OWNER
                             planStart / planEnd: REQUIRED | INVALID_FORMAT
                             planEnd: END_BEFORE_START
                             —— INSUFFICIENT_MEMBERS（项目成员少于 2 人））
副作用 projectId 取自 storyId 所属故事
      status 默认 'TODO'；isSensitive 默认 false
校验顺序 acceptorUserId 为必填、且必须为本项目成员的校验先于
          ACCEPTOR_EQUALS_OWNER 校验（避免对空值比较）
```

**26. `GET /projects/:projectId/tasks`** — 权限：`project.read`

```text
请求  查询参数 ownerUserId?: string
响应  200 ListResponse<TaskView>
说明  按 visibilityScope 过滤；提供 ownerUserId 时按负责人附加过滤
      按 planStart 升序
错误  404 NOT_FOUND（非项目成员）
      422 VALIDATION_FAILED（ownerUserId: NOT_PROJECT_MEMBER）
```

**27. `GET /tasks/:taskId`** — 权限：`project.read`

```text
请求  —
响应  200 TaskView
错误  404 NOT_FOUND
```

**28. `PATCH /tasks/:taskId`** — 权限：`task.write`

```text
请求  { title?, description?, ownerUserId?, acceptorUserId?,
        planStart?, planEnd?, status? }
响应  200 TaskView
错误  403 FORBIDDEN / 404 NOT_FOUND
      422 VALIDATION_FAILED（同端点 25 的全部字段级错误码）
关键约束 ACCEPTOR_EQUALS_OWNER 必须在此端点同样生效：
        ① 只改 ownerUserId 使其等于现有 acceptorUserId → 拒绝
        ② 只改 acceptorUserId 使其等于现有 ownerUserId → 拒绝
        ③ 同时改两者使其相等 → 拒绝
        ④ 使用部分更新语义：校验时以「现有值 + 请求体覆盖」的合并结果为准，
           不得只校验请求体中出现的字段
说明  不含 isSensitive
```

**29. `DELETE /tasks/:taskId`** — 权限：`task.write`

```text
请求  —
响应  204
错误  403 FORBIDDEN / 404 NOT_FOUND
副作用 同一事务内清理 ObjectVisibility(objectType='task', objectId=taskId)
```

**30. `PUT /tasks/:taskId/sensitivity`** — 权限：`sensitivity.manage`

```text
请求  SensitivityInput
响应  200 SensitivityView
错误  403 FORBIDDEN（调用者不是 PM）/ 404 NOT_FOUND
      422 VALIDATION_FAILED（visibleMemberIds: NOT_PROJECT_MEMBER）
语义与副作用 同端点 23
```

---

### 决策 I-9：模块依赖方向（防止循环依赖）

四人并行开发时，最危险的动作是**互相调用对方的 service 函数**。一旦 M4 调用 M3 的 service、M3 又调用 M4 的，主干立刻无法编译，且两人都被阻塞。

**依赖规则**

```text
数据访问层（表与查询）  ←── 所有模块都可以直接使用
共享类型定义            ←── 所有模块都可以直接引用

M1 身份 ──→ 提供 Actor 注入
M3 鉴权 ──→ 直接读 ProjectMember 表，不调用 M2 的 service
M2 / M4 / M5 ──→ 通过 can() / visibilityScope() 使用 M3，不复制其逻辑

禁止：M2 ↔ M3 ↔ M4 ↔ M5 之间的 service 互相调用
```

**具体约定**

| 规则 | 说明 |
|---|---|
| M3 直接读 `ProjectMember` 表 | 不调用 M2 的成员服务，否则 M2 与 M3 互相依赖 |
| M5 需要用户信息时直接读 `User` 表 | 不调用 M2 的成员服务 |
| M4 需要校验 `projectId` 时读 `Project` 表 | 不调用 M2 的 service |
| 每个模块只导出自己的 HTTP 路由处理函数 | 模块之间不导出可被调用的 service 函数 |

**共享文件冻结清单**（改动需先通知全员）

| 冻结对象 | 内容 | 唯一修改人 |
|---|---|---|
| 数据模型定义 | 决策 I-7 的 9 张表 | 技术负责人 |
| 路由注册表 | 决策 I-8 的 30 个端点 | 技术负责人 |
| `can()` / `visibilityScope()` 签名 | 决策 I-5、I-6 | 权限模块负责人 |
| 共享类型与枚举 | 决策 I-1、I-2 | 技术负责人 |

### 决策 I-10：语义约束（不体现在签名中的约定）

| 约定 | 内容 |
|---|---|
| 权限即时生效 | 权限与可见范围判定每次请求都从数据库读取，不做进程内缓存；因此变更无需被授权人重新登录 |
| 部分更新语义 | 所有 `PATCH` 为部分更新；未出现的字段保持原值；校验以合并后的结果为准 |
| 敏感字段写入路径 | `isSensitive` 与 `visibleMemberIds` 只能通过 `PUT .../sensitivity` 修改，不出现在任何 `PATCH` 请求体中 |
| `projectId` 的推导 | 子对象的 `projectId` 一律从父对象推导，不接受请求体传入；这从结构上消除了 `CROSS_PROJECT_REF` |
| 列表不分页 | Sprint 1 数据量小，所有列表返回全量，不实现分页参数。这是一个**有意为之的简化**，若 Sprint 2 数据量增长需重新评估 |
| 排序方式 | 目标与活动使用整数 `sortOrder` 全量替换；用户故事与任务使用固定字段排序（`createdAt` / `planStart`），不提供手工排序 |
| 时间字段 | `planStart` / `planEnd` 只接受 `YYYY-MM-DD`；`createdAt` 由服务端生成 ISO 8601 UTC 字符串，客户端不可传入 |

### 决策 I-11：任务编号与端点的对应关系

供每人核对交付范围，避免两人实现同一端点或漏实现。

| 任务 | 交付的端点或能力 |
|---|---|
| T0.1 | 项目骨架与本地启动 |
| T0.2 | 决策 I-7 的 9 张表 |
| T0.3 | 端点 1、2；`requireAuth` 中间件 |
| T0.4 | `can()` 骨架（`Action` / `ObjectRef` / `Decision`） |
| T0.5 | 测试运行器与数据工厂 |
| T1.1 | 端点 3 |
| T1.2 | 端点 4、5 |
| T1.3 | 端点 6 |
| T1.4 | 端点 7 |
| T1.5 | 端点 8 |
| T1.6 | 端点 9 |
| T1.7 | 端点 3–9 的 `can()` 接入（非项目成员一律 404） |
| T2.1 | `Action` 与角色矩阵的完整实现 |
| T2.2 | 端点 11–22、25、28、29 的 `FORBIDDEN` 分支 |
| T2.3 | 端点 23、30 的 `isSensitive` 部分；敏感开关界面 |
| T2.4 | 端点 23、30 的 `visibleMemberIds` 部分；可见成员选择界面 |
| T2.5 | `visibilityScope()` 实现；端点 10、24、26 的过滤接入 |
| T2.6 | 端点 20、23、24、27、30 的 `NOT_FOUND` 统一行为 |
| T2.7 | 去掉进程内缓存，确认变更即时生效 |
| T2.8 | `AuditLog` 写入（端点 8、9、23、30） |
| T3.1 | 端点 11 |
| T3.2 | 端点 12 |
| T3.3 | 端点 14 |
| T3.4 | 端点 15 |
| T3.5 | 端点 16、18 |
| T3.6 | 端点 19 |
| T3.7 | 端点 20、21 |
| T3.8 | 端点 10（层级树组装） |
| T3.9 | 端点 13、17、22 的 `HAS_CHILDREN`；`CROSS_PROJECT_REF` 结构性消除 |
| T3.10 | 端点 10 的 `visibilityScope` 接入 |
| T5.1 | 端点 25 的基础部分 |
| T5.2 | 端点 25、28 的 `REQUIRED` / `NOT_PROJECT_MEMBER` 校验 |
| T5.3 | 端点 25、28 的 `ACCEPTOR_EQUALS_OWNER` 校验（含部分更新合并语义） |
| T5.4 | 端点 25、28 的时间校验 |
| T5.5 | 端点 24、27；任务列表与详情界面 |
| T5.6 | 端点 28 的状态字段部分 |
| T5.7 | 端点 22 的 `HAS_CHILDREN`、端点 29 |
| T5.8 | 端点 24、30 的可见性接入 |
| T5.9 | 端点 26 |

## Testing Decisions

### 什么算好的测试

- **只测外部行为**：通过 HTTP 接口发起请求、断言状态码与响应体。不断言内部函数被调用了几次、不 mock 内部模块。
- **断言契约而非实现**：断言错误码（`ACCEPTOR_EQUALS_OWNER`）而不是错误文案；断言字段名与类型，因为那就是其他模块依赖的东西。
- **每个端点至少一正一反**：正例证明主路径可用，反例证明约束真的生效。只测正例的接口测试在评审时无法作为证据。
- **测试自建数据**：每个测试用工厂函数创建自己的项目、成员、需求、任务。不依赖全局种子数据，避免测试顺序耦合。
- **越权用例必须打接口**：不能用「前端不渲染按钮」代替。必须绕过界面直接请求，断言状态码。

### 唯一 seam

**HTTP 接口层**是本次唯一的测试 seam。不为每个模块建立独立测试层，不为内部函数单独建 seam。

理由：四人并行时，接口层是唯一稳定的公共边界。在接口层测试，无论内部实现如何变化，测试都不会失效；同时接口测试天然覆盖跨模块拼装（M5 的测试要用 M2 建的项目和 M4 建的 story），因此它同时充当集成测试。

**允许的唯一例外**：`can()` 的规则表可以有一层薄单测，穷举「角色 × 动作 × 敏感状态」的组合矩阵，用于快速定位鉴权回归。但**同样的场景必须同时被接口测试覆盖** —— 单测只是快速反馈，接口测试才是验收证据。

### 测试数据工厂

由 T0.5 提供，所有测试共用：

```text
makeUser(account, displayName)                  → UserBrief
makeProject(ownerUserId, name)                  → { projectId, ownerUserId }
makeMember(projectId, userId, role)             → void
makeGoal(projectId, name)                       → goalId
makeActivity(goalId, name)                      → activityId
makeStory(activityId, overrides?)               → storyId
makeTask(storyId, ownerUserId, acceptorUserId)  → taskId
makeSensitive(objectType, objectId, userIds)    → void
```

`makeTask` 必须在内部满足「验收人 ≠ 负责人」约束，否则所有下游测试都要重复处理这个前置条件。

### 测试基础设施（Vitest + supertest）

```text
test/factories.ts     ← T0.5 提供的数据工厂（全员只读）
test/helpers.ts       ← T0.5 提供的 app 实例与登录辅助
src/modules/*/         ← 每个模块自己的 *.test.ts，与实现同目录
```

**启动约定**

- 每个测试文件在 `beforeAll` 启动一个**独立的 app 实例**，使用临时 SQLite 文件（不用 :memory:，因为多连接不共享）
- `beforeEach` 清空全部表（按外键逆序删除，或重建 schema）
- 每个测试自己调 `makeXxx` 造数据，不依赖全局种子
- 越权用例统一用一个 `asUser(token).get/post(...)` 辅助函数发出请求

**为什么用临时文件而不是 :memory:**：SQLite 的内存库是**每连接一个**，Prisma 连接池会产生多个连接，导致建表在一个连接、查询在另一个连接，表现为「表不存在」的偶发失败。这是本栈最容易浪费 10 分钟调试点，T0.5 直接拿掉。

### 需要覆盖的测试清单

| 测试组 | 覆盖内容 | 对应任务 |
|---|---|---|
| 会话 | 登录成功 / 密码错误 / 无 token 访问受保护端点 | T0.3 |
| 项目隔离 | 非成员访问项目、需求、任务的列表与详情，全部返回 404 且响应体无对象字段 | T1.7, T2.6 |
| 角色矩阵 | 3 种角色 × 5 种 `Action` 的全组合，断言 403 / 404 / 通过 | T2.2 |
| 成员约束 | 重复添加、移除自己、降级最后一个 PM | T1.3, T1.5, T1.6 |
| 敏感可见性 | 未授权成员在「列表 / 详情 / 计数 / 按负责人过滤的任务列表」四处均不可见 | T2.5, T3.10, T5.8 |
| 权限即时生效 | 取消白名单后，同一 token 的下一次请求即被拒绝 | T2.7 |
| 层级约束 | 有子项时删除被拒；`projectId` 由父级推导 | T3.9 |
| 任务约束 | 验收人 = 负责人（创建与编辑两条路径，含「同时改两者」）；成员不足 2 人；结束早于开始 | T5.2–T5.4 |
| 引用完整性 | 删除故事或任务后，`ObjectVisibility` 中的对应记录被清理 | T3.9, T5.7 |
| 主链路 | 建项目 → 加成员 → 建目标/活动/故事 → 拆任务 → 标记敏感 → 越权验证，一条脚本串起来 | 全员 |

### 既有参照

仓库为 greenfield，本 spec 是首份接口契约，暂无既有测试可参照。因此本文档同时充当**首个参照实现**的约定：第一位完成模块的成员，其接口测试结构成为其余成员的模板。

## Out of Scope

**产品范围**

- US-04 故事看板（需求状态可维护，但无看板视图）
- US-06 / US-07 甘特图与成员负载
- US-08 / US-09 个人待办、任务状态流转到阻塞中 / 已暂停 / 已关闭、验收驳回与重验
- US-10 项目健康度与风险视图
- US-11 / US-12 / US-13 AI 能力
- US-14 通知
- US-15 在线 UML
- 任务 FS 前置依赖
- 附件上传与附件级权限

**接口范围（有意为之的简化）**

- **列表不分页**：所有列表端点返回全量，不提供 `page` / `pageSize` 参数
- **无批量操作**：无批量创建、批量改状态、批量删除
- **无乐观锁**：不提供 `version` / `updatedAt` 并发控制字段，后写覆盖先写
- **无软删除**：删除即物理删除（受外键 RESTRICT 保护）
- **无字段级脱敏**：敏感对象只有「整体可见 / 整体不可见」两态，不实现部分字段隐藏
- **无 AI 上下文脱敏**：AI 能力本身不在本轮范围
- **无 WebSocket / 服务端推送**：全部为请求-响应式
- **无国际化**：错误文案为中文硬编码，不做多语言

**权限范围**

- 字段级权限
- 管理者（`VIEWER`）的多级授权范围（本轮为全项目只读）
- 项目成员的「可编辑本人负责的任务」（属 US-08）

## Further Notes

### 契约变更流程

契约冻结后，任何修改按以下四步执行：

1. **提出**：在团队频道说明「要改哪个端点/类型、为什么、影响谁」
2. **确认**：受影响模块的负责人明确回复同意（无回应视为未确认）
3. **单人修改**：由该契约的唯一修改人执行（见决策 I-9 的冻结清单），禁止多人同时改
4. **通知**：修改完成后通知全员，并在表 3 遗留问题中留一条记录

**变更成本提示**：Sprint 1 期间修改契约的代价远高于修改实现。若发现契约有问题，优先按契约实现并在表 7 回顾中提出，留到 Sprint 2 调整。

### 常见拼装失败与预防

| 失败现象 | 根因 | 预防 |
|---|---|---|
| 页面字段空白 | 两人对同一字段用了不同命名 | 决策 I-2 的共享类型是唯一命名来源 |
| 同种越权返回不同状态码 | 调用方各自判断 403/404 | `can()` 直接返回状态码（决策 I-5） |
| 敏感对象在某个视图泄漏 | 某处用内存过滤替代查询层过滤 | 所有敏感集合必须调用 `visibilityScope()`（决策 I-6） |
| 主干无法编译 | 模块间互相调用 service | 只共享数据访问层与类型（决策 I-9） |
| id 类型不匹配 | 有人用自增整数 | 所有 id 为 string（决策 I-2） |
| 日期解析在各模块行为不一致 | 有人用 Date 对象、有人用时间戳 | 统一 `YYYY-MM-DD` 字符串（决策 I-10） |
| 任务编辑时绕过「验收人 ≠ 负责人」 | 只校验请求体中出现的字段 | 部分更新按合并结果校验（端点 28） |
| 删除后残留可见性记录 | 多态列无法建外键 | 删除故事/任务时同事务清理（决策 I-7） |

### 三个人最容易忽略的接口细节

1. **端点 28 的部分更新合并语义**：`PATCH /tasks/:taskId` 只改 `ownerUserId` 时，校验必须用「现有 `acceptorUserId`」而非请求体中的值。只校验请求体的实现会放行最容易发生的绕过路径。
2. **`ObjectVisibility` 没有外键**：它是多态表，数据库不会帮你清理。这是全文档唯一需要人工保证的引用完整性。
3. **端点 24 与端点 26 都必须过滤**：`GET /stories/:storyId/tasks` 与 `GET /projects/:projectId/tasks` 是两条不同的查询路径，任何一条漏掉 `visibilityScope()` 都会成为敏感任务泄漏的入口。若端点 26（T5.9）被降级砍掉，可暂时移除该端点，但不可保留一个未过滤的版本。

### 与配套文档的关系

| 文档 | 回答的问题 | 何时使用 |
|---|---|---|
| 本文档 | 接口长什么样 | 写代码、写测试、拼装时 |
| 《Sprint1基线》§2 | 什么算做完 | 计划会定 AC、评审时判定 |
| 《Sprint1基线》§4 | 谁做什么、怎么领 | 计划会分工、日常领取 |
| 《Sprint1基线》§5–§6 | 风险与决策记录 | 回顾、变更溯源 |

本文档与《Sprint1基线》冲突时，**以本文档的接口定义为准**，并需在 24 小时内回写《Sprint1基线》保持一致。
