param([ValidateSet('read', 'post')][string]$Mode = 'read', [int]$Issue = 35, [string]$BodyFile)
# Credentials stay in memory; only public Issue content and response URLs are printed.
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
$headers = @{ Authorization = "Bearer $password"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'AIManagement-US15-followup'; 'X-GitHub-Api-Version' = '2022-11-28' }
$proxy = git config --get http.proxy
function Request([string]$Method, [string]$Url, [string]$Body = '') {
  $params = @{ Method = $Method; Uri = $Url; Headers = $headers; TimeoutSec = 25 }
  if ($proxy) { $params.Proxy = $proxy }
  if ($Body) { $params.Body = [System.Text.Encoding]::UTF8.GetBytes($Body); $params.ContentType = 'application/json; charset=utf-8' }
  try { Invoke-RestMethod @params } catch { throw "GitHub API request failed: $Method $Url (credentials omitted)" }
}
$me = Request 'GET' 'https://api.github.com/user'
if ($me.login -ne 'brucelyce-ux') { throw 'Saved credential is not the user-approved account; no publication performed' }
$base = "https://api.github.com/repos/githubleelee/AIManagement/issues/$Issue"
if ($Mode -eq 'read') {
  $ticket = Request 'GET' $base
  Write-Output ("Issue #{0} state={1} comments={2}" -f $Issue, $ticket.state, $ticket.comments)
  $comments = Request 'GET' ($base + '/comments?per_page=100')
  $comments | Select-Object -Last 8 | ForEach-Object { Write-Output ("COMMENT {0} {1}`n{2}" -f $_.html_url, $_.user.login, $_.body) }
} else {
  if (!$BodyFile) { throw 'BodyFile is required for publication' }
  $body = [System.IO.File]::ReadAllText((Resolve-Path $BodyFile), [System.Text.Encoding]::UTF8)
  $result = Request 'POST' ($base + '/comments') (@{body=$body} | ConvertTo-Json -Compress)
  # Verify the actual published body; never assume a successful local draft was posted.
  $verified = Request 'GET' $result.url
  if ($verified.body -ne $body) { throw 'Published body verification failed' }
  Write-Output ("PUBLISHED {0} author={1}" -f $verified.html_url, $verified.user.login)
}
$password = $null
$credentialLines = $null
$headers.Clear()
