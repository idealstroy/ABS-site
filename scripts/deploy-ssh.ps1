[CmdletBinding()]
param(
    [string]$RemotePath,
    [string]$Commit = 'HEAD',
    [string]$SshUser = 'idealstroy_dev',
    [switch]$PlanOnly,
    [switch]$Yes,
    [string]$RecoverRun,
    [string]$StatusRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = Split-Path -Parent $PSScriptRoot
$policy = Get-Content (Join-Path $PSScriptRoot 'deploy-policy.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$configPath = Join-Path $projectRoot '.deploy-config.json'
if (!$RemotePath -and (Test-Path -LiteralPath $configPath)) {
    $RemotePath = (Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json).remotePath
}
if (!$RemotePath) { $RemotePath = $policy.remotePath }
if ($RemotePath -cne $policy.remotePath) { throw 'RemotePath is not approved in deploy-policy.json.' }
if ($SshUser -notin @('idealstroy_dev', 'idealstroy')) { throw 'Unapproved SSH account.' }
$peer = "$SshUser@idealstroy.beget.tech"
$sshOptions = @('-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no')
$engine = (Get-Content (Join-Path $PSScriptRoot 'deploy-remote.py') -Raw -Encoding UTF8).Replace("`r`n", "`n")

function Invoke-Remote([hashtable]$Request) {
    $json = ConvertTo-Json -InputObject $Request -Depth 40 -Compress
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
    $program = $engine + "`nmain(json.loads(base64.b64decode('$encoded')))`n"
    $previousEncoding = $OutputEncoding
    try {
        $OutputEncoding = New-Object Text.UTF8Encoding($false)
        $output = @($program | & ssh @sshOptions -T $peer 'python3 -')
        $exitCode = $LASTEXITCODE
    } finally { $OutputEncoding = $previousEncoding }
    $answers = @($output | Where-Object { $_ -match '^\{"ok":' })
    if ($answers.Count -ne 1) { throw 'SSH returned no valid deployment result. Check the saved run journal; do not retry blindly.' }
    $answer = $answers[0] | ConvertFrom-Json
    if (!$answer.ok) { throw $answer.error }
    if ($exitCode -ne 0) { throw "SSH failed with exit code $exitCode. Check the saved run journal." }
    return $answer.result
}

Push-Location $projectRoot
try {
    if ($RecoverRun -or $StatusRun) {
        if ($RecoverRun -and $StatusRun) { throw 'Choose recovery or status, not both.' }
        $savedRun = if ($RecoverRun) { $RecoverRun } else { $StatusRun }
        if ($savedRun -notmatch '^[a-f0-9]{32}$') { throw 'Invalid run ID.' }
        $savedRequest = Join-Path ([IO.Path]::GetTempPath()) "abs-deploy-request-$savedRun.json"
        if (!(Test-Path -LiteralPath $savedRequest)) { throw 'Local recovery request missing. Inspect the server journal; do not remove the lock manually.' }
        $saved = Get-Content $savedRequest -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($saved.root -cne $RemotePath) { throw 'Recovery target differs from approved path.' }
        $action = if ($RecoverRun) { 'recover' } else { 'status' }
        $request = @{ action = $action; root = $saved.root; run = $saved.run; manifest = $saved.manifest; plan = $saved.plan }
        $result = Invoke-Remote $request
        Write-Host "Run: $savedRun. Status: $($result.status). Backup: $($result.backup)"
        return
    }
    Write-Host 'Building and testing a clean Git commit in an isolated temporary directory...'
    $preparedJson = & node scripts/deploy-prepare.mjs $Commit
    if ($LASTEXITCODE -ne 0) { throw 'Release preparation failed. No server changes made.' }
    $prepared = $preparedJson | ConvertFrom-Json
    $manifest = Get-Content $prepared.manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $runId = [Guid]::NewGuid().ToString('N')
    $request = @{ action = 'plan'; root = $RemotePath; run = $runId; manifest = $manifest }
    Write-Host 'Comparing SHA-256 with hosting (SSH may request your password)...'
    $plan = Invoke-Remote $request
    foreach ($entry in $plan.changes) { Write-Host "$($entry.kind): $($entry.path) ($($entry.size) bytes)" }
    Write-Host ("Commit: {0}; changed files: {1}; upload: {2:N2} MiB; remote deletions: disabled." -f $manifest.commit, @($plan.changes).Count, ($plan.uploadBytes / 1MB))
    Write-Host 'Only filesystem free space is known. Verify the main Beget account quota before publishing.'
    if ($PlanOnly -or @($plan.changes).Count -eq 0) { return }
    if (!$Yes -and (Read-Host 'Check the list and account quota. Type DEPLOY to continue') -cne 'DEPLOY') { Write-Host 'Cancelled; no server changes.'; return }
    $request.plan = $plan
    $savedRequest = Join-Path ([IO.Path]::GetTempPath()) "abs-deploy-request-$runId.json"
    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($savedRequest, (ConvertTo-Json -InputObject $request -Depth 40), $utf8)
    $planPath = Join-Path $prepared.work 'plan.json'
    [IO.File]::WriteAllText($planPath, (ConvertTo-Json -InputObject $plan -Depth 40), $utf8)
    $archive = Join-Path $prepared.work 'payload.tar'
    $null = & node scripts/deploy-prepare.mjs --package $prepared.dist $planPath $prepared.manifestPath $archive
    if ($LASTEXITCODE -ne 0) { throw 'Cannot package the approved delta; no server changes.' }
    $request.action = 'stage'
    $stage = Invoke-Remote $request
    Write-Host "Run: $runId. Uploading changed files outside public_html..."
    try {
        & scp -O @sshOptions $archive "$($peer):$($stage.stage)/payload.tar"
        if ($LASTEXITCODE -ne 0) { throw "Staging upload failed: $LASTEXITCODE. Live files have not been replaced." }
        $request.action = 'publish'
        $result = Invoke-Remote $request
        Write-Host "Verified release: $($result.commit). Changed files: $($result.changed). Backup: $($result.backup)"
    } catch {
        Write-Warning "Inspect status before retrying: npm run deploy -- -StatusRun $runId"
        Write-Warning "For an interrupted run only: npm run deploy -- -RecoverRun $runId"
        Write-Warning "Recovery request saved locally: $savedRequest"
        throw
    }
} finally { Pop-Location }
