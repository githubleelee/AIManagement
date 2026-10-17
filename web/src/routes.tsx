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
            <Route path="members" element={<ProjectMembersPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
