import { useEffect, useState } from 'react'

/**
 * 应用外壳（T0-01）。
 *
 * 本工单只交付「浏览器能看到应用外壳」：标题、主链路说明与后端健康检查状态。
 * 项目列表 / 层级树 / 任务列表等页面由后续工单在 `web/src/pages/` 下新增。
 */
export default function App() {
  const [health, setHealth] = useState('检查中…')

  useEffect(() => {
    let cancelled = false
    fetch('/health')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<{ status?: string }>
      })
      .then((data) => {
        if (!cancelled) setHealth(data.status === 'ok' ? '正常' : '异常')
      })
      .catch(() => {
        if (!cancelled) setHealth('不可用')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="shell">
      <h1>爱管理（AI Management）</h1>
      <p className="tagline">新一代 AI 驱动的软件项目管理平台</p>
      <p className="flow">项目 → 权限 → 需求 → 任务</p>
      <p className="health">
        后端健康检查：<strong>{health}</strong>
      </p>
    </main>
  )
}
