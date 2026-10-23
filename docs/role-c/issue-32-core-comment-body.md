<!-- role-c-us12-core-delivery-v2 -->
## ROLE-C：核心能力已推送；更正400/422，并请求公共接入和task交接确认

> 经用户本轮授权，由 @brucelyce-ux 代 ROLE-C / @xichoutrees 发布。只交付已完成子集，不申请合main/关闭工单/变更标签，不宣称完整US12通过。

### 一、实际交付

- 分支：`feat/US12-scheduling-core`；提交：[2282221](https://github.com/githubleelee/AIManagement/commit/2282221f69ec4129979eb8b24ba2c716d509a4a0)。固定main基线`37287c2`，提交前8个受测源文件SHA-256不符0；`merge-tree`与当前main无冲突。这不是对未来main变化的保证。
- 在你已开放的task窗口内，只改`task/rules.ts`、`task/routes.ts`及C自有域/测试；未改公共区、旧测试或其他旧业务模块。真实读取投影和受保护日期复核已实现；原手工PATCH与批量日期能力复用基础持久化核心，混合字段仍单次SQL原子写。
- 查询层任务及父故事排敏、保护快照/稳定指纹、模型独立出口、离项owner负载不漏记；来源过期和原建议可改范围复核；真实FS两端（含未改期/隐藏邻居）与混合里程碑受保护校验，私有内容不写模型或快照正文。
- **1537通过/12TODO**，类型检查、构建exit0；最终单worker、hook/test超时各60秒。此前首轮540秒超时、旧测试hook/唯一键失败原样保留，不以重跑通过抹去失败，根因未定。虚构临时库上的真实浏览器已回归手工编辑/进度/验收、甘特和负载；本批服务停止、临时DB删除。
- [完整交付与B接入清单](https://github.com/githubleelee/AIManagement/blob/2282221f69ec4129979eb8b24ba2c716d509a4a0/docs/role-c/issue-32-core-handoff.md)。正式#32 API、真实AI、共享存储、唯一处置/幂等/审计闭环仍未实现，12个集成TODO没有勾通过。测试中的`task.write`只作测试seam，不冒充正式#32 Action。

### 二、必须补发的错误口径更正

我原评论 [6247293014](https://github.com/githubleelee/AIManagement/issues/32#issuecomment-6247293014) 的C5自己也误写“既有400”，随后B答复和冻结稿沿用了该说法；**不是只归因于B**。

现有`src/shared/errors.ts`、`src/error-handler.ts`、任务与甘特接口实际采用 **422 VALIDATION_FAILED**；本批保留422，未改公共信封。请B书面确认#32沿用422并更正冻结文档；若确要改400，请由公共单写人给出明确契约变更与迁移。内部`stale/out-of-scope/unavailable`尚未自行映射为新公共code。

### 三、请按已冻结原则落实/答复，不重新申请旧规则

1. **公共接入**：请B给出shared/app注入的日期基础能力与真实#32 PM-only生成/读/审计/共享处置Action；共享建议存储须支持caller-tx、唯一最终处置+pending CAS、独立请求标识/规范化摘要。C不直接import其他域service、不建排期专表。
2. **仍待状态机**：过期建议能否拒绝、拒绝跳过哪些日期检查，请B/D随共享状态机明确；事件提交后失败/恢复语义仍待#37，不擅增outbox或exactly-once承诺。
3. **task窗口交接**：本批提炼已可审阅，请B优先看此分支，按PR合入或双方书面关闭后交给B真实开工FS守卫；本条**不自动关闭窗口**，也不顺带代写B守卫。
4. **D逾期升级**：#31/#37的2026-10-20 17:00截止已过，最近公开读取仍无D新交付。请项目负责人明确继续等候/改派/授权B定义最小字段；C不按超时自行接管公共层。

#32所有操作仍PM-only，#33的非PM分析只读不扩张本票。基础业务七问/事务十二问已经接受，本次只补错误更正、运行时交付和实际窗口交接。
