/**
 * 前端 API 封装（US-01 前端壳）
 *
 * - 令牌存 localStorage，刷新后仍可保持登录（T0-04 验收：刷新保持登录）
 * - 统一带 Authorization: Bearer；失败时把契约的 ErrorResponse 转成 ApiError
 * - 类型从后端共享定义引入（只引类型，构建时被擦除，不打包后端代码）
 */
import type {
  Project,
  ProjectMemberView,
  ProjectRole,
  ProjectView,
  UserBrief,
} from '../../src/shared/types'

const TOKEN_KEY = 'aim.token'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Array<{ field: string; code: string }>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  // 统一走 /api 前缀：SPA 的路由（/projects/:id/...）与后端契约路径（/projects）同名，
  // 若直接代理会劫持前端深链。Vite 只代理 /api 并 rewrite 去掉前缀，后端路径保持契约不变。
  const res = await fetch(`/api${path}`, { ...init, headers })
  if (res.status === 204) return undefined as T

  const text = await res.text()
  const data: unknown = text ? JSON.parse(text) : undefined

  if (!res.ok) {
    const error = (data as { error?: { code?: string; message?: string; details?: ApiError['details'] } })
      ?.error
    throw new ApiError(
      res.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? '请求失败',
      error?.details,
    )
  }
  return data as T
}

export function login(account: string, password: string) {
  return apiFetch<{ token: string; user: UserBrief }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account, password }),
  })
}

export function fetchMe() {
  return apiFetch<UserBrief>('/auth/me')
}

export function listProjects() {
  return apiFetch<{ items: ProjectView[] }>('/projects')
}

export function getProject(projectId: string) {
  return apiFetch<ProjectView>(`/projects/${projectId}`)
}

export function createProject(name: string, description: string) {
  return apiFetch<Project>('/projects', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  })
}

export function listMembers(projectId: string) {
  return apiFetch<{ items: ProjectMemberView[] }>(`/projects/${projectId}/members`)
}

export function addMember(projectId: string, account: string, role: ProjectRole) {
  return apiFetch<ProjectMemberView>(`/projects/${projectId}/members`, {
    method: 'POST',
    body: JSON.stringify({ account, role }),
  })
}

export function updateMemberRole(projectId: string, userId: string, role: ProjectRole) {
  return apiFetch<ProjectMemberView>(`/projects/${projectId}/members/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  })
}

export function removeMember(projectId: string, userId: string) {
  return apiFetch<void>(`/projects/${projectId}/members/${userId}`, { method: 'DELETE' })
}
