# C 附件两处接线 + UML 正式页面验收交付（2026-10-24）

## 组合、范围和纠正

- 独立worktree：`D:/临时项目/AIManagement-C-attachments`，分支 `feat/C-attachment-consumers`。
- 基于B已解冲突候选 `f516b207aac5a9556ba071d88d5d76eaacfe6a41`，合入本批main `90f07542d51d7ab3a9428f29333c4e6733e1fab0`。唯一contracts.ts冲突按B已经明确的“contracts转发属公共候选”规则保留候选原样re-export；未自定义shared类型、未覆盖D业务/测试/文档。
- 组合提交59c362b后合入C UML评审修正9456f2b及formal脚本0e21041，形成可一次集成的候选；B公共候选未由C直接合main。
- **FS纠正**：已实际验证cc67e33是main祖先（exit0），并git grep核对acceptance/service.ts:287调用assertCanEnterDoing。A的FS驳回守卫已合入，不再列“等A交付”；未代写/重测并冒称拥有A的9项证据。
- 排程按用户已确认的另一C会话单写，本会话不碰其提交或代发#32。测试可靠性单独记录，不把定向绿当全库绿。

## 附件两处已实现

1. `task/routes.ts` 注册时取得注入的attachmentCleanup，缺失即fail-fast，不no-op。保持原task.write鉴权/404顺序。
2. 真实DELETE改原caller-tx为callback：markForTaskDeletion(tx,id)→objectVisibility清理→task.delete；失败整笔回滚，不在事务前删物理文件。
3. 提交后run；逐行失败或整体异常通过安全日志可观察，状态保留给B启动/30秒重试；不把提交后的清理失败伪装成“任务没有删除”。未跨import DB/attachment service或new实现。
4. TaskSection每个真实可见任务有附件展开入口，一次仅挂一个D TaskAttachmentPanel，不改变表格单元数或任务编辑/验收逻辑。切任务/项目/身份、返回页面/账号存储变化卸载旧面板。
5. C的TaskAttachmentSlot在挂载时通过真实GET project/task复核归属和展示权限；PM或MEMBER负责人显示写控件，非负责人/验收人/VIEWER即使是负责人均只读。页面只控制体验，实际上传/下载/删除仍由既有中央鉴权权威判定。
6. 全部附件测试使用mkdtemp独占上传目录，未读取/递归清理项目var/uploads。

## 同文件 UML 锚点窗口

用户额外明确确认：在本次C TaskSection单写窗口一并采纳先前已批准的最小锚点，而非继续等B改同一文件。仅useLocation/hash effect + 可见任务行id/tabIndex；已加载可见数组匹配才滚动/聚焦。未知/非法/隐藏id不额外请求、不推导权限，不新增task API或详情route。

## UML 评审修正

在独立UML分支的C自域提交9456f2b：
- 非边P2003退化为无虚构field的通用422；仅umlEdge.createMany上下文定位edges.sourceNodeId。
- 已知edge/四类关联写入的P2002返回真实字段+DUPLICATE，无法定位的顶层冲突不伪造字段。
- 新增5项真实SQLite trigger约束HTTP用例，实测非边FK/owner FK无edges字段、edge FK准确、edge/ref唯一性定位及全事务回滚。
- 新增5项纯函数往返Vitest，覆盖反向/双向association、null标签、三类消息、自消息、换序与服务端seq权威、非法端点拒绝；未mock业务或改公共测试配置。
- 修过期sticky注释、旧verification历史导航。LOW计时型存在性差异仍列已知非阻断项，不声称做到了常数时延。

## 实测（本批固定组合基线）

| 范围 | 实际结果 | 证据 |
|---|---|---|
| 新C真实DELETE生命周期 | 7 passed，40.35秒，exit0 | evidence/lifecycle-http.txt |
| 附件/D模块/B仓储清理/骨架/schema/新C生命周期 | 9个实际文件/107 passed/0todo，59.53秒，exit0 | evidence/attachment-regression-results.json及txt |
| 正式TaskSection Chromium | 最终9项通过，20.46秒，exit0 | evidence/formal-browser-results.json、formal-browser-seeded.txt、截图（初轮formal-browser.txt保留） |
| UML评审分支HTTP+schema+authz | 110 passed/0todo，37.84秒，exit0 | issue-35/evidence/review-http-results.json及txt（在UML worktree执行） |
| UML纯映射往返 | 5 passed，exit0 | issue-35/evidence/review-roundtrip.txt |
| 正式UML路由/导航/任务行 Chromium | 最终16项通过，27.72秒，exit0 | evidence/uml-formal-browser-seeded.txt、issue-35/evidence/formal/integration-browser-results.json、截图（23.37秒独立诊断轮也保留） |
| 组合server typecheck | exit0，13.93秒 | evidence/typecheck-final.txt |
| 组合web typecheck | exit0，5.42秒 | evidence/typecheck-web-final.txt |
| server build / web build | exit0，8.41 / 1.87秒 | evidence/build-server.txt、build-web.txt |

### 真正验证的关键行为

- 真实上传→实际DELETE /tasks/id204→任务/附件元数据/物理文件均消失（IPC仅在业务操作后核对独占库/目录，不手调清理）。
- 实际DB删除trigger失败→mark、可见性和任务一起回滚，原文件仍在；无半图或ACTIVE/null孤儿。
- 实际文件被独占目录占位而删除失败→任务已删、CLEANUP_FAILED/taskId=null/失败计数为1；恢复磁盘后等待生产30秒定时器，文件与元数据自动消失，没有手调run。这是带40秒单例上限的真实定时恢复用例，不是拉长全局测试超时掩盖失败。
- 正式页面上传/下载事件与字节一致、单附件删除、PM任务删除、VIEWER/非负责人只读、VIEWER负责人仍只读、切任务卸载、真实敏感撤权后清空/重新打开拒绝、outsider404。
- 正式ProjectLayout导航进入UML、两类图保存刷新、四类关联、草稿保留、后置标敏白名单仍404、实际任务链接点击定位和焦点、深链刷新、同页hash、前进后退、非法/未知/隐藏hash不请求隐藏详情。

## 必须保留的失败和风险

1. 扩充的VIEWER隐藏hash用例首轮在只换localStorage+hash导航时保留了旧PM React树，错误观察到隐藏行。已修fixture：身份切换后真正reload重新装载AuthContext，未改任何拒权断言；最终隐藏行0、无隐藏详情请求。失败日志uml-formal-browser-final.txt保留。
2. 一轮formal浏览器在POST时ERR_CONNECTION_RESET、后续连接拒绝，未证明根因；增加fixture退出码/stderr诊断后独立运行完整16项通过。失败uml-formal-browser-rerun.txt/失败JSON保留，不把复跑绿说成已定位修复。
3. 组合UML联合测试exit1，Vitest警告“tests still running when generating JSON”；JSON自报success=true但passed=106/total110，4项assertion仍pending（即使各file标passed）。**本轮按失败/不完整记录，不能信success一项造绿**。result-summary.json列出全部不一致。仅对受影响的uml.http.test.ts独立复核54项全过（36.64秒），不把跨轮计数累加为组合全量通过。
4. 旧worker异常/全量测试可靠性仍未证明修复；没有改共享pool/timeout/断言或跳过失败来造通过。本批没有重跑全库。
5. 提交后附件最终复核在fixture签发会话阶段报SQLite database is locked，尚未进入业务断言（formal-browser-final.txt保留）。核对test/http-support.ts确认loginAs是同步DatabaseSync写，而原脚本在app.listen启动真实后台写者后才签会话；已将两个C浏览器fixture的会话生成前移到listen之前。没有修改公共helper、禁用生产worker或添加重试掩盖错误。随后同组合上附件9项、UML16项重新完整通过。此定位仅解释本次bootstrap写锁，不擅自归因上面的旧连接重置或Vitest pending。
6. 已失关联且无可靠历史证据的旧UML图，当前表不能重建完整历史，尚不能提供全覆盖保护证明；仍需负责人/B按既定未知历史保护口径收口。读侧业务不能擅自把未知历史当普通公开；本批可构造的真实生命周期已验证，不冒称历史治理完成。

未合PR/关闭工单/改main；只推本票分支，实际SHA与公开回帖见后续发布回执。源码/数据/凭据均不从真实开发环境取用。C旧文件补丁交付后停止继续双写，B可按回执组合复核；后续增量再登记窗口。
