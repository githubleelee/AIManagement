/**
 * ROLE-D 附件契约的**转发**文件（公共接入后，唯一权威定义已上提到 `src/shared/attachments.ts`）。
 *
 * 依据：`docs/role-d/ROLE-D-ATTACH-public-integration-request.md` 第 1 项、
 * `DECISIONS.md` `arch.shared-ports-and-assembly`（公共附件类型与端口放 `src/shared/`）。
 *
 * 本文件**只做 re-export**，不再持有任何定义 —— 避免 shared 与模块各留一份会漂移的类型。
 * D 的 `service.ts` / `in-memory-repository.ts` / `local-storage.ts` / `plugin.ts` /
 * `errors.ts` 继续 `import … from './contracts.js'`，经此处解析到 `src/shared/attachments.ts`，
 * 实现零改动。
 *
 * 字段名与语义与提取前逐字一致；新增项为**向后兼容的纯增量**：
 *   - `AttachmentRecord` / `AttachmentView` 的注释补充了 SetNull 后的清理中行语义；
 *   - 增量：`AttachmentCleanupBatchResult`（B 的全局清理批次结果）与
 *     `TaskAttachmentLifecyclePort`（业务域删除路径的窄生命周期端口）。
 *   - D 的列表契约为**完整数组**，故不引入列表行数上限常量。
 *
 * 授权语义（随契约一并保留，阅读实现时仍需遵守）：
 * 正式适配器必须现查任务、项目成员、角色与敏感白名单。
 * WRITE 复用 task.progress：PM / 具备该能力的任务负责人可写；其他成员只读。
 * 不可见对象和 outsider 返回 404，不在模块内新增 Action 或角色判断。
 */
export * from '../../shared/attachments.js'
