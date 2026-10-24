<!-- role-c-us15-late-sensitivity-confirmation-v1 -->
## ROLE-C / #35：guard 已接入；请确认“先关联普通对象、后标敏感”的置位责任（已实测反例）

@githubleelee 已接收并落实 comment-6315739437 的既定裁定，不重新申请 guard：关联时真实目标敏感则同事务置 `everRestricted=true`；非 PM 的列表/total/详情共用当前关联交集且 guard=false；历史 true 永不自动清除。

C 本地提交 `cefe96c`，分支 `feat/US15-uml` 已包含 main `0998f62`。**推送因工具自动审核失败尚未执行，请勿假定远端已有此 SHA。** 已完成 88 项定向测试、9 项实际 API Chromium、前后端类型检查与构建。完整说明及隔离合成库诊断在 `docs/role-c/issue-35/guard-progress.md`。

### 需要确认的新边界（不是已解决的关联时规则）

task/story 两类均经真实 HTTP 在隔离迁移库复现：

1. 创建普通目标并建立图关联：非 PM GET 200，guard 默认 false。
2. PM 通过正式 `PUT /tasks/:id/sensitivity` 或 `/stories/:id/sensitivity` 将目标标敏感，名单只包含另一个 MEMBER。
3. 未在白名单的 VIEWER GET 图 404，但白名单 MEMBER GET 图仍 200（尚未 sticky 置位）。
4. PM 清空关联后，原 VIEWER GET 图变为 200；另两张同批图分别在目标恢复普通、或敏感目标真实 DELETE 后，也恢复 200。

复现脚本 `probe-late-sensitivity.ts`；观测证据 `evidence/guard-late-sensitivity-observed.json` / `guard-late-sensitivity-probe-rerun.txt`。**这些 200 是未解决的历史保护缺口，不是验收成功**。诊断来自 main `7447a5f`；随后合入 `0998f62`，期间相关 UML/authz/task 写点未变；最终基线追加诊断因自动审核超时未执行，不伪称已复跑。

### 请 B / 项目负责人确认并给责任写点、窗口及 SHA

- 是否将任务/故事从普通变为敏感时，在**同一敏感写事务**将同项目所有已关联 UML 图批量置 `everRestricted=true`，即使关联者在白名单中也只允许 PM 读图？C 建议这样延续“曾经受限”的裁定，而不是依赖日后某次图 PATCH 补位。
- 请明确该敏感写点由谁落笔，并补敏感与建联并发次序、事务回滚、解绑/删除/恢复普通后不可自动降密的测试；C 不跨写旧模块或权限公共文件，也不在只读请求中修数据库。
- 请说明历史上“关联后才敏感”的仍有关联图如何回填；已失去关联的历史不能仅凭当前表重建，不应宣称全覆盖。

C 已继续完成自己可写的接入与验证；在该边界明确并落地前，不宣称 AC5 全生命周期保密验收完成，也不请求将当前实现直接当成安全上线完成。
