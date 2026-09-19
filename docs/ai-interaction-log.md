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
| 8 | 2026-09-19 18:23 | 代码审查智能体 | 冻结契约两处改动的合规性裁定 | 审查 e947259..cb18931 两个提交；Sprint 1 契约冻结，改动须走提出-全员确认-单人修改-通知并回写文档；不得改代码，仅追加本表 | 认定 INTERNAL_ERROR 是契约空白的合理填补却仍未走流程；非法 JSON 改 422 修复了 500 缺陷，但把全部 Fastify 4xx 统一改写为 422 属语义失真；实测 401、403、413、415 均被改写为 422 请求格式非法，会劫持后续鉴权与传输层状态 | 修改后采纳：保留 500 顶层码但必须按流程回写契约；4xx 映射收窄到 JSON 解析错误或改用契约修正后的 400，禁止劫持 401、403、413、415 |
| 9 | 2026-09-19 18:23 | 代码审查智能体 | 类型守卫与测试运行器实测 | 要求实测 @ts-expect-error 守卫真伪，核查 tsconfig 严格性与 vitest 覆盖范围；只读验证，不改仓库文件 | 在 /tmp 副本把一条反例改成合法赋值后 tsc 报 TS2578 且退出码 2，未改副本基线退出码 0，证明守卫生效；根 tsconfig 程序确实包含该文件；web 程序仅 4 个文件、未含共享类型且无前端测试；两份 tsconfig 均开 strict，src 无 any 与 ts-ignore | 采纳：类型守卫与严格性结论成立；vitest 范围符合契约唯一 seam，前端测试缺口记为非阻断并要求在 Sprint 1 验收口径中写明 |
| 10 | 2026-09-19 18:23 | 代码审查智能体 | 工程装配与安全检查 | 检查健康检查泄漏、.env 忽略、占位目录、Windows 原生 dev 与构建脚本可行性；不得改代码 | 健康检查仅返回 status ok，无版本与环境泄漏；.env 已忽略且示例无凭据；占位目录齐全；发现 vite 代理只覆盖 health 与 api 而契约端点都在根路径；.env 不会被服务端加载；AppError 无法表达 401；HOST 默认 0.0.0.0；无 lint 与 CI 与 verify；build 及 Windows 原生 dev 未验证 | 修改后采纳：安全与占位项无需改动；代理路径、env 加载、401 契约缺口、HOST 默认值列入后续修复；Windows 原生 dev 与 build 由团队实机补验 |
| 11 | 2026-09-19 18:28 | 代码审查智能体 | 冻结契约两处改动的裁定（§A） | 审查 e947259..cb18931 两个提交；Sprint 1 契约冻结，改动须走提出、全员确认、单人修改、通知并回写文档；只读审查，不修改任何代码 | 认定 INTERNAL_ERROR 属契约空白的合理填补，但未回写文档，冻结文档与代码已不一致；实测畸形 JSON、空 JSON 体、413、415 以及任何带 statusCode 的 401 与 403 全部被改写为 422 VALIDATION_FAILED 请求格式非法；400 与 413、415 的原状态码信息被丢弃，并将劫持 T0.3 的 401 与 T2.2 的 403 | 修改后采纳：保留 500 顶层码但必须先回写契约 I-4 与决策记录；422 泛化改为收窄匹配并保留原状态码，400 与 413、415 单独定码；两处均须补走契约变更流程 |
| 12 | 2026-09-19 18:28 | 代码审查智能体 | 类型守卫、严格性与测试运行器实测（§B、§C1–C3） | 要求不看声明只看实测：@ts-expect-error 是否真能拦截；strict 与 any 泄漏；vitest 覆盖范围与前端测试有无 | 在 /tmp 副本把一条反例改成合法赋值后 tsc 报 TS2578 且退出码 2，把 StoryStatus 放宽为含 ACTIVE 亦报同一错误，证明守卫真实有效；根与 web 两份 tsconfig 均 strict，src 无 any 与 ts-ignore，仅 2 处 as；clientStatusCode 因 Fastify 5 的 setErrorHandler 默认泛型为 unknown 而非多余，但可用 setErrorHandler<FastifyError> 取代（副本验证编译通过）；vitest 只覆盖 test 与 src；实测把共享类型文件改坏后 web typecheck 仍退出 0，证明前端程序完全不含共享契约类型 | 采纳：守卫与严格性结论成立；前端类型接入与前端测试缺口记为非阻断，要求在首个前端页面前补一行共享类型引用 |
| 13 | 2026-09-19 18:28 | 代码审查智能体 | 工程装配、占位与安全检查（§C4–C6、§D） | 核查健康检查泄漏、env 忽略、占位目录、Windows 原生 dev 与构建脚本；只读验证 | /health 只回 status ok 且无版本与环境响应头，500 响应体不含堆栈与路径，.env 未被跟踪、.env.example 无凭据，七个占位目录齐全；发现 vite 代理仅 /health 与 /api 而契约 30 个端点全在根路径，前端 fetch 业务路径会落回 index.html；无任何脚本加载 .env，示例里的 PORT 不生效且改端口后代理会静默错指；在 /tmp 副本跑通 npm run build 并用 dist 产物验证 /health 返回 200；concurrently v9 有 win32 分支且支持 npm 简写，Windows 未实测 | 修改后采纳：代理路径与 env 加载列为阻断修复，HOST 默认 0.0.0.0、无 lint 与无 CI 列为建议项，Windows 原生 dev 由团队实机补验 |
| 14 | 2026-09-19 18:30 | 代码审查智能体 | 审查期间工作区被并发改动的记录 | 审查范围是已提交的 e947259..cb18931；发现工作区出现第三方未提交改动，只读观察不介入，不改任何文件 | 并发改动把请求体解析层错误改为 400 BAD_REQUEST、其它 4xx 保留原状态码，并给 AppError 增加 401、给 ErrorCode 增加 BAD_REQUEST，方向与本次裁定一致；但 test/error-handler.test.ts 仍断言 422，导致 npm test 30 通过 1 失败，且契约文档仍未回写 | 待处置：方向采纳，但必须先补齐测试断言与契约回写，否则该分支不得合入；18:31 复核：测试断言与契约文档已由并发改动补齐，37 例全绿、typecheck 干净 |
| 15 | 2026-09-19 18:30 | 编码智能体 | 修复审查阻断项 B1：错误处理器劫持全部 4xx | 只处理请求体解析层错误，不得按 statusCode 区间改写；补 401/403/413/415 回归测试；保留不误报 500、不透传解析器内部信息 | 把 error-handler.ts 的 4xx 区间匹配收窄为仅 FST_ERR_CTP_INVALID_JSON_BODY / EMPTY_JSON_BODY → 400 BAD_REQUEST；其它 4xx 保持原始状态码且仍走 ErrorResponse 信封；新增 4 条参数化回归与 401/403 码映射测试 | 修改后采纳：测试智能体上一轮修 500 的方向正确，但 4xx 一律改写为 422 属语义失真，必须收窄；本次收窄后实测 401/403/413/415 保持原状，消除对 T0-04 requireAuth 的前瞻性阻断 |
| 16 | 2026-09-19 18:30 | 编码智能体 | 按冻结流程补办契约修正（B2） | 只改 I-2b / I-3 / I-4 三处，文档头注明这是 T0-01 受控修正，并同步基线 §6.1；不得顺手改其它契约内容 | 契约 I-4 新增 BAD_REQUEST(400) 与 INTERNAL_ERROR(500)，并声明除解析层外禁止按状态码区间改写、401/403/413/415/429 保持原状；I-3 把失败状态码表述扩为 4xx/5xx；I-2b 补 401/UNAUTHENTICATED 及 401 出口规则；基线 §6.1 新增决策 5 | 修改后采纳：审查对两处改动裁定「方向正确但未走流程」，本次由技术负责人单人按流程回写契约与基线，保留原有实现改动并补齐文档 |
| 17 | 2026-09-19 18:30 | 编码智能体 | 修复审查非阻断项 S1 / S2 / S4 | 代理须覆盖契约全部根路径前缀且不得用 `/` 全量代理；AppError 支持 401；HOST 默认回环；本轮不碰 package.json 与模块目录 | vite.config.ts 新增 /auth、/projects、/goals、/activities、/stories、/tasks 代理（保留 /health、/api）；errors.ts 状态联合补 401、顶层码联合补 UNAUTHENTICATED；server.ts HOST 默认 127.0.0.1 | 采纳：三个集成隐患逐条消除；S3/S5/S6/S7/S8/S9 按工单明确不做，留后续任务 |
