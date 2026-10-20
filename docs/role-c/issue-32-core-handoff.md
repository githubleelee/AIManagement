# #32 本批核心能力交付 / B 接入清单

> **实际交付已推送**：功能分支`feat/US12-scheduling-core`，代码提交`2282221f69ec4129979eb8b24ba2c716d509a4a0`。#32/#24/#31补充请求均已发布并GET核验，见[发布回执](issue-32-core-publish-receipt.md)。未合main、未关闭task窗口，B/D尚待答复。
>
> 当前为授权范围内的阶段性实现，不是完整 US12、正式 AI 接入或最终验收。用户已授权：确认与main无冲突后推送功能分支并补齐Issue；实际提交、推送与留言回执在独立记录中追加，不直接推main。没有新增公共 Action、共享端口、表/迁移或生产路由。历史 `issue-32-blocked.md`、`issue-32-validation-result.md` 是各自固定基线的快照，不按当前状态重写。

## 1. 基线与唯一写者

- 工作树 `AIManagement-US12-core`，短分支 `feat/US12-scheduling-core`。
- 开工基线 aa69288，后更新到 main **37287c26a2d867e938132a906f9422354f66eb7c**。
- 已批准旧提交 bb4080d 先重放为5d02026，更新基线后为 **efc4e052214981d78ef4a8eace0bc76467145e66**；不是新功能已提交的声明。
- 原工作树 `AIManagement-US12`、原分支及其未提交记录未动。更新本批基线前20文件备份；stash恢复时1个退出码文件仅换行变化，已恢复原字节并确认20文件SHA-256全部一致，备份/恢复点保留。
- 授权：[B 的 task 窗口](https://github.com/githubleelee/AIManagement/issues/32#issuecomment-6260611783)、[两份 FROZEN v1.0](https://github.com/githubleelee/AIManagement/issues/32#issuecomment-6260626307)。B 的真实开工 FS 守卫仍属后续排队工作，不混入本批。
- 本地完成不等于窗口已关闭。仍须按约定 PR 合入，或双方书面留痕关闭；本文不自动关闭窗口，也不代替远端交接。

## 2. 已实现文件与能力

| 文件 | 本批职责 |
|---|---|
| `src/modules/ai-scheduling/source.ts`（新） | 注入事务 DB 的完整只读投影、查询层任务及父故事排敏、受众隔离、SHA-256来源指纹、可用/不可用结果 |
| `verification.ts`（新） | 实时授权和同事务复读、整份来源过期、受保护建议范围、TODO/成员/日期规则、真实FS（含未改期及隐藏邻居）、混合里程碑 |
| `schemas.ts` | 保护性来源元数据、成员角色及父故事溯源；旧fixture兼容，不把fixture升级成真实输入 |
| `policy.ts` | 不向模型输出私有来源revision；缺源/私有约束未复核阻断；离项owner负载不漏记；基线比较补角色/父故事 |
| `policy.http.test.ts` / `core.http.test.ts` | 独立规则与真实SQLite/HTTP测试；所有探针仅注册在测试内 |
| `src/modules/task/rules.ts` | `assertTaskAssignment` 窄DB类型；`writeAssignedTask` 共用基础校验与单条持久化；`applyTaskPlanDates` 调用方事务批量日期能力 |
| `src/modules/task/routes.ts` | 原PATCH复用单条持久化核心；原Action选择、字段合并、错误顺序、进度/阻塞原因与P2025映射保留 |

没有改旧测试、其他旧业务模块、B公共区或前端骨架。没有第二套任务service/表或HTTP逐条PATCH写入循环。

## 3. 只读与序列化边界

`createSchedulingReader(authorize)` 只生成本域适配器。`authorize(tx, actor, project)` **必须由B装配真实#32 PM-only Action**；没有默认`project.read`回退，也没有本域角色判断。根PrismaClient在运行时拒绝，防止把多查询误作一致快照。

- `state:ok + complete:true`：本次DB投影未设take/skip，真实获取完整目标集合。已知空可用；异常、非法日期/状态等返回`unavailable/data:null`，不造空数组/0伪成功。
- `snapshot`：受保护最小非敏感来源，包括父故事ID、成员/角色、日期/状态/分配、可公开FS/里程碑、完整性与范围标记；revision不含asOf，每次一致读取的UTC时间不是锁。
- `pmProtected`：全项目数量和排敏数量，仅内部PM受众。
- `serverPrivate`：只留快照协议标识和必要摘要，不保存原始隐藏端点、日期或正文。
- `aiInput` / `schedulingModelInput()`：独立出口；无revision/私有摘要、全局排敏计数、父故事ID、验收人或敏感标志。模型实际调用仍不存在；**DTO已排敏不代表任意真实资料已获外发授权**。
- 负载按实际参与非敏感任务、非CLOSED（含DONE）重算。当前成员之外的可见任务owner仍有统计行，任务不会静默消失；成员有效性在日期应用规则中单独阻断。
- SHA-256采用本域`us12-source-v1`集合式规范化；数组按集合稳定排序。**不可拿此算法规范化其他域有序业务内容**。未给业务表加全局版本字段，摘要不是并发锁。

## 4. 私有日期校验

`createSchedulingVerifier(authorize)` 返回内部校验器。参数`SchedulingVerificationContext`是**受保护保存建议的本域投影**（来源revision、原建议可改期任务集合），不是共享存储schema，也不是客户端可签发的锁/范围。

- 必须由未来处置服务在：归属解析→真实鉴权→受保护读取→幂等重放后调用；不能拿它代替重放判断。
- 先同事务复算来源：相关变化整份过期，不按每行挑选性放行。
- 不能把同项目其他可见任务追加进原建议；无有效保护范围则明确不可用，不回退全项目。
- 原始/修改后的日期均严格校验；仅TODO允许改期，原负责人/验收人和当前成员资格不改变。
- 相关真实FS两端读取最小日期，替换候选日期后检查前置结束次日；实际开工的CLOSED门槛归B，不以DONE替代CLOSED，也不把实际开工限制强加到日期规划。
- 隐藏边或混合关联不写入模型/快照正文；未完成私有校验时普通policy不能放行。受保护校验完成后只返回通用阻断/提示，不回传隐藏ID、日期、名称、精确关联计数。
- 混合里程碑超期是提示，不发明硬截止；无关私有边不任意阻断另一候选。
- `ok`表示取得完整来源并得到assessment，**不等于可写**；还须检查`assessment.canApplyDates`。内部`stale/invalid-changes/out-of-scope/unavailable`没有自行冻结为新公共code/HTTP错误。
- 本校验器不写任务、不保存建议、不登记处置、不审计、不调用模型、不提交事务。测试的服务器上下文是固定fixture，不是假装已有保存建议。

## 5. task能力给B的装配要求

本地具体实现：

```ts
applyTaskPlanDates(tx: TaskWriteDb, projectId: string,
  changes: readonly { taskId: string; planStart: string; planEnd: string }[])
  : Promise<TaskPlanDates[]>
```

- B仍负责`shared`声明与app注入；C生产代码不直接import task service。仅测试为验证真实实现而直接注入该能力。
- 能力拒绝根客户端、不自行开启/提交事务；校验整个集合、成员归属/人数/验收独立性/日期顺序后执行。
- 原手工PATCH与批量能力都经`writeAssignedTask`，同一基础校验入口；手工混合字段依旧一个SQL update，未拆成两次独立提交。手工处理器保留原先的前置分配校验顺序，持久化核心再校验一次，不改旧错误优先级。
- 此基础能力**故意不加**#32专用TODO、建议范围、来源与FS限制；这些由C在同一事务叠加，防止误伤原手工编辑/进度/验收。
- 调用方不得在事务内吞掉写失败后继续提交部分更改；必须让失败触发整事务回滚。
- 正式编排仍须：同一事务内实时鉴权、保护建议/处置、幂等重放、来源与规则复核、唯一最终处置+pending CAS、日期写、成功审计。失败证据需事务回滚后另记，且写入失败可观察。
- Prisma冲突/并发删除的正式新入口映射由B/C公共适配收口；不把未知DB异常伪装校验成功。不能以SQLite单写者代替唯一处置约束。

## 6. 验证和收尾

验证分层：独立规则、真实DB/测试HTTP能力、原生产装配浏览器回归；**没有正式#32 API/真实模型/共享处置闭环验收**。

最终补强后重跑实际完成于2026-10-21 00:32:40 UTC+08:00：**1537通过/12TODO，63文件通过/1个TODO文件跳过**，typecheck/build均exit0，8受测源文件指纹不符0。命令使用单worker、hook/test超时各60000ms。此前首轮540秒超时和旧测试hook/唯一键失败保留，独立诊断2文件62例通过；根因未定，不把重跑通过说成从无失败。没有改旧测试或Vitest配置。正式#32集成12TODO没有转为通过。

原始最终证据：`final-rerun-result.json`、`final-rerun-full.txt`、`final-rerun-typecheck.txt`、`final-rerun-build.txt`、`final-rerun-tested-manifest.json`；首轮失败见`final-first-timeout.md`及`final-full.txt`。浏览器覆盖的task两个文件在最终补强期间未变，其余C源文件由最终真实DB/HTTP测试覆盖。

证据目录：`docs/ai-records/C/issue-32/evidence/C-I32-20261019-main01a1493f-02-core/`。

浏览器实测（完全虚构、独立迁移临时库）：UI标题/日期保存；DOING+45%进度刷新持久；非法混合PATCH422且标题/日期/进度全部不变；原验收POST200、DONE→CLOSED、成员负载1→0；甘特1故事/2任务/1里程碑/1FS可读。没有对真实资料或开发DB操作。旧5197缓冲、预期422、favicon404及挂起后的Vite重连均单独区分，不冒充全程零控制台错误。

清理：先核对PID命令行属于本批fixture；首次PowerShell清理POST因默认媒体类型415未执行关闭，改JSON请求后成功。2026-10-20 23:44:56 UTC+08:00确认本批服务与Vite已停止，临时DB文件不存在。未停止其他会话进程。

## 7. 仅外部交付/额外授权才能完成的部分

1. D/B公共AI生成端口与实际mode/model/version/requestId及真实API模式验证。
2. B共享建议/处置schema、唯一最终处置、请求标识/摘要、调用方事务端口、正式#32生成/读/审计/共享处置Action。
3. 上述到齐后C实现真实生成/保存/查看/确认/拒绝、实时再鉴权、唯一处置/幂等/并发、成功与失败证据编排，再由B挂生产路径与前端。
4. B/D明确过期拒绝状态机、提交后事件失败与恢复语义；不擅增outbox或exactly-once承诺。
5. **错误口径冲突**：FROZEN #32稿写400；现有`AppError`、错误处理器、原接口及甘特均使用422。旧路径保留422，正式#32映射须B书面更正/确认，不改共享错误码凑齐。
6. #31最小交付截止2026-10-20 17:00已过；23:23后的公开GET仍无D新提案（#31=3评论、#37=1评论且为B催办）。由**项目负责人**决定继续等候/改派/授权B先定义最小字段；本批不替其裁决，也不根据超时自动抢写公共层。

用户已经授权无冲突时推送功能分支并补发Issue，随后要求遇阻即停、记录后继续独立工作。main仍37287c2；先核验ROLE-C本人xichoutrees，仓库API返回permissions.push=false，该身份的推送路径即停止。用户随后明确指定改用brucelyce邮箱账号；已核验实际GitHub登录**brucelyce-ux**、permissions.push=true，依据新授权恢复功能分支推送，不通过修改提交邮箱获取权限、不新建fork。实际提交及评论回执随后独立追加。没有自动合入main、关闭Issue、改标签或关闭task写窗口；B仍须审阅后按原条件完成交接。
