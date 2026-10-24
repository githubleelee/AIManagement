import {createRoot} from 'react-dom/client'
import NotificationBell from './NotificationBell'
import '../../index.css'
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:1000,margin:'40px auto',padding:24,fontFamily:'sans-serif'}}>
<h1>站内通知 · 实际接入阻断走查</h1>
<p style={{background:'#fff4cc',padding:16}}>后端为当前 main 的原始生产 buildApp；本页仅渲染 D 独立组件，不注入模拟通知接口或模拟事件。</p>
<p>本页用于记录真实接口未注册时的表现，<strong>不是六类通知送达验收通过证据</strong>。</p>
<NotificationBell/>
</main>)
