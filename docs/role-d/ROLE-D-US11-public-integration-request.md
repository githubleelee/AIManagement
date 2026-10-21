# ROLE-D → ROLE-B：#31 公共接入申请

接口核对源：`docs/role-d/ROLE-D-US11-interface-protocol.md`。

请 ROLE-B 按公共文件单写规则分批完成：

1. 从 `src/modules/ai/contracts.ts` 提取公共模型端口、建议记录、查询、处置和统计类型；
2. 加入统一建议 Action，处置动作仅 PM，A/C 不各建重复 Action；
3. 落一套共享建议/处置表，保存输入范围、基数、快照、模型追溯、不可变原建议、唯一最终处置、
   人工修改与应用结果；
4. 数据库适配器接受调用方事务上下文，不自行提前提交；
5. 使用 CAS 或唯一约束保护唯一最终处置；先读取归属元数据、统一鉴权后再读取正文；
6. 在 `src/app.ts` 显式注入模型 adapter、建议仓储、权限与源数据端口，并注册模块路由；
7. 由需求页 owner 最小挂载 `web/src/pages/ai/AiBreakdownPanel.tsx`。

需要 B/A/C 核对：

- 处置请求身份采用 `project + suggestion + actor + requestId + normalized digest`；
- 同 actor、同 requestId、同 digest 才是重放，不同 actor 不视为同一请求；
- 生成结束后重新鉴权保存；处置重试先鉴权；确认不再次调用模型；
- 来源过期、人工拒绝、应用失败保持不同状态；
- 正式业务写入、最终处置、应用结果和成功审计由调用方放入同一事务。

本申请不授权 ROLE-D 修改 `src/shared/*`、schema/迁移、authz、`src/app.ts`、`src/routes.ts` 或
前端公共骨架，也不表示公共接入已完成。
