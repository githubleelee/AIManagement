# AI 互动原始记录（表 5）

> 本文件对应实验指导书**表 5 AI 互动原始记录表**。
>
> **记录规则**（实验指导书要求：全过程、可追溯，严禁事后补造）：
>
> 1. 每条互动在发生的**当次**由该 AI 智能体自行追加，不由他人批量补写
> 2. 只允许在表格**末尾追加行**，不得修改或删除已有行
> 3. 「人类输入摘要」记录分工框架与约束条件，不复制完整 prompt
> 4. 「AI 输出要点」记录产出物与关键判断，不复制生成的代码
> 5. 「团队处置及理由」必须写明**采纳 / 修改后采纳 / 拒绝**及理由（对应规划方案 8.5 的 AI 建议质量评价口径）
>
> 三个 AI 智能体角色：
>
> | 角色 | 职责 |
> |---|---|
> | 编码智能体 | 在仓库中创建分支、编写代码、生成提交，同时编写配套测试 |
> | 测试智能体 | 补充测试用例、运行全量测试、输出测试报告 |
> | 代码审查智能体 | 评审代码差异，检查编码规范、潜在缺陷、性能隐患 |

| 序号 | 时间 | AI智能体角色 | 任务场景 | 人类输入摘要 | AI输出要点 | 团队处置及理由 |
|---|---|---|---|---|---|---|
| 1 | 2026-09-19 18:00 | 编码智能体 | 生成工程骨架 | 按契约决策 I-0 落目录结构；前端 React+Vite、后端 Node+Fastify；模块目录本次只留空占位，不引入 Prisma | 创建 src/shared、src/db、src/auth、src/modules 四个模块目录与 web/src/pages 占位（.gitkeep）；配置 package.json、tsconfig、tsconfig.build、vitest.config；dev 脚本用 concurrently 同时起前后端 | 采纳：目录与冻结清单逐条对齐，占位目录不预写实现，边界清晰，交后续工单填充 |
| 2 | 2026-09-19 18:01 | 编码智能体 | 逐字落地共享类型与校验器 | 决策 I-2 与 I-2b 必须逐字实现；显式处理 GoalStatus、StoryStatus、TaskStatus 都存在 DONE 的陷阱 | types.ts 定义 5 个枚举与 I-2 全部类型，三个 DONE 状态各自独立类型别名；validation.ts 落 5 个 Zod 枚举、dateSchema、toFieldErrors；errors.ts 落 AppError 类 | 采纳：逐字抄写契约并加注释说明 DONE 陷阱；未自行增删字段，符合契约变更流程 |
| 3 | 2026-09-19 18:02 | 编码智能体 | 编写错误处理器与接口测试 | 抛 AppError 转 ErrorResponse；未知异常 500 且响应体不含堆栈；路由集中注册；至少覆盖三条测试 | error-handler.ts 作为唯一错误出口，routes.ts 集中注册含 /health，app.ts 与 server.ts 装配；supertest 覆盖健康检查、AppError 的 details 字段码、500 无堆栈、404 信封，共 10 例 | 修改后采纳：契约 I-4 未定义 500 顶层码，补充 INTERNAL_ERROR 并注明来源，其余严格按契约 |
| 4 | 2026-09-19 18:03 | 编码智能体 | 运行全量验证并自检 | 给出 typecheck 与 test 的真实输出；README 补安装、启动、测试三条命令且不删改已有章节 | npm run typecheck 通过；npm test 2 个文件 10 例全绿；npm run dev 实测前端 5173 与后端 3000 同时启动、/health 返回 200；README 增「快速开始」段 | 采纳：真实输出留档，dev 与 health 实测通过，未删除已有章节 |
| 5 | 2026-09-19 18:13 | 测试智能体 | 对抗性探针：未知路由、非法 JSON 体与四个 AppError 状态的错误信封 | 以接口契约为权威来源；主动构造边界探针而非复跑既有测试；发现真实缺陷可改生产代码但须逐条记录缺陷与证据 | 实测 403/404/409/422 各自映射正确、未知路由走统一 404 信封、无字段错误时 details 被省略；发现非法 JSON 请求体落入未知异常分支返回 500（Fastify statusCode=400），违反 I-3「失败响应为 4xx」。修复 src/error-handler.ts：对带 4xx statusCode 的客户端错误回 422 VALIDATION_FAILED，并以 clientStatusCode 做类型安全读取 | 修改后采纳：修复严格对齐 I-3/I-4，不透传解析器内部信息，且补了回归测试；属于确凿缺陷而非测试写错 |
| 6 | 2026-09-19 18:13 | 测试智能体 | 对抗性探针：toFieldErrors 映射完整性与 details 存在性 | 穷举 5 种 Zod issue 码的映射；探未列出 issue 码的兜底分支；断言无字段错误时不得输出 [] 或 null | 逐一验证 invalid_type/too_small→REQUIRED、too_big→TOO_LONG、invalid_enum_value→INVALID_VALUE、invalid_string→INVALID_FORMAT；验证 invalid_literal/unrecognized_keys 落 INVALID_VALUE 兜底、数组路径 join 为 items.0、空 issues 返回 []；确认显式空 details 数组也不会输出 | 采纳：映射与 I-2b/I-4 完全一致，未发现缺陷 |
| 7 | 2026-09-19 18:13 | 测试智能体 | 三个 DONE 状态枚举的类型级断言与全量回归 | 要求提供编译期保证并纳入 npm run typecheck；不得为让测试通过而放宽断言 | 新增 test/shared-types.typecheck.ts，用 @ts-expect-error 锁定 GoalStatus/StoryStatus/TaskStatus 互不可赋值（错误消失时 tsc 报 TS2578），并记录收窄到公共字面量 DONE 的残余边界；npm test 2 文件 31 例通过、typecheck（含 web）通过 | 采纳：类型测试不进运行时且由 tsc 兜底；残余边界属结构类型限制，留 Sprint 2 评估是否引入 brand |
| 20 | 2026-09-19 18:20 | 编码智能体(T0-02) | 安装 Prisma 并逐字落地 9 张表的 schema.prisma | 工单称依赖已装好，但 package.json 与 node_modules 均无 prisma；要求按决策 I-7 的 schema 逐字落地，枚举列用 String、planStart/planEnd 用 String、删除保护用 onDelete: Restrict（ProjectMember 用 Cascade），并提供 client 单例 | 补装 prisma 与 @prisma/client 6.19.3（匹配契约 prisma-client-js 生成器的最后稳定大版本）；package.json 增加 prisma.schema 指向 src/db/schema.prisma 及 db:generate/db:migrate/db:migrate:dev/postinstall；逐字落地 9 张表并生成迁移 20260919102113_init，client 单例放 src/db/client.ts | 修改后采纳：契约决策 I-0 要求 Prisma，属交付前置缺失而非契约变更；锁定 6.x 以兼容 prisma-client-js，未改任何字段与删除规则 |
| 21 | 2026-09-19 18:22 | 编码智能体(T0-02) | 验证外键 RESTRICT 在 SQLite 上真实生效 | SQLite 外键需 PRAGMA foreign_keys=ON，否则 onDelete: Restrict 静默失效；不能只依赖配置声明，必须有一条测试断言删除真的被拒绝 | 新增 test/db-schema.test.ts 共 8 例：9 张表名、迁移二次 deploy 不报错、PRAGMA foreign_keys=1、枚举列/planStart/planEnd 为 TEXT 且 createdAt 为 DATETIME、删除有用户活动的目标抛 P2003 且删除后两表数据仍在、移除子项后同一条 delete 成功、ProjectMember 级联删除、清理助手清空全表并可重建 | 采纳：另用 node:sqlite 做反事实探针，确认 FK=OFF 时同一 DELETE 会成功并留下孤儿（goal=0/activity=1），证明断言测的是真拒绝而非测试写错 |
| 22 | 2026-09-19 18:23 | 编码智能体(T0-02) | 测试清理助手与回归验证 | 每个测试用临时 SQLite 文件（不用 :memory:）；清理助手按外键逆序清空全表；原有测试必须继续通过 | src/db/test-support.ts 提供 createTempDatabase（mkdtemp + prisma migrate deploy + 独立 PrismaClient）与 resetDatabase（AuditLog→ObjectVisibility→Task→UserStory→UserActivity→BusinessGoal→ProjectMember→Project→User）；npm run typecheck 通过，npm test 3 文件 39 例全绿（原 31 + 新 8） | 采纳：临时文件避开 Prisma 连接池导致的「建表/查询不同连接」偶发失败；清库顺序与契约外键方向一致，可被后续所有测试复用 |
| 30 | 2026-09-19 18:31 | 测试智能体(T0-02) | 对抗性验证：9 表逐字段契约比对与 14 处外键删除规则 | 以决策 I-7 冻结 schema 为唯一权威；要求逐表逐列比对字段名/类型/可空/默认/主键/唯一约束，逐条验证全部外键删除行为，发现真实缺陷可改生产代码但须逐条留证 | 新增 test/db-schema-contract.test.ts（29 例）与 test/db-delete-rules.test.ts（15 例）：9 表全部列、复合主键 (projectId,userId)/(objectType,objectId,userId)、User.account 唯一、两处 ObjectVisibility 索引、枚举默认值均与契约逐字一致；外键实测 9 RESTRICT + 5 CASCADE 共 14 处，与冻结 schema 完全吻合（提示词所称 16 处与契约不符，属计数误差，非实现缺陷）；无 schema 缺陷 | 采纳：逐条断言对齐契约原文，并用交叉项目引用隔离会被其它外键顺带拦住的用例，证据充分 |
| 31 | 2026-09-19 18:31 | 测试智能体(T0-02) | 探针：迁移从零可复现、resetDatabase 彻底性、日期字符串排序 | 迁移必须能在全新库重建而非依赖 migrate dev 残留；resetDatabase 需逐表 count=0；验证 planStart/planEnd 字典序==时间序 | `prisma migrate diff --from-migrations ... --to-schema-datamodel` 输出「This is an empty migration」（迁移与 schema 零漂移）；新增 test/db-reset.test.ts（3 例，含悬挂 ObjectVisibility 与连续两次清库）与 test/db-date-ordering.test.ts（3 例）：满负载清空后 9 表 count 全为 0，有效零填充日期的字典序与时间序完全一致；同时记录「非零填充会破坏排序，格式仅由 Zod 保证、DB 不强制」这一契约前提 | 采纳：从零迁移与清库彻底性实测闭环，日期结论附带已知边界 |
| 32 | 2026-09-19 18:31 | 测试智能体(T0-02) | 探针：Prisma 单例隔离与 postinstall 干净环境行为 | 若单例与临时库混用是否会把数据写到别的测试库；npm ci 时 postinstall prisma generate 是否会因缺 .env/schema 路径失败 | 新增 test/db-client-isolation.test.ts（2 例）：两个临时库互不污染；单例在首次构造时绑定 DATABASE_URL，改环境变量并 resetModules 后仍返回同一实例（globalThis 缓存），是潜在读串库风险，但 test-support 与现有测试均不引用单例故当前无实际污染；在 DATABASE_URL 未设置下 `prisma generate` 退出码 0，postinstall 脚本体可运行。真正执行 `npm ci` 端到端未验证（避免重装 node_modules/依赖网络） | 采纳：风险与已验证项分开陈述；单例风险留 Sprint 2 评估，`npm ci` 标注未验证不报通过 |

> 备注：序号 20–22 由 `feat/T0-02-schema` 分支（worktree `/home/lee/aim-wt/t0-02`）的编码智能体(T0-02)追加。为避免与主仓库其它智能体的序号冲突，本分支从 20 起编号，仅追加、未改动 1–7 行。
