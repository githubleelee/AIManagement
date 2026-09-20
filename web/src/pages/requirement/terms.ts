/**
 * US-03（M4）需求层级 —— 界面标签 + 术语对照表
 *
 * 分两部分：
 *   1. **界面标签**（决策 I-1：线上英文常量 ↔ 界面中文标签）。中文标签只出现在 JSX，
 *      绝不进入请求体；`<option value>` 一律用「_ORDER」里的线上常量。
 *   2. **术语对照与缺口清单**：把「平台用词 / 线上字段 / 实验指导书用词 / PMBOK 用词」
 *      四方摆在界面上，并把**已知缺口**显式列出来。这样评审问"你们到底懂不懂 PMBOK"
 *      时，页面上直接有答案——而不是靠口头解释。
 *
 * ⚠️ 关于「为什么不直接把词改成 PMBOK 的」：实验二指导书的评分口径是 **Scrum**
 *   （Sprint 出现 127 次、DoD 28 次），只改成 PMBOK 词又会与实验二对不上。
 *   因此采用**双标签**（PMBOK 词 + 括注原有词），两边都能对上。
 *   详见 `实验\_US-03_前端发现的问题.md` 第 2 节。
 *
 * ⚠️ 优先级**不做改写**：指导书要求 MoSCoW，而契约冻结的线上值是 P0/P1/P2，
 *   两者对应关系（3 档 vs 4 档）**没有依据**，因此界面照实显示 P0/P1/P2，
 *   把差异放进术语对照表当作「待团队确认」，**不自行发明映射**。
 */
import type {
  FieldErrorCode,
  GoalStatus,
  Priority,
  StoryStatus,
} from '../../../../src/shared/types'

// ---------------------------------------------------------------------------
// 一、界面标签（决策 I-1）
//
// 用 `Record<GoalStatus, string>` 这类标注，使「契约新增/删除枚举取值」变成一次
// **编译期失败**，而不是界面上少显示一个选项。
//
// ⚠️ `GOAL_STATUS_LABEL` 与 `STORY_STATUS_LABEL` 是**两张独立的表**：决策 I-1 明说
//   GoalStatus / StoryStatus / TaskStatus 都有 `DONE` 但语义不同、互相不可赋值。
//   共用一张表就是让"三个 DONE 被当成同一个东西"的第一步。
// ---------------------------------------------------------------------------

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  ACTIVE: '进行中',
  DONE: '已完成',
}

/** 目标 / 活动的状态选项（线上常量，供 `<option value>` 使用）。 */
export const GOAL_STATUS_ORDER: readonly GoalStatus[] = ['ACTIVE', 'DONE']

export const STORY_STATUS_LABEL: Record<StoryStatus, string> = {
  DRAFT: '待规划',
  PLANNING: '规划中',
  DONE: '已完成',
}

/** 故事状态选项。注意 `DONE` 与 `GOAL_STATUS_ORDER` 里的 `DONE` **不是一个东西**。 */
export const STORY_STATUS_ORDER: readonly StoryStatus[] = ['DRAFT', 'PLANNING', 'DONE']

export const PRIORITY_LABEL: Record<Priority, string> = { P0: 'P0', P1: 'P1', P2: 'P2' }

export const PRIORITY_ORDER: readonly Priority[] = ['P0', 'P1', 'P2']

/** 字段级错误码 → 中文提示（决策 I-4 的 `details[].code`）。 */
export const FIELD_ERROR_HINT: Record<FieldErrorCode, string> = {
  REQUIRED: '必填缺失或纯空白',
  TOO_LONG: '超出长度上限',
  INVALID_FORMAT: '格式非法',
  INVALID_VALUE: '取值非法',
  DUPLICATE: '唯一性冲突（已存在）',
  USER_NOT_FOUND: '账号对应的用户不存在',
  NOT_PROJECT_MEMBER: '不是本项目成员',
  ACCEPTOR_EQUALS_OWNER: '验收人与负责人不能是同一人',
  END_BEFORE_START: '计划结束早于计划开始',
  INSUFFICIENT_MEMBERS: '项目成员不足 2 人，无法满足验收独立性',
  SELF_REMOVAL_FORBIDDEN: '不能移除自己',
  LAST_PM: '不能移除或降级最后一个项目经理',
  CROSS_PROJECT_REF: '引用了其它项目的对象',
  HAS_CHILDREN: '仍有下级对象，请先处理子项',
}

/**
 * 查表取字段级提示。
 *
 * 表按 `Record<string, string | undefined>` 暴露，是为了让「后端返回了契约 I-4
 * 之外的 code」这条路径在类型上成立，而不必写 `as FieldErrorCode` 去骗编译器。
 */
const FIELD_ERROR_HINT_TABLE: Readonly<Record<string, string | undefined>> = FIELD_ERROR_HINT

export function fieldErrorHint(code: string): string {
  return FIELD_ERROR_HINT_TABLE[code] ?? `${code}（契约 I-4 之外的字段级错误码）`
}

// ---------------------------------------------------------------------------
// 二、术语对照（四方）
// ---------------------------------------------------------------------------

export type TermRow = {
  /** 平台界面现在用的词 */
  ui: string
  /** 冻结的线上字段名（不改） */
  field: string
  /** 实验一指导书里的用词 */
  guide: string
  /** PMBOK 常用词 */
  pmbok: string
  /** 建议的显示方式 */
  suggest: string
  /** 是否建议改界面文案 */
  change: 'dual' | 'keep'
}

export const TERM_ROWS: readonly TermRow[] = [
  {
    ui: '业务目标',
    field: 'BusinessGoal',
    guide: '（未提，团队自加）',
    pmbok: '业务 / 效益目标（business objective, benefits）',
    suggest: '业务目标（保持），由本表标注其 PMBOK 对应物',
    change: 'keep',
  },
  {
    ui: '用户活动',
    field: 'UserActivity',
    guide: '骨干活动（指导书第 113 行）',
    pmbok: '「活动」在 PMBOK 属进度管理（定义活动），语义不同，不宜直接套用',
    suggest: '骨干活动（用户活动）',
    change: 'dual',
  },
  {
    ui: '用户故事',
    field: 'UserStory',
    guide: '用户任务 / 用户故事',
    pmbok: '需求（Requirement）',
    suggest: '需求（用户故事）',
    change: 'dual',
  },
  {
    ui: '任务',
    field: 'Task',
    guide: '任务',
    pmbok: '工作包（WBS 最底层）/ 活动',
    suggest: '任务（保持），由本表标注对应「工作包」',
    change: 'keep',
  },
  {
    ui: '优先级',
    field: 'Priority = P0 | P1 | P2',
    guide: 'MoSCoW（Must / Should / Could / Won’t）',
    pmbok: '无强制方案（PMBOK 未规定优先级取值）',
    suggest: '照实显示 P0/P1/P2；对应关系见下方缺口清单（待团队确认，不自行发明）',
    change: 'keep',
  },
  {
    ui: '需求层级树',
    field: '（无独立字段）',
    guide: '用户故事地图（User Story Map）',
    pmbok: '需求跟踪矩阵（RTM）/ WBS — 平台均未实现',
    suggest: '需求层级（用户故事地图）',
    change: 'dual',
  },
  {
    ui: '业务价值',
    field: 'businessValue',
    guide: '（未提）',
    pmbok: '效益（benefits）',
    suggest: '业务价值（效益）',
    change: 'dual',
  },
]

// ---------------------------------------------------------------------------
// 三、已知缺口清单
//
// 每一条都是"实验一自己的交付文件里承诺过、但平台没有对应结构"的东西。
// 显式列出来比藏着好：评审能看到我们**知道自己缺什么**。
// ---------------------------------------------------------------------------

export type GapRow = {
  /** 缺口 */
  gap: string
  /** 出处（实验一产出的行号 / 契约条文） */
  source: string
  /** 影响 */
  impact: string
  /** 建议处置 */
  plan: string
}

export const GAP_ROWS: readonly GapRow[] = [
  {
    gap: '需求来源 / 干系人',
    source: 'PMBOK 需求跟踪矩阵（RTM）的必备列；契约 I-2 的 UserStory 无此字段',
    impact: '无法回答「这条需求是谁提的」，追溯链只有"挂在哪个目标下"，缺源头',
    plan: 'Sprint 2 走契约变更流程补字段（需技术负责人单人修改冻结件）',
  },
  {
    gap: '验证方法 / 验收结论',
    source: 'PMBOK 5.5 确认范围；契约 I-2 只有 acceptanceCriteria 文本',
    impact: '有验收标准，但无「谁来验、验没验过、结论是什么」，验收不可追溯',
    plan: 'Sprint 2 评估；当前界面显示 acceptanceCriteria 原文',
  },
  {
    gap: 'WBS / 工作包',
    source: '团队实验一产出（`…总1.1.docx` 第 984 行）要求「故事地图与 WBS 保持一致」；WBS 在该产出中出现 11 次',
    impact: '「用户活动」是用户行为（动词），不是可交付成果（名词），结构上无法与 WBS 对应',
    plan: '不在 Sprint 1 动层级（会推翻已合入 main 的 US-03 后端）；Sprint 2 评估以外部引用方式关联',
  },
  {
    gap: '需求—任务—测试—验收 追踪表（即 RTM）',
    source: '团队实验一产出第 1431 行行动项 A09（团队自己提出）',
    impact: '需求到验收的链路断在"故事"这一层；任务属 M5、测试与验收未建模',
    plan: 'Sprint 2 联合 M5 一起做（任务层贡献"任务→测试→验收"三段）',
  },
  {
    gap: '变更痕迹（谁改的、改前改后）',
    source: '`AuditLog` 表已建（契约 I-7），端点属 T2.8，界面无入口',
    impact: '需求变更无留痕，PMBOK 的"变更控制"无法体现',
    plan: '待 T2.8 交付后接界面',
  },
  {
    gap: 'MoSCoW ↔ P0/P1/P2 的对应关系',
    source: '实验一指导书第 113/154/333 行要求 MoSCoW；契约冻结 Priority = P0|P1|P2（两套档位数不同）',
    impact: '界面按 P0/P1/P2 显示，与指导书用词不一致',
    plan: '**待团队明文确认对应关系**；本期不自行发明，也不改线上枚举值',
  },
]
