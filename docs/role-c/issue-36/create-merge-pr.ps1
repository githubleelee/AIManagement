param(
  [Parameter(Mandatory = $true)][string]$Head,
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][string]$BodyFile,
  [switch]$Merge
)
# 创建（可选随后合并）PR。凭据仅内存使用，不打印。
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'Never'
$credentialLines = "protocol=https`nhost=github.com`nusername=brucelyce-ux`n`n" | git -c credential.interactive=false credential fill
if ($LASTEXITCODE -ne 0) { throw 'GitHub credential lookup failed (non-interactive)' }
$password = $null
foreach ($line in $credentialLines) { if ($line.StartsWith('password=')) { $password = $line.Substring(9) } }
if (!$password) { throw 'No saved GitHub credential available' }
$headers = @{ Authorization = "Bearer $password"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'AIManagement-C-pr'; 'X-GitHub-Api-Version' = '2022-11-28' }
$proxy = git config --get http.proxy
function Request([string]$Method, [string]$Url, [string]$Body = '') {
  $params = @{ Method = $Method; Uri = $Url; Headers = $headers; TimeoutSec = 30 }
  if ($proxy) { $params.Proxy = $proxy }
  if ($Body) { $params.Body = [System.Text.Encoding]::UTF8.GetBytes($Body); $params.ContentType = 'application/json; charset=utf-8' }
  try { Invoke-RestMethod @params } catch { throw "GitHub API request failed: $Method $Url (credentials omitted)" }
}
$me = Request 'GET' 'https://api.github.com/user'
if ($me.login -ne 'brucelyce-ux') { throw 'Saved credential is not the user-approved account' }

$repo = 'https://api.github.com/repos/githubleelee/AIManagement'
$body = [System.IO.File]::ReadAllText((Resolve-Path $BodyFile), [System.Text.Encoding]::UTF8)

# 幂等：同一 head 已有 open PR 时复用，不重复创建。
$existing = @(Request 'GET' "$repo/pulls?state=open&head=githubleelee:$Head")
if ($existing.Count -gt 0) {
  $pr = $existing[0]
  Write-Output ("EXISTING PR #{0} {1}" -f $pr.number, $pr.html_url)
} else {
  $payload = @{ title = $Title; head = $Head; base = 'main'; body = $body } | ConvertTo-Json -Compress
  $pr = Request 'POST' "$repo/pulls" $payload
  Write-Output ("CREATED PR #{0} {1}" -f $pr.number, $pr.html_url)
}

Request 'GET' "$repo/pulls/$($pr.number)" | Out-Null
Write-Output ("STATE before merge: {0} mergeable_state={1}" -f $pr.state, $pr.mergeable_state)

if ($Merge) {
  for ($attempt = 1; $attempt -le 10; $attempt++) {
    $current = Request 'GET' "$repo/pulls/$($pr.number)"
    if ($current.mergeable -eq $null) { Start-Sleep -Seconds 3; continue }
    if ($current.merged) { Write-Output 'ALREADY MERGED'; break }
    try {
      $merged = Request 'PUT' "$repo/pulls/$($pr.number)/merge" (@{ merge_method = 'merge'; sha = $current.head.sha } | ConvertTo-Json -Compress)
      Write-Output ("MERGED={0} sha={1} message={2}" -f $merged.merged, $merged.sha, $merged.message)
      break
    } catch {
      if ($attempt -eq 10) { throw "Merge failed after $attempt attempts (credentials omitted)" }
      Start-Sleep -Seconds 4
    }
  }
}
$final = Request 'GET' "$repo/pulls/$($pr.number)"
Write-Output ("FINAL state={0} merged={1} merge_commit={2}" -f $final.state, $final.merged, $final.merge_commit_sha)
$password = $null
$credentialLines = $null
$headers.Clear()
