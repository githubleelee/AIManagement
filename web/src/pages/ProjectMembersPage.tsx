import { useEffect, useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { ProjectMemberView, ProjectRole, ProjectView } from '../../../src/shared/types'
import { ApiError, addMember, listMembers, removeMember, updateMemberRole } from '../api'
import { useAuth } from '../auth/AuthContext'
import Button from '../components/Button'
import DataTable, { type Column } from '../components/DataTable'
import FormField from '../components/FormField'
import PageHeader from '../components/PageHeader'
import { ROLE_LABELS } from '../labels'

const ROLES: ProjectRole[] = ['PM', 'MEMBER', 'VIEWER']

/** 成员管理（端点 6–9，T1.3–T1.6）。仅 PM 显示写操作入口；服务端仍强制校验。 */
export default function ProjectMembersPage() {
  const project = useOutletContext<ProjectView>()
  const { user } = useAuth()
  const isPm = project.myRole === 'PM'

  const [members, setMembers] = useState<ProjectMemberView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [account, setAccount] = useState('')
  const [role, setRole] = useState<ProjectRole>('MEMBER')

  async function refresh() {
    setLoading(true)
    try {
      const res = await listMembers(project.id)
      setMembers(res.items)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载成员失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [project.id])

  async function handleAdd(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await addMember(project.id, account, role)
      setAccount('')
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '添加成员失败')
    }
  }

  async function handleRoleChange(userId: string, next: ProjectRole) {
    setError(null)
    try {
      await updateMemberRole(project.id, userId, next)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '修改角色失败')
    }
  }

  async function handleRemove(userId: string) {
    setError(null)
    try {
      await removeMember(project.id, userId)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '移除成员失败')
    }
  }

  const columns: Column<ProjectMemberView>[] = [
    { key: 'name', header: '姓名', render: (m) => m.user.displayName },
    { key: 'account', header: '账号', render: (m) => m.user.account },
    {
      key: 'role',
      header: '角色',
      render: (m) =>
        isPm ? (
          <select
            value={m.role}
            onChange={(e) => handleRoleChange(m.userId, e.target.value as ProjectRole)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        ) : (
          ROLE_LABELS[m.role]
        ),
    },
    {
      key: 'joinedAt',
      header: '加入时间',
      render: (m) => new Date(m.joinedAt).toLocaleString(),
    },
    {
      key: 'actions',
      header: '',
      render: (m) =>
        isPm && m.userId !== user?.id ? (
          <Button variant="ghost" onClick={() => handleRemove(m.userId)}>
            移除
          </Button>
        ) : null,
    },
  ]

  return (
    <div className="page">
      <PageHeader
        title="成员"
        description={isPm ? '添加成员、调整角色或移除成员' : '只读：只有项目经理可以管理成员'}
      />

      {error ? <p className="error">{error}</p> : null}

      {isPm ? (
        <form className="form inline" onSubmit={handleAdd}>
          <FormField label="账号">
            <input value={account} onChange={(e) => setAccount(e.target.value)} />
          </FormField>
          <FormField label="角色">
            <select value={role} onChange={(e) => setRole(e.target.value as ProjectRole)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </FormField>
          <Button type="submit">添加成员</Button>
        </form>
      ) : null}

      {loading ? (
        <p className="muted">加载中…</p>
      ) : (
        <DataTable
          columns={columns}
          rows={members}
          rowKey={(m) => m.userId}
          empty={<span className="muted">暂无成员</span>}
        />
      )}
    </div>
  )
}
