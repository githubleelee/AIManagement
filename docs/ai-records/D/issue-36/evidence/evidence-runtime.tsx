import { createRoot } from 'react-dom/client'
import TaskAttachmentPanel from './TaskAttachmentPanel'
import { apiFetch } from '../../api'
import '../../index.css'

const fixture = await fetch('/attachment-evidence-fixture.json').then(r=>r.json())
const me = await apiFetch<{id:string;displayName:string}>('/auth/me')
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:1000,margin:'40px auto',padding:24,fontFamily:'sans-serif'}}>
  <h1>任务附件 · 独立组件联调</h1>
  <p style={{padding:16,background:'#fff4cc'}}>证据环境：B 公共接入候选分支 + 最新 main + D 修复。使用真实迁移 SQLite / HTTP / 磁盘，全部为合成数据。</p>
  <p>当前账号：{me.displayName}。本页仅验证已交付组件，<strong>不代表正式 TaskSection 挂载或任务删除联动已经完成</strong>。</p>
  <TaskAttachmentPanel taskId={fixture.taskId} canWrite={fixture.writerIds.includes(me.id)}/>
</main>)
