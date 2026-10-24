import {createRoot} from 'react-dom/client'
import TaskAttachmentPanel from './TaskAttachmentPanel'
import '../../index.css'
const fixture=await fetch('/status-regression-fixture.json').then(r=>r.json())
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:1000,margin:'40px auto',padding:24}}>
<h1>附件错误提示回归</h1><p>独立组件 + B候选真实HTTP，全部合成数据；外部账号应404，错误出现后不再显示加载提示。此页不是正式TaskSection挂载。</p>
<TaskAttachmentPanel taskId={fixture.taskId} canWrite={false}/></main>)
