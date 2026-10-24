import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createTestContext,TEST_PASSWORD} from '../../../../../test/helpers.js'
import {makeUser,makeProject,makeMember,makeGoal,makeActivity,makeStory,makeTask} from '../../../../../test/factories.js'

const issue=Number(process.env.EVIDENCE_ISSUE)
assert([34,36].includes(issue))
const evidence=new URL('./',import.meta.url)
const uploadRoot=mkdtempSync(join(tmpdir(),'aim-d-status-files-'))
const ctx=await createTestContext(issue===36?{uploadRoot}:undefined)
const pm=await makeUser('status.pm','错误回归PM'),owner=await makeUser('status.owner','错误回归负责人'),outsider=await makeUser('status.outsider','错误回归外部账号')
const {projectId}=await makeProject(pm.id,'D错误状态回归（合成数据）')
await makeMember(projectId,owner.id,'MEMBER')
const storyId=await makeStory(await makeActivity(await makeGoal(projectId)),{title:'D状态回归故事'})
const taskId=await makeTask(storyId,owner.id,pm.id)
const port=issue===36?3236:3234,webPort=issue===36?5276:5274
await ctx.app.listen({port,host:'127.0.0.1'})
const base='http://127.0.0.1:'+port
const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:'status.owner',password:TEST_PASSWORD})})
assert.equal(login.status,200)
const {token}=await login.json() as {token:string}
const cases:any[]=[]
if(issue===36){
for(const c of [
{name:'unsupported-content-type',mime:'image/svg+xml',file:'a.svg',bytes:1,expected:415},
{name:'transport-body-limit',mime:'application/pdf',file:'a.pdf',bytes:10_000_002,expected:413},
{name:'parsed-business-size-limit',mime:'application/pdf',file:'a.pdf',bytes:10_000_001,expected:422},
{name:'parsed-extension-mime-mismatch',mime:'image/png',file:'a.pdf',bytes:1,expected:422},
{name:'exact-size-boundary',mime:'application/pdf',file:'a.pdf',bytes:10_000_000,expected:201}
]){
const r=await fetch(base+'/tasks/'+taskId+'/attachments',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':c.mime,'X-File-Name':c.file},body:Buffer.alloc(c.bytes)})
const body=await r.json()
cases.push({...c,actual:r.status,body});assert.equal(r.status,c.expected,c.name)
}
const isolation=await fetch(base+'/projects',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/pdf'},body:Buffer.from('x')})
cases.push({name:'attachment-parser-does-not-leak-to-project-routes',expected:415,actual:isolation.status});assert.equal(isolation.status,415)
writeFileSync(new URL('../../../../../web/status-regression-fixture.json',import.meta.url),JSON.stringify({taskId}))
}
process.env.PORT=String(port)
const {createServer}=await import('vite')
const vite=await createServer({configFile:'web/vite.config.ts',server:{host:'127.0.0.1',port:webPort,strictPort:true}});await vite.listen()
const {chromium}=await import(process.env.EVIDENCE_PLAYWRIGHT_MODULE??'playwright')
const binary=process.env.EVIDENCE_CHROMIUM_ARGS_MODULE? (await import(process.env.EVIDENCE_CHROMIUM_ARGS_MODULE)).default:null
const browser=await chromium.launch({headless:true,executablePath:process.env.EVIDENCE_CHROMIUM_PATH,args:binary?.args??[],env:{...process.env}})
try{
const page=await browser.newPage({viewport:{width:1440,height:1000}})
await page.goto('http://127.0.0.1:'+webPort+'/login')
await page.getByLabel('账号',{exact:true}).fill(issue===36?'status.outsider':'status.pm')
await page.getByLabel('密码',{exact:true}).fill(TEST_PASSWORD)
await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL('**/projects')
let realResponse
if(issue===34){
await page.getByRole('button',{name:/^通知，/}).click()
await page.getByRole('region',{name:'站内通知'}).waitFor()
await page.evaluate(()=>localStorage.setItem('aim.token','invalid-synthetic-regression-session'))
const failed=page.waitForResponse(r=>r.url().includes('/api/me/notifications')&&r.status()===401)
await page.getByRole('button',{name:'刷新',exact:true}).click()
realResponse=(await failed).status()
await page.locator('.notification-panel .error').waitFor()
assert.equal(await page.getByText('正在加载…',{exact:true}).count(),0)
}else{
const failed=page.waitForResponse(r=>r.url().includes('/attachments')&&r.status()===404)
await page.goto('http://127.0.0.1:'+webPort+'/attachment-status-regression.html')
realResponse=(await failed).status()
await page.getByRole('alert').waitFor()
assert.equal(await page.getByText('正在加载…',{exact:true}).count(),0)
}
mkdirSync(new URL('./screenshots/',evidence),{recursive:true})
await page.screenshot({path:new URL('./screenshots/20261024-error-without-loading.png',evidence).pathname,fullPage:true})
const result={generatedAt:new Date().toISOString(),issue,syntheticData:true,mockedRequests:0,cases,page:{actualHttpStatus:realResponse,errorVisible:true,loadingHintVisible:false,scope:issue===34?'production AppLayout + real notification HTTP':'independent TaskAttachmentPanel + B candidate real HTTP'},limitations:issue===36?['B candidate not merged with latest main due public-file conflicts','task DELETE lifecycle and production TaskSection mounting remain C responsibility']:['six-class delivery remains incomplete; production source gaps unchanged']}
writeFileSync(new URL('./20261024-http-and-browser-results.json',evidence),JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify(result,null,2))
}finally{await browser.close();await vite.close();await ctx.dispose()}
