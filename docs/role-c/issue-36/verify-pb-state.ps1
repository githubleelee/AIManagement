Set-Location "D:/临时项目/AIManagement-C-attachments"

Write-Output "=== PB-07-1 / PB-07-3: service.ts 约束错误映射 ==="
$svc = git show origin/main:src/modules/uml/service.ts 2>$null
$svc -split "`n" | Select-String -Pattern "P2002|P2003|DUPLICATE|sourceNodeId|constraintWrite|edges\." | ForEach-Object { $_.Line.Trim() }

Write-Output ""
Write-Output "=== PB-07-4: 过期注释是否已改 ==="
$umlTest = git show origin/main:src/modules/uml/uml.http.test.ts 2>$null
$hit = $umlTest -split "`n" | Select-String -Pattern "separate B decision|Post-association sticky"
if ($hit) { Write-Output "STILL PRESENT: $($hit.Line.Trim())" } else { Write-Output "已修改/移除（无过期注释）" }

Write-Output ""
Write-Output "=== verification.md 是否有历史导航说明 ==="
$ver = git show origin/main:docs/role-c/issue-35/verification.md 2>$null
$ver -split "`n" | Select-String -Pattern "2026-10-21|阶段性|历史" | Select-Object -First 3 | ForEach-Object { $_.Line.Trim() }

Write-Output ""
Write-Output "=== ai-scheduling 是否还有 it.todo ==="
$pending = git show origin/main:src/modules/ai-scheduling/integration.pending.test.ts 2>$null
$todoLines = $pending -split "`n" | Select-String -Pattern "it\.todo"
Write-Output ("it.todo 实际行数: {0}" -f @($todoLines).Count)
$todoLines | ForEach-Object { $_.Line.Trim() }

Write-Output ""
Write-Output "=== main 上 TaskSection 锚点相关行 ==="
$ts = git show origin/main:web/src/pages/task/TaskSection.tsx 2>$null
$ts -split "`n" | Select-String -Pattern "useLocation|hash|scrollIntoView|focus\(|task-" | Select-Object -First 12 | ForEach-Object { $_.Line.Trim() }
