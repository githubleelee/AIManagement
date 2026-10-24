Set-Location "D:/临时项目/AIManagement-C-attachments"
$env:GIT_TERMINAL_PROMPT = "0"
$env:GCM_INTERACTIVE = "Never"
git fetch origin main 2>&1 | Out-Null

Write-Output "=== origin/main ==="
git log -1 --format="%H %ci %s" origin/main

Write-Output ""
Write-Output "=== 我的提交是否已在 main ==="
$shas = @(
  'fb4fe3089a561af217b093698bdaf45e1d95511a',
  '84c8985d09361c46f2932f597656f8548307cf47',
  '22bd2bacd4aba821fd149078d6c05158427332e8',
  '9456f2b',
  '952afba342a510ac4ae3bca76294cf15618eb05d'
)
foreach ($sha in $shas) {
  git merge-base --is-ancestor $sha origin/main 2>$null
  if ($LASTEXITCODE -eq 0) { $state = 'YES' } else { $state = 'NO' }
  Write-Output ("{0,-12} in-main={1}" -f $sha.Substring(0, 9), $state)
}

Write-Output ""
Write-Output "=== main 中的关键文件 ==="
$files = @(
  'web/src/pages/task/TaskAttachmentSlot.tsx',
  'src/modules/task/task-attachment-lifecycle.http.test.ts',
  'src/modules/task/task-attachment-input.http.test.ts',
  'docs/ai-records/C/issue-36/C-I36-20261022-main01a163ee-01.md',
  'docs/ai-records/C/INDEX.md',
  'src/modules/uml/uml-constraints.http.test.ts',
  'web/src/pages/uml/api.roundtrip.test.ts',
  'src/modules/uml/frontend.vitest.config.ts',
  'docs/role-c/issue-36/delivery.md',
  'docs/role-c/issue-35/formal-delivery.md'
)
foreach ($f in $files) {
  git cat-file -e "origin/main:$f" 2>$null
  if ($LASTEXITCODE -eq 0) { $state = 'EXISTS' } else { $state = 'MISSING' }
  Write-Output ("{0,-72} {1}" -f $f, $state)
}

Write-Output ""
Write-Output "=== main 的 TaskSection 是否含任务锚点 ==="
$ts = git show "origin/main:web/src/pages/task/TaskSection.tsx" 2>$null
if ($LASTEXITCODE -eq 0) {
  Write-Output ("contains id=`task-: {0}" -f ($ts -match 'id=\{`task-'))
  Write-Output ("contains scrollIntoView: {0}" -f ($ts -match 'scrollIntoView'))
  Write-Output ("contains TaskAttachmentSlot: {0}" -f ($ts -match 'TaskAttachmentSlot'))
} else { Write-Output 'TaskSection 读取失败' }

Write-Output ""
Write-Output "=== main 的 task DELETE 是否接生命周期端口 ==="
$tr = git show "origin/main:src/modules/task/routes.ts" 2>$null
if ($LASTEXITCODE -eq 0) {
  Write-Output ("contains markForTaskDeletion: {0}" -f ($tr -match 'markForTaskDeletion'))
  Write-Output ("contains attachmentCleanup: {0}" -f ($tr -match 'attachmentCleanup'))
} else { Write-Output 'routes 读取失败' }

Write-Output ""
Write-Output "=== main 里遗留的 todo 门禁 ==="
git grep -c "it.todo" origin/main -- src/modules/ai-scheduling 2>$null
if ($LASTEXITCODE -ne 0) { Write-Output 'no it.todo in ai-scheduling on main' }
