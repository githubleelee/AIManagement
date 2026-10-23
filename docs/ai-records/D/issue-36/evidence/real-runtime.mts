import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createTestContext, TEST_PASSWORD } from '../../../../../test/helpers.js'
import { makeUser, makeProject, makeMember, makeGoal, makeActivity, makeStory, makeTask } from '../../../../../test/factories.js'

// Uses the existing production buildApp, real migrated temporary SQLite, real disk,
// real HTTP login and listening server. No mock route/repository/storage is installed.
const uploadRoot = mkdtempSync(join(tmpdir(), 'aim-d36-evidence-files-'))
const ctx = await createTestContext({ uploadRoot })
const users: Record<string, {id:string}> = {}
for (const name of ['pm','owner','member','viewer','outsider']) users[name] = await makeUser(`evidence.${name}`, `联调${name}`)
const { projectId } = await makeProject(users.pm.id, 'D附件真实接口联调（合成数据）')
for (const role of ['owner','member','viewer']) await makeMember(projectId, users[role].id, role === 'viewer' ? 'VIEWER' : 'MEMBER')
const goalId = await makeGoal(projectId, '联调目标')
const activityId = await makeActivity(goalId, '联调活动')
const storyId = await makeStory(activityId, {title:'附件联调故事'})
const taskId = await makeTask(storyId, users.owner.id, users.pm.id)
const deleteTaskId = await makeTask(storyId, users.owner.id, users.pm.id)
const bulkTaskId = await makeTask(storyId, users.owner.id, users.pm.id)
const uiTaskId = await makeTask(storyId, users.owner.id, users.pm.id)
await ctx.app.listen({ port:3136, host:'127.0.0.1' })
const base = 'http://127.0.0.1:3136'
const tokens: Record<string,string> = {}
for (const role of Object.keys(users)) {
  const r=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:`evidence.${role}`,password:TEST_PASSWORD})})
  assert.equal(r.status,200); tokens[role]=(await r.json() as {token:string}).token
}
const cases: unknown[]=[]
async function call(name:string,role:string,method:string,path:string,expected:number,body?:BodyInit,extra:Record<string,string>={}) {
  const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${tokens[role]}`,...extra},body})
  const bytes=Buffer.from(await r.arrayBuffer())
  let data:any;try{data=JSON.parse(bytes.toString())}catch{data=bytes.toString()}
  cases.push({name,role,method,path,status:r.status,expected,pass:r.status===expected,response:method==='POST'&&path==='/auth/login'?'omitted':data})
  assert.equal(r.status,expected,name)
  return {data,bytes}
}
const upload=(name:string,role:string,t:string)=>call(name,role,'POST',`/tasks/${t}/attachments`,201,Buffer.from('%PDF-1.4\nsynthetic evidence\n%%EOF'),{'Content-Type':'application/pdf','X-File-Name':encodeURIComponent('联调证据.pdf')})
const a=await upload('owner upload real disk','owner',taskId)
const id=a.data.id
const row=await ctx.db.attachment.findUniqueOrThrow({where:{id}})
assert(existsSync(resolve(uploadRoot,row.storagePath)))
await call('visible list','viewer','GET',`/tasks/${taskId}/attachments`,200)
const download=await call('download bytes','viewer','GET',`/attachments/${id}/download`,200)
assert.deepEqual(download.bytes,Buffer.from('%PDF-1.4\nsynthetic evidence\n%%EOF'))
for(const role of ['viewer','member']) await call('non-writer upload forbidden',role,'POST',`/tasks/${taskId}/attachments`,403,Buffer.from('%PDF'),{'Content-Type':'application/pdf','X-File-Name':'x.pdf'})
await call('outsider list hidden','outsider','GET',`/tasks/${taskId}/attachments`,404)
await call('unknown MIME maps to 422','owner','POST',`/tasks/${taskId}/attachments`,422,Buffer.from('x'),{'Content-Type':'text/html','X-File-Name':'x.html'})
await call('over ten million bytes','owner','POST',`/tasks/${taskId}/attachments`,422,Buffer.alloc(10_000_002),{'Content-Type':'application/pdf','X-File-Name':'large.pdf'})
// Actual frozen sensitivity endpoint, followed by actual download/list/delete.
await call('PM restrict task','pm','PUT',`/tasks/${taskId}/sensitivity`,200,JSON.stringify({isSensitive:true,visibleMemberIds:[users.owner.id]}),{'Content-Type':'application/json'})
const hidden=await call('revoked viewer download hidden','viewer','GET',`/attachments/${id}/download`,404)
const missing=await call('unknown attachment hidden','viewer','GET','/attachments/not-existing/download',404)
assert.deepEqual(hidden.bytes,missing.bytes)
await call('revoked viewer list hidden','viewer','GET',`/tasks/${taskId}/attachments`,404)
await call('revoked viewer delete hidden','viewer','DELETE',`/attachments/${id}`,404)
await call('PM delete single attachment','pm','DELETE',`/attachments/${id}`,204)
assert(!existsSync(resolve(uploadRoot,row.storagePath)))
assert.equal(await ctx.db.attachment.findUnique({where:{id}}),null)
for(let i=0;i<250;i++) await ctx.db.attachment.create({data:{projectId,taskId:bulkTaskId,originalName:`fixture-${i}.pdf`,extension:'pdf',mimeType:'application/pdf',sizeBytes:1,storagePath:`fixture-${i}`,uploaderUserId:users.owner.id}})
const bulk=await call('real SQLite 250-row complete list','owner','GET',`/tasks/${bulkTaskId}/attachments`,200)
assert.equal(bulk.data.total,250);assert.equal(bulk.data.items.length,250)
// Intentionally preserve the real task DELETE counterexample; do not call cleanup
// ports manually to manufacture a passing production lifecycle.
const orphan=await upload('upload before actual task delete','owner',deleteTaskId)
await call('actual task DELETE','pm','DELETE',`/tasks/${deleteTaskId}`,204)
await new Promise(r=>setTimeout(r,31_000))
const leftover=await ctx.db.attachment.findUnique({where:{id:orphan.data.id}})
const lifecycle={name:'task deletion lifecycle after automatic 30s retry',pass:leftover===null,observed:leftover?{state:leftover.state,taskId:leftover.taskId,fileStillExists:existsSync(resolve(uploadRoot,leftover.storagePath))}:null}
const result={scope:'B candidate + latest main + D attachment module; NOT merged production',generatedAt:new Date().toISOString(),cases,lifecycle,ui:{projectId,storyId,taskId:uiTaskId,ownerUserId:users.owner.id,accounts:Object.keys(users).map(x=>`evidence.${x}`)}}
writeFileSync(new URL('./real-http-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n')
writeFileSync(new URL('./runtime-ui-fixture.json',import.meta.url),JSON.stringify(result.ui,null,2)+'\n')
console.log(JSON.stringify({ready:true,port:3136,httpCases:cases.length,lifecycle},null,2))
if(process.env.EVIDENCE_BROWSER==='1') {
  writeFileSync(new URL('../../../../../web/attachment-evidence-fixture.json',import.meta.url),JSON.stringify({...result.ui,writerIds:[users.pm.id,users.owner.id]}))
  process.env.PORT='3136'
  const {createServer}=await import('vite')
  const vite=await createServer({configFile:'web/vite.config.ts',server:{host:'127.0.0.1',port:5176,strictPort:true}})
  await vite.listen()
  try {const {captureAttachmentPages}=await import('./browser-runtime.mjs');await captureAttachmentPages(result.ui)}
  finally {await vite.close();await ctx.dispose()}
  process.exit()
}
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void ctx.dispose().then(()=>process.exit())})
