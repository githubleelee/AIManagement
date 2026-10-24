import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {createTestContext,TEST_PASSWORD} from '../../../../../test/helpers.js'
import {makeUser,makeProject,makeMember,makeGoal,makeActivity,makeStory} from '../../../../../test/factories.js'
import {chromium} from '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import binary from '/tmp/aim-browser-runtime/node_modules/@sparticuz/chromium/build/index.js'

const ctx=await createTestContext()
const pm=await makeUser('notice.pm','通知联调PM'),owner=await makeUser('notice.owner','通知联调成员')
const {projectId}=await makeProject(pm.id,'D通知真实接入诊断（合成数据）')
await makeMember(projectId,owner.id,'MEMBER')
const storyId=await makeStory(await makeActivity(await makeGoal(projectId)),{title:'通知真实生产诊断'})
await ctx.app.listen({port:3134,host:'127.0.0.1'})
const base='http://127.0.0.1:3134'
const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:'notice.pm',password:TEST_PASSWORD})})
assert.equal(login.status,200);const {token}=await login.json() as {token:string}
const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'}
const created=await fetch(base+`/stories/${storyId}/tasks`,{method:'POST',headers,body:JSON.stringify({title:'真实分配触发诊断',ownerUserId:owner.id,acceptorUserId:pm.id,planStart:'2026-10-23',planEnd:'2026-10-24'})})
assert.equal(created.status,201)
const calls=[]
for(const [method,path] of [['GET','/me/notifications'],['GET','/notifications/unknown'],['PATCH','/notifications/unknown/read']]){
const r=await fetch(base+path,{method,headers,body:method==='PATCH'?'{}':undefined});calls.push({method,path,status:r.status,body:await r.json()});assert.equal(r.status,404)
}
const taskAssignedEvents=await ctx.db.domainEvent.count({where:{projectId,eventName:'task.assigned'}})
const result={baseline:'main 014555ba7843863ef7230956b89081b8ccd2f461 + D module files only, no production mounting edits',generatedAt:new Date().toISOString(),realTaskCreateStatus:created.status,taskAssignedEvents,calls,verdict:'BLOCKED: production notification routes/DB/consumer bridge/mount not implemented; no six-class delivery or latency claim'}
writeFileSync(new URL('./real-http-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n')
process.env.PORT='3134';const {createServer}=await import('vite');const vite=await createServer({configFile:'web/vite.config.ts',server:{host:'127.0.0.1',port:5174,strictPort:true}});await vite.listen()
const dir=new URL('./screenshots/',import.meta.url);mkdirSync(dir,{recursive:true})
const browser=await chromium.launch({executablePath:'/tmp/aim-chromium/chromium',args:binary.args,headless:true,env:{...process.env,FONTCONFIG_PATH:'/tmp/aim-chromium',LD_LIBRARY_PATH:'/tmp/aim-chromium'}})
try{
const page=await browser.newPage({viewport:{width:1440,height:1000}})
await page.goto('http://127.0.0.1:5174/login');await page.getByLabel('账号',{exact:true}).fill('notice.pm');await page.getByLabel('密码',{exact:true}).fill(TEST_PASSWORD);await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL('**/projects')
await page.goto(`http://127.0.0.1:5174/projects/${projectId}/overview`);await page.getByRole('heading',{name:'项目概览',exact:true}).waitFor()
assert.equal(await page.getByRole('button',{name:/通知，/}).count(),0)
await page.screenshot({path:new URL('01-production-topbar-no-notification.png',dir).pathname,fullPage:true})
await page.goto('http://127.0.0.1:5174/notification-evidence.html');await page.getByRole('button',{name:'通知，数据源未接入',exact:true}).click();await page.getByText('资源不存在',{exact:true}).waitFor()
assert.equal(await page.getByText('暂无通知',{exact:true}).count(),0)
await page.screenshot({path:new URL('02-component-real-404.png',dir).pathname,fullPage:true})
writeFileSync(new URL('./browser-results.json',import.meta.url),JSON.stringify({actualProductionTopbar:'no notification mount',componentBackend:'real production HTTP 404',mockedRequests:0,deliveryAcceptance:'NOT PASSED'},null,2)+'\n')
console.log(JSON.stringify(result,null,2))
}finally{await browser.close();await vite.close();await ctx.dispose()}
