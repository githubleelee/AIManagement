# B-I22-20261024-main-baseline-01

- 负责人 / GitHub：githubleelee；角色B；Issue：https://github.com/githubleelee/AIManagement/issues/22（本地 #22 的证据准备，不勾该任务完成）
- 工具 / 模型：pi tester（只读全量），实际版本未记录
- agent：b-main-baseline-1024；指令来源：主控；归档者：B主控
- 目标提交：origin/main = 9160587f08f06ee94c35ea09731d6cb0a024b37d（Merge PR #103）；工作区 /home/lee/aim-wt/main-baseline-1024（detached）
- 记录时间：2026-10-24T00:35:00+08:00；日志 /tmp/main-baseline-1024/，归档见 evidence/

## 表 5 摘要

| 序号 | 时间 | AI智能体角色 | 任务场景 | 人类输入摘要 | AI输出要点 | 团队处置及理由 |
|---|---|---|---|---|---|---|
| 1 | 2026-10-24 00:33–00:34（日志时间） | B tester | main 全量基线 | 主控：干净 worktree 跑 typecheck + 全量，如实记录偶发 | typecheck exit 0；vitest 81 文件通过 + 1 跳过 / 1709 通过 + 12 todo / **0 失败**；已知偶发 db-schema-contract 本次通过，无需窄重跑 | 待确认；作为夜间后续合入的对照基线 |

## 命令与证据

| 命令 | exit | 证据 |
|---|---|---|
| npm ci --no-audit --no-fund（392 packages） | 0 | [npm-ci](evidence/B-I22-20261024-main-baseline-npm-ci.txt) |
| npm run db:generate | 0 | [db-generate](evidence/B-I22-20261024-main-baseline-db-generate.txt) |
| npm run typecheck | 0 | [typecheck](evidence/B-I22-20261024-main-baseline-typecheck.txt)（两段 tsc 无输出） |
| npx vitest run | 0 | [vitest-full](evidence/B-I22-20261024-main-baseline-vitest-full.txt) |

## 汇总

    Test Files  81 passed | 1 skipped (82)
         Tests  1709 passed | 12 todo (1721)
      Duration  39.25s

- 唯一跳过文件：src/modules/ai-scheduling/integration.pending.test.ts（12 例，预期待集成，非本批引入）。
- 12 条 todo 为既有占位。
- 已知偶发 test/db-schema-contract.test.ts（29 例）本次 3686ms 通过，未触发 5s 超时，故无窄重跑日志。

## 未做 / 限制

- 未跑 npm run build / build:web（任务只要求 typecheck + 全量测试；构建层另案）。
- 只读：未改文件、未提交、未 push；未触碰项目 var/uploads（测试自建临时 SQLite）。
- 本记录只作 main 基线对照，不代表任何未合入分支（FS 2e0d2f8、附件 902cfa1、通知运行时）已验收。

## 人工复核
- 处置：待确认
