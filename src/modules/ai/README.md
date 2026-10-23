# US-11 / #31 AI 框架与需求拆解模块

> 2026-10-18 更新：本模块已按共享“建议 + 处置”决策扩展；原需求拆分逻辑保留。
> 最新接口源见 `docs/role-d/ROLE-D-US11-interface-protocol.md`，旧的首批最小提案仅作历史追溯。

本目录是 Issue #31 的角色 D 独立交付区。当前实现包含：

- 可供需求拆分、排期、质量/进度/风险/效率分析复用的模型端口与共享记录草案；
- 携带项目、操作者、来源对象和数据分类的最小调用上下文；
- 本地确定性 Stub，不读取密钥、不访问网络；
- 显式 `LOCAL_STUB / EXTERNAL` 工厂选择，配置不一致时失败且不静默回退；
- 需求拆解建议生成、结构校验、人工采纳/修改/拒绝；
- 输入范围/统计基数、snapshot/fingerprint、模型 mode/version、生成失败、唯一最终处置与应用结果；
- 同 actor + requestId + digest 的重放、异请求冲突及最小采纳质量统计；
- 独立 Fastify 路由插件和接口测试；
- 敏感需求默认拒绝进入 AI 上下文；
- 仅显式 `SYNTHETIC_DEMO` 数据允许外部 API；持久化项目数据默认拒绝外发；
- 模型返回后、写入建议记录前重新鉴权；服务入口独立校验人工处置输入；
- 外部端口的结构无效/数据策略错误映射为 422，其余服务异常继续由统一出口脱敏。

## 当前真实状态

ROLE-B 已完成公共数据库仓储、权限适配、app 组装和正式路由注册；当前运行模式仍是
`LOCAL_STUB`。外部模型供应商尚未确定，未配置显式外部适配器时禁止静默切换。
`InMemoryAiSuggestionRepository` 仅保留为模块测试夹具，不是正式持久化实现。

首批给 ROLE-B 的最小端口提案见
`docs/role-d/US11-minimal-ai-port-proposal.md`。该提案只覆盖 #31；#37 事件端口不在
本分支范围内，不以空壳或 mock 冒充已经交付。

## 接口草案

| 方法 | 路径 | 行为 |
|---|---|---|
| POST | `/projects/:projectId/stories/:storyId/ai-suggestions` | 生成建议，不写正式任务 |
| GET | `/projects/:projectId/stories/:storyId/ai-suggestions` | 查询建议与处置记录 |
| POST | `/projects/:projectId/stories/:storyId/ai-suggestions/:suggestionId/disposition` | 采纳、修改后采纳或拒绝 |

旧 `/review` 别名已经删除，唯一人工处置入口为 `/disposition`。

“正式应用”没有公开 HTTP 端点。原因是负责人尚未确认应用目标是任务、故事还是验收标准；
服务只预留 `recordApplicationResult()`，避免角色 D 自行拍定业务规则。
