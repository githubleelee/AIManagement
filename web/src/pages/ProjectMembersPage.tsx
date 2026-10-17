import { useEffect, useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { ProjectMemberView, ProjectRole, ProjectView, UserBrief } from '../../../src/shared/types'
import { ApiError, addMember, listMemberCandidates, listMembers, removeMember, updateMemberRole } from '../api'
import { useAuth } from '../auth/AuthContext'
import Button from '../components/Button'
import ConfirmDialog from '../components/ConfirmDialog'
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
  const [showAdd, setShowAdd] = useState(false)
  const [candidates, setCandidates] = useState<UserBrief[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [candidatesError, setCandidatesError] = useState(false)
  const [adding, setAdding] = useState(false)
  const [changingId, setChangingId] = useState<string | null>(null)
  const [pendingRemove, setPendingRemove] = useState<ProjectMemberView | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    setError(null)
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

  useEffect(() => {
    if (!isPm || !showAdd) return
    let active = true
    setCandidatesLoading(true)
    void listMemberCandidates(project.id)
      .then(result => { if (active) { setCandidates(result.items); setCandidatesError(false) } })
      .catch(() => { if (active) { setCandidates([]); setCandidatesError(true) } })
      .finally(() => { if (active) setCandidatesLoading(false) })
    return () => { active = false }
  }, [isPm, showAdd, project.id])

  async function handleAdd(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setAdding(true)
    try {
      await addMember(project.id, account, role)
      setAccount('')
      await refresh()
      setShowAdd(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '添加成员失败')
    } finally {
      setAdding(false)
    }
  }

  async function handleRoleChange(userId: string, next: ProjectRole) {
    setError(null)
    setChangingId(userId)
    try {
      await updateMemberRole(project.id, userId, next)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '修改角色失败')
    } finally {
      setChangingId(null)
    }
  }

  async function handleRemove(userId: string) {
    setError(null)
    setRemovingId(userId)
    try {
      await removeMember(project.id, userId)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '移除成员失败')
    } finally {
      setRemovingId(null)
    }
  }

  const columns: Column<ProjectMemberView>[] = [
    { key: 'name', header: '成员', render: (m) => <span className="member-identity"><span className="member-avatar" aria-hidden="true">{m.user.displayName.slice(0, 1)}</span><strong>{m.user.displayName}</strong></span> },
    { key: 'account', header: '账号', render: (m) => m.user.account },
    {
      key: 'role',
      header: '项目角色',
      render: (m) =>
        isPm ? (
          <select
            value={m.role}
            aria-label={`修改 ${m.user.displayName} 的角色`}
            disabled={removingId === m.userId || changingId !== null}
            onChange={(e) => handleRoleChange(m.userId, e.target.value as ProjectRole)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        ) : (
          <span className="role-pill">{ROLE_LABELS[m.role]}</span>
        ),
    },
    {
      key: 'joinedAt',
      header: '加入时间',
      render: (m) => new Date(m.joinedAt).toLocaleDateString(),
    },
    {
      key: 'actions',
      header: '操作',
      render: (m) =>
        isPm && m.userId !== user?.id ? (
          <Button
            variant="ghost"
            aria-label={`移除成员 ${m.user.displayName}`}
            disabled={removingId !== null || changingId !== null}
            onClick={() => setPendingRemove(m)}
          >
            {removingId === m.userId ? '移除中…' : '移除'}
          </Button>
        ) : null,
    },
  ]

  return (
    <div className="page members-page">
      <PageHeader
        title="成员"
        description="管理协作角色与项目可见范围。"
      />

      <section className="surface-card members-panel" aria-labelledby="members-title">
        <div className="members-panel-head">
          <div><h3 id="members-title">项目成员</h3><p className="muted">{loading ? '正在加载成员…' : `${members.length} 位成员`} · 只有项目经理可以调整角色</p></div>
          {isPm ? <Button type="button" onClick={() => setShowAdd((value) => !value)} aria-expanded={showAdd} aria-controls="add-member-form">{showAdd ? '取消添加' : '＋ 添加成员'}</Button> : null}
        </div>

      {error ? <p className="error" role="alert">{error}</p> : null}

      {isPm && showAdd ? (
        <form id="add-member-form" className="form inline members-add-form" onSubmit={handleAdd}>
          <div className="member-account-picker">
            <FormField label="账号">
              <input value={account} required autoComplete="off" onChange={(e) => setAccount(e.target.value)} aria-describedby="member-candidates-help" />
            </FormField>
            <div className="member-candidates" id="member-candidates-help">
              <span className="muted">可添加的用户名</span>
              {candidatesLoading ? <p className="req-hint">正在加载用户名…</p> : candidatesError ? <p className="req-hint">用户名列表加载失败，仍可手动输入账号。</p> :
                candidates.length === 0 ? <p className="req-hint">暂无可添加的账号。</p> :
                  <div className="member-candidate-list">
                    {candidates.filter(candidate => `${candidate.account} ${candidate.displayName}`.toLowerCase().includes(account.trim().toLowerCase())).map(candidate => (
                      <button key={candidate.id} type="button" className="member-candidate" onClick={() => setAccount(candidate.account)}>
                        <strong>{candidate.account}</strong><span>{candidate.displayName}</span>
                      </button>
                    ))}
                  </div>}
            </div>
          </div>
          <FormField label="角色">
            <select value={role} onChange={(e) => setRole(e.target.value as ProjectRole)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </FormField>
          <Button type="submit" disabled={adding}>{adding ? '添加中…' : '确认添加'}</Button>
        </form>
      ) : null}

      {loading ? (
        <p className="state-message muted">加载中…</p>
      ) : (
        <DataTable
          columns={columns}
          rows={members}
          rowKey={(m) => m.userId}
          empty={<span className="muted">暂无成员</span>}
        />
      )}
      </section>

      {pendingRemove ? (
        <ConfirmDialog
          title="确认移除该成员？"
          confirmText="确认移除"
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => {
            const target = pendingRemove.userId
            setPendingRemove(null)
            void handleRemove(target)
          }}
        >
          <dl className="req-fields">
            <dt>姓名</dt>
            <dd>{pendingRemove.user.displayName}</dd>
            <dt>账号</dt>
            <dd>{pendingRemove.user.account}</dd>
          </dl>
          <p className="req-hint member-remove-warning">
            移除后该成员将失去本项目的访问权限。
          </p>
        </ConfirmDialog>
      ) : null}
    </div>
  )
}
