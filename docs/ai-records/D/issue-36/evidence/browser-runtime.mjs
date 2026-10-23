import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync,readFileSync } from 'node:fs'
import { chromium } from '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import binary from '/tmp/aim-browser-runtime/node_modules/@sparticuz/chromium/build/index.js'

export async function captureAttachmentPages(fixture) {
  const browser = await chromium.launch({executablePath:'/tmp/aim-chromium/chromium',args:binary.args,headless:true,env:{...process.env,FONTCONFIG_PATH:'/tmp/aim-chromium',LD_LIBRARY_PATH:'/tmp/aim-chromium'}})
  const dir=new URL('./screenshots/',import.meta.url);mkdirSync(dir,{recursive:true})
  const context=await browser.newContext({viewport:{width:1440,height:1050},acceptDownloads:true})
  const page=await context.newPage()
  const responses=[]
  page.on('response',r=>{if(r.url().includes('/api/')&&!r.url().endsWith('/auth/login'))responses.push({url:new URL(r.url()).pathname,status:r.status()})})
  async function signIn(role){await context.clearCookies();await page.goto('http://127.0.0.1:5176/login');await page.evaluate(()=>localStorage.clear());await page.reload();await page.getByLabel('账号',{exact:true}).fill('evidence.'+role);await page.getByLabel('密码',{exact:true}).fill('Test@12345');await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL('**/projects');await page.goto('http://127.0.0.1:5176/attachment-evidence.html');await page.getByRole('region',{name:'任务附件'}).waitFor()}
  await signIn('owner')
  await page.getByText('暂无附件',{exact:true}).waitFor()
  await page.screenshot({path:new URL('01-owner-empty.png',dir).pathname,fullPage:true})
  await page.locator('input[type=file]').setInputFiles({name:'browser-evidence.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nBrowser synthetic evidence\n%%EOF')})
  await page.getByText('browser-evidence.pdf',{exact:true}).waitFor()
  await page.screenshot({path:new URL('02-upload-listed.png',dir).pathname,fullPage:true})
  const downloadP=page.waitForEvent('download');await page.getByRole('button',{name:'下载',exact:true}).click();const download=await downloadP;assert.equal(download.suggestedFilename(),'browser-evidence.pdf');assert.equal(readFileSync(await download.path(),'utf8'),'%PDF-1.4\nBrowser synthetic evidence\n%%EOF')
  await page.screenshot({path:new URL('03-download-click.png',dir).pathname,fullPage:true})
  await signIn('viewer')
  await page.getByText('browser-evidence.pdf',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'上传附件',exact:true}).count(),0)
  assert.equal(await page.getByRole('button',{name:'删除',exact:true}).count(),0)
  await page.screenshot({path:new URL('04-viewer-read-only.png',dir).pathname,fullPage:true})
  await signIn('outsider')
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByText('browser-evidence.pdf',{exact:true}).count(),0)
  await page.screenshot({path:new URL('05-outsider-hidden.png',dir).pathname,fullPage:true})
  await signIn('pm')
  const pmToken=await page.evaluate(()=>localStorage.getItem('aim.token'))
  const sensitivity=await page.request.put(`http://127.0.0.1:5176/api/tasks/${fixture.taskId}/sensitivity`,{headers:{Authorization:`Bearer ${pmToken}`},data:{isSensitive:true,visibleMemberIds:[fixture.ownerUserId]}})
  assert.equal(sensitivity.status(),200)
  await signIn('viewer')
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByText('browser-evidence.pdf',{exact:true}).count(),0)
  await page.screenshot({path:new URL('08-sensitive-viewer-hidden.png',dir).pathname,fullPage:true})
  await signIn('owner')
  await page.getByText('browser-evidence.pdf',{exact:true}).waitFor()
  await page.getByRole('button',{name:'删除',exact:true}).click();await page.getByText('暂无附件',{exact:true}).waitFor()
  await page.screenshot({path:new URL('06-single-delete.png',dir).pathname,fullPage:true})
  await page.goto(`http://127.0.0.1:5176/projects/${fixture.projectId}/requirements/${fixture.storyId}`)
  await page.getByText('附件联调故事',{exact:true}).first().waitFor()
  assert.equal(await page.getByRole('region',{name:'任务附件'}).count(),0)
  await page.screenshot({path:new URL('07-production-task-section-not-mounted.png',dir).pathname,fullPage:true})
  writeFileSync(new URL('./browser-results.json',import.meta.url),JSON.stringify({scope:'Real isolated component, NOT production mounting',generatedAt:new Date().toISOString(),passed:['real login','upload listed','download event and byte equality','viewer read-only','outsider API 404 and no filenames','sensitive revoked viewer API 404 and no filenames','single attachment deletion'],blocked:['production TaskSection has no attachment mount','task DELETE lifecycle orphan'],responses},null,2)+'\n')
  await browser.close()
}
