/** Loopback-only verification entry, not a production route or a replacement backend. */
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import type { ProjectView } from '../../../../src/shared/types'
import { apiFetch } from '../../api'
import { UmlPageContent } from './UmlPage'

function Preview() {
  const projectId = new URLSearchParams(location.search).get('projectId')
  const [project, setProject] = useState<ProjectView | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!projectId) { setError('仅用于独立临时库验证：需要测试项目 ID。'); return }
    const abort = new AbortController()
    void apiFetch<ProjectView>(`/projects/${encodeURIComponent(projectId)}`, { signal: abort.signal })
      .then(value => { if (!abort.signal.aborted) setProject(value) })
      .catch(() => { if (!abort.signal.aborted) setError('无法加载已鉴权的测试项目。') })
    return () => abort.abort()
  }, [projectId])
  return <><p className="uml-notice">真实 API 集成开发入口；只能接独立合成测试库，不代表 B 已挂载正式路由。</p>
    {error ? <p role="alert">{error}</p> : project && projectId ? <UmlPageContent key={projectId} projectId={projectId} project={project} /> : <p>加载测试项目…</p>}
  </>
}
createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><Preview /></BrowserRouter></StrictMode>)
