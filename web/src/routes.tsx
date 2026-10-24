import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import AppLayout from './layouts/AppLayout'
import ProjectLayout from './layouts/ProjectLayout'
import LoginPage from './pages/LoginPage'
import NewProjectPage from './pages/NewProjectPage'
import NotFoundPage from './pages/NotFoundPage'
import ProjectListPage from './pages/ProjectListPage'
import ProjectMembersPage from './pages/ProjectMembersPage'
import ProjectOverviewPage from './pages/ProjectOverviewPage'
import ProjectRequirementsPage from './pages/ProjectRequirementsPage'
import ProjectTasksPage from './pages/ProjectTasksPage'
import RequirementDetailPage from './pages/RequirementDetailPage'
import RequirementHierarchyDetailPage from './pages/RequirementHierarchyDetailPage'
import NewRequirementPage from './pages/NewRequirementPage'
import WorkbenchPage from './pages/workbench/WorkbenchPage'
import WorkbenchListPage from './pages/workbench/WorkbenchListPage'
import AcceptancePage from './pages/acceptance/AcceptancePage'
import WorkloadPage from './pages/workload/WorkloadPage'
import DashboardPage from './pages/analytics/DashboardPage'
import RiskPage from './pages/risk/RiskPage'
import GanttPage from './pages/gantt/GanttPage'
import BoardPage from './pages/board/BoardPage'
import UmlPage from './pages/uml/UmlPage'
import ProjectSchedulingPage from './pages/scheduling/ProjectSchedulingPage'

/**
 * 路由表（见 docs/frontend-routes.md，冻结）。
 * 骨架归 M2（US-01）独占；其他模块只往 pages/ 加页面并在此挂载。
 */
export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/projects" element={<ProjectListPage />} />
          <Route path="/projects/new" element={<NewProjectPage />} />
          {/* US-08 个人工作台（工单 #28）：跨项目的个人视角，故挂在顶层而非项目空间内 */}
          <Route path="/workbench" element={<WorkbenchPage />} />
          <Route path="/workbench/:blockKey" element={<WorkbenchListPage />} />

          <Route path="/projects/:projectId" element={<ProjectLayout />}>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<ProjectOverviewPage />} />
            <Route path="requirements" element={<ProjectRequirementsPage />} />
            <Route path="requirements/new/goal" element={<NewRequirementPage kind="goal" />} />
            <Route path="requirements/goals/:goalId/new-activity" element={<NewRequirementPage kind="activity" />} />
            <Route path="requirements/activities/:activityId/new-story" element={<NewRequirementPage kind="story" />} />
            <Route path="requirements/goals/:goalId" element={<RequirementHierarchyDetailPage kind="goal" />} />
            <Route path="requirements/activities/:activityId" element={<RequirementHierarchyDetailPage kind="activity" />} />
            <Route path="requirements/:storyId" element={<RequirementDetailPage />} />
            <Route path="tasks" element={<ProjectTasksPage />} />
            {/* US-09 任务验收（工单 #29）：项目内的验收工作台，入口在左导航 */}
            <Route path="acceptance" element={<AcceptancePage />} />
            {/* US-07 成员任务图与负载（工单 #27）：项目内的只读负载总览，入口在左导航 */}
            <Route path="workload" element={<WorkloadPage />} />
            {/* US-10 进度/健康度（工单 #30）：项目仪表盘与风险台账，入口在左导航 */}
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="risks" element={<RiskPage />} />
            {/* US-06 甘特图（工单 #26）：需求 / 任务 / 里程碑与 FS 依赖统一时间轴，入口在左导航 */}
            <Route path="gantt" element={<GanttPage />} />
            {/* US-04 故事看板（工单 #25）：三列看板；PM 可在卡片调整状态（唯一写路径端点 21），MEMBER / VIEWER 只读（C11 已裁定不扩权），入口在左导航 */}
            <Route path="board" element={<BoardPage />} />
            {/* US-15 UML（工单 #35）：用例图 / 时序图编辑与关联；写权限 uml.write 仅 PM，受限图对非 PM 404，入口在左导航 */}
            <Route path="uml" element={<UmlPage />} />
            <Route path="scheduling" element={<ProjectSchedulingPage />} />
            <Route path="members" element={<ProjectMembersPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
