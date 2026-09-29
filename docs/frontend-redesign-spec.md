# 爱管理前端重设计规格

设计源：[Figma · 爱管理前端重设计](https://www.figma.com/design/UpVXlJuQ5bNQSzV0JJnjsh)

画板：桌面概览 `1:2`、移动端概览 `1:3`、桌面需求 `3:2`、桌面任务 `3:46`、桌面成员 `3:104`。画板里的项目数量、日期和姓名仅为视觉示例；实现必须展示真实接口数据。

## Problem Statement

现有前端以暗色外壳和密集表格为主，项目概览难以快速识别下一步工作。窄屏导航和宽表格缺少完整布局。用户需要在不改变已冻结的路由、角色和接口契约的前提下，更清晰地查看项目、需求、任务与成员。

## Solution

将工作台改为浅色内容区和深色项目导航：桌面侧栏固定呈现四个项目入口；窄屏使用底部导航。概览展示真实统计与下一步入口；需求页突出目标→活动→故事层级；任务页突出筛选和状态；成员页突出角色与管理动作。页面统一使用清晰的加载、错误、空数据和权限状态。登录、项目列表、新建项目、需求详情和表单遵循相同视觉规范。

## User Stories

1. As a project member, I want to identify the current project and page, so that I can navigate without losing context.
2. As a project member, I want an overview of real member, story and task counts, so that I can understand current work.
3. As a project member, I want direct links from the overview to requirements and tasks, so that I can continue work quickly.
4. As a project member, I want to browse goals, activities and stories in a legible hierarchy, so that I can find the right story.
5. As a project member, I want to read story details and related tasks, so that requirements and execution remain connected.
6. As a project member, I want to filter and scan tasks by status and owner, so that I can focus on relevant work.
7. As a project manager, I want to add and manage members with clear role controls, so that access matches responsibility.
8. As a viewer, I want the same readable information layout without edit controls, so that my permissions are clear.
9. As a mobile user, I want usable navigation, cards and scrollable data at 320px and 390px widths, so that I can work without horizontal page overflow.
10. As any user, I want loading, empty, failed and unavailable states to be distinct, so that I know whether to retry or create content.
11. As a keyboard or screen reader user, I want labelled controls, visible focus and meaningful headings, so that I can complete the same flows.
12. As a signed-out user, I want the login and redirect flow to remain clear, so that I can reach the intended page after signing in.

## Implementation Decisions

- Keep the current React, TypeScript and Vite stack, route structure, API calls and role checks. Do not alter server contracts.
- Establish visual tokens for background, surface, text, borders, accent, spacing, radius and focus; use Noto Sans SC with system fallbacks.
- Apply the Figma layout to the application shell first, then implement each screen as an independent, usable route.
- Use real API data. The Figma counts and rows are illustrative and must never become hardcoded application content.
- Preserve existing user changes and domain behavior; the redesign changes presentation and interaction clarity.
- On narrow screens, make project navigation reachable without obscuring content; make tables scroll within their container.
- Preserve PM-only write actions and server-side authorization. Confirm destructive actions before sending requests.

## Testing Decisions

- Test externally visible behavior through existing route/API seams, not component internals. Reuse the project’s Vitest setup and manual role walkthrough.
- Verify signed-out redirect, PM/MEMBER/VIEWER controls, real count and list rendering, error versus empty states, and navigation between overview, requirements, tasks and members.
- Verify 320px, 390px and desktop widths by browser inspection; check keyboard focus and accessible names for row actions.
- Run typecheck and build after each slice; run the relevant tests and full suite at integration.

## Out of Scope

- Backend, schema or frozen API contract changes.
- New analytics or AI recommendation features.
- Publishing the frontend or merging the current branch.

## Further Notes

The working tree already contains unrelated and in-progress edits. Agent assignments must use distinct file ownership and retain those edits. Figma is the layout reference; established UI behavior and the interface contract remain authoritative for data and permissions.
