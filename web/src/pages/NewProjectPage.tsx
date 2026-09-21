import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, createProject } from '../api'
import Button from '../components/Button'
import FormField from '../components/FormField'
import PageHeader from '../components/PageHeader'

/** 新建项目（端点 3，T1.1）。创建者自动成为 PM，成功后跳到新项目概览。 */
export default function NewProjectPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const project = await createProject(name, description)
      navigate(`/projects/${project.id}/overview`, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '创建项目失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="新建项目"
        description="创建后你将自动成为该项目的项目经理"
        actions={
          <Link className="link" to="/projects">
            返回列表
          </Link>
        }
      />
      <form className="form narrow" onSubmit={handleSubmit}>
        <FormField label="项目名称（必填，≤50 字）">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="描述（选填）">
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        {error ? <p className="error">{error}</p> : null}
        <Button type="submit" disabled={busy}>
          {busy ? '创建中…' : '创建项目'}
        </Button>
      </form>
    </div>
  )
}

