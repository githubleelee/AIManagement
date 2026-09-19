import { useEffect, useState, type FormEvent } from 'react'
import type { ProjectMemberView, ProjectRole, ProjectView, UserBrief } from '../../../src/shared/types'
import { ApiError, addMember, getProject, listMembers, removeMember, updateMemberRole } from '../api'
import { ROLE_LABELS } from '../labels'

const ROLES: ProjectRole[] = ['PM', 'MEMBER', 'VIEWER']

/** 项目详情 + 成员管理（端点 5/6/7/8/9）。仅 PM 可见写操作入口，服务端仍强制校验。 */
export default function ProjectDetailPage({
  projectId,
  currentUser,
  onBack,
}: {
  projectId: string
  currentUser: UserBrief
  onBack: () => void
}) {
  const [project, setProject] = useState<ProjectView | null>(null)
  const [members, setMembers] = useState<ProjectMemberView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [account, setAccount] = useState('')
  const [role, setRole] = useState<ProjectRole>('MEMBER')

  async function refresh() {
    setLoading(true)
    try {
      const [projectRes, membersRes] = await Promise.all([
        getProject(projectId),
        listMembers(projectId),
      ])
      setProject(projectRes)
      setMembers(membersRes.items)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载项目失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [projectId])

  const isPm = project?.myRole === 'PM'

  async function handleAdd(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await addMember(projectId, account, role)
      setAccount('')
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '添加成员失败')
    }
  }

  async function handleRoleChange(userId: string, next: ProjectRole) {
    setError(null)
    try {
      await updateMemberRole(projectId, userId, next)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '修改角色失败')
    }
  }

  async function handleRemove(userId: string) {
    setError(null)
    try {
      await removeMember(projectId, userId)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '移除成员失败')
    }
  }

  if (loading) {
    return (
      <main className="shell">
        <p className="muted">加载中…</p>
      </main>
    )
  }

  return (
    <main className="shell wide">
      <header className="topbar">
        <div>
          <h1>{project?.name ?? '项目'}</h1>
          <p className="tagline">
            {project?.description ?? '无描述'}
            {project ? ` · 我的角色：${ROLE_LABELS[project.myRole]}` : ''}
          </p>
        </div>
        <button className="ghost" onClick={onBack}>
          返回项目列表
        </button>
      </header>

      {error ? <p className="error">{error}</p> : null}

      <section>
        <h2>成员（{members.length}）</h2>

        {isPm ? (
          <form className="form inline" onSubmit={handleAdd}>
            <input
              placeholder="账号"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            />
            <select value={role} onChange={(e) => setRole(e.target.value as ProjectRole)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <button type="submit">添加成员</button>
          </form>
        ) : null}

        <table className="table">
          <thead>
            <tr>
              <th>姓名</th>
              <th>账号</th>
              <th>角色</th>
              <th>加入时间</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.userId}>
                <td>{member.user.displayName}</td>
                <td>{member.user.account}</td>
                <td>
                  {isPm ? (
                    <select
                      value={member.role}
                      onChange={(e) =>
                        handleRoleChange(member.userId, e.target.value as ProjectRole)
                      }
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    ROLE_LABELS[member.role]
                  )}
                </td>
                <td>{new Date(member.joinedAt).toLocaleString()}</td>
                <td>
                  {isPm && member.userId !== currentUser.id ? (
                    <button className="ghost" onClick={() => handleRemove(member.userId)}>
                      移除
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  )
}
