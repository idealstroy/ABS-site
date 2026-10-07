[CmdletBinding()]
param(
    [string]$RemotePath,
    [string]$Commit = 'HEAD',
    [string]$SshUser = 'idealstroy_dev',
    [switch]$CheckOnly,
    [switch]$PlanOnly,
    [switch]$Yes,
    [string]$RecoverRun,
    [string]$StatusRun
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'deploy-transport.ps1')
$policy = Get-Content (Join-Path $PSScriptRoot 'deploy-policy.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if (!$RemotePath) { $RemotePath = $policy.remotePath }
if ($RemotePath -cne $policy.remotePath) { throw 'RemotePath differs from the approved website path.' }
if ($SshUser -notin @('idealstroy_dev', 'idealstroy')) { throw 'Unapproved SSH account.' }
foreach ($tool in @('node','git','tar','ssh','scp')) { $null = Get-Command $tool -ErrorAction Stop }
$peer = "$SshUser@idealstroy.beget.tech"
$sshOptions = @('-o','ConnectTimeout=15','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-o','StrictHostKeyChecking=yes','-o','UpdateHostKeys=no')
$engine = (Get-Content (Join-Path $PSScriptRoot 'deploy-remote.sh') -Raw -Encoding UTF8).Replace("`r`n", "`n")
$runId = [Guid]::NewGuid().ToString('N')
$manifest = $null
$plan = $null
$archiveHash = '-'
$utf8 = New-Object Text.UTF8Encoding($false)

function Invoke-Remote([string]$Action) {
    $entries = @()
    if ($Action -eq 'plan') { $entries = @($manifest.files) }
    elseif ($null -ne $plan) { $entries = @($plan.changes) }
    $lines = @($entries | ForEach-Object {
        $previous = '-'
        if ($Action -ne 'plan' -and $_.previous) { $previous = $_.previous }
        if ($_.path -notmatch '^[a-zA-Z0-9_./-]+$' -or $_.sha256 -notmatch '^[a-f0-9]{64}$' -or $previous -notmatch '^(-|[a-f0-9]{64})$') { throw 'Invalid deployment file list.' }
        "$($_.sha256) $($_.size) $previous $($_.path)"
    }) -join "`n"
    $program = "root='$RemotePath'`nrun_id='$runId'`naction='$Action'`narchive_sha='$archiveHash'`nmanifest() {`ncat <<'ABS_MANIFEST'`n$lines`nABS_MANIFEST`n}`n" + $engine
    $encoded = ConvertTo-DeployShellTransport -Program $program
    $transport = Invoke-DeployProcessInput -Executable (Get-Command ssh -CommandType Application).Source -Arguments ($sshOptions + @('-T', $peer, $encoded.Command)) -InputText $encoded.InputText
    $output = @($transport.Output -split "`r?`n")
    $exitCode = $transport.ExitCode
    $records = @($output | Where-Object { $_ -like 'ABS_DEPLOY|*' })
    if ($exitCode -ne 0 -or $records -notcontains "ABS_DEPLOY|OK|$Action") {
        if ($Action -in @('check','plan')) { throw "Hosting check failed (SSH exit $exitCode). No server files changed. See the preceding error." }
        throw "Deployment action '$Action' failed (SSH exit $exitCode). Check status before retrying: npm run deploy -- -StatusRun $runId"
    }
    return [pscustomobject]@{ Records = $records }
}

function Check-Http([string]$Work) {
    $checks = @('index.html','assets/css/site.css','assets/js/site.js')
    $checks += @($plan.changes | Where-Object { $_.path -match '\.(html|css|js|png|jpe?g|webp|avif|svg|gif|ico)$' } | ForEach-Object { $_.path })
    $progressBefore = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try {
        foreach ($relative in @($checks | Select-Object -Unique)) {
            $entry = @($manifest.files | Where-Object { $_.path -ceq $relative })[0]
            $download = Join-Path $Work 'http-check.bin'
            $url = "$($policy.origin)/$relative`?deploy_check=$runId"
            $null = Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $download -TimeoutSec 25 -Headers @{ 'Accept-Encoding'='identity'; 'Cache-Control'='no-cache' }
            if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry.sha256) { throw "HTTP check differs from release: $relative" }
        }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "$($policy.origin)/actions/send-request.php" -MaximumRedirection 0 -TimeoutSec 25 -ErrorAction Stop
        } catch {
            $response = $_.Exception.Response
            if ($null -eq $response) { throw }
        }
        if ([int]$response.StatusCode -ne 303 -or [string]$response.Headers['Location'] -ne '/request/') { throw 'Form handler GET check failed (no form was submitted).' }
    } finally { $ProgressPreference = $progressBefore }
}

Push-Location $projectRoot
try {
    if ($CheckOnly) {
        Write-Host 'Checking existing hosting tools and read access only. No Python or installation.'
        $result = Invoke-Remote 'check'
        $result.Records | ForEach-Object { Write-Host $_ }
        return
    }
    if ($RecoverRun -or $StatusRun) {
        if ($RecoverRun -and $StatusRun) { throw 'Choose status or recovery.' }
        $runId = if ($RecoverRun) { $RecoverRun } else { $StatusRun }
        if ($runId -notmatch '^[a-f0-9]{32}$') { throw 'Invalid run ID.' }
        $requestPath = Join-Path ([IO.Path]::GetTempPath()) "abs-simple-request-$runId.json"
        if (!(Test-Path -LiteralPath $requestPath)) { throw 'Saved request missing. Inspect the server run folder; do not remove locks blindly.' }
        $saved = Get-Content $requestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($saved.root -cne $RemotePath -or $saved.user -cne $SshUser) { throw 'Use the same target and SSH account as the interrupted run.' }
        $manifest = $saved.manifest; $plan = $saved.plan
        $action = if ($RecoverRun) { 'recover' } else { 'status' }
        $result = Invoke-Remote $action
        $result.Records | ForEach-Object { Write-Host $_ }
        return
    }
    Write-Host 'Building and testing the Git release in a temporary local folder...'
    $preparedJson = & node scripts/deploy-prepare.mjs $Commit
    if ($LASTEXITCODE -ne 0) { throw 'Build failed. No server files changed.' }
    $prepared = $preparedJson | ConvertFrom-Json
    $manifest = Get-Content $prepared.manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Write-Host 'Checking hosting compatibility and comparing file hashes (enter the correct SSH password)...'
    $result = Invoke-Remote 'plan'
    $remoteHashes = @{}
    foreach ($line in $result.Records) {
        $fields = $line.Split('|')
        if ($fields[1] -eq 'FILE') { $remoteHashes[$fields[2]] = $fields[3] }
    }
    $changes = @()
    foreach ($entry in $manifest.files) {
        if (!$remoteHashes.ContainsKey($entry.path)) { throw "Incomplete server comparison: $($entry.path)" }
        $previous = $remoteHashes[$entry.path]
        if ($previous -cne $entry.sha256) {
            $kind = if ($previous -eq '-') { 'add' } else { 'replace' }
            $changes += [pscustomobject]@{ path=$entry.path; sha256=$entry.sha256; size=$entry.size; previous=$previous; kind=$kind }
            Write-Host "$kind`: $($entry.path)"
        }
    }
    $uploadBytes = 0L
    foreach ($entry in $changes) { $uploadBytes += $entry.size }
    $plan = [pscustomobject]@{ changes=$changes; uploadBytes=$uploadBytes; deletions=@() }
    Write-Host ("Changed files: {0}; upload: {1:N2} MiB. Old files/folders will not be deleted." -f $changes.Count, ($uploadBytes / 1MB))
    if ($PlanOnly -or !$changes.Count) { return }
    if (!$Yes -and (Read-Host 'Check the file list and Beget account quota. Type DEPLOY to continue') -cne 'DEPLOY') { Write-Host 'Cancelled; hosting unchanged.'; return }
    $requestPath = Join-Path ([IO.Path]::GetTempPath()) "abs-simple-request-$runId.json"
    [IO.File]::WriteAllText($requestPath, (@{ root=$RemotePath; user=$SshUser; manifest=$manifest; plan=$plan } | ConvertTo-Json -Depth 40), $utf8)
    $planPath = Join-Path $prepared.work 'plan.json'
    [IO.File]::WriteAllText($planPath, ($plan | ConvertTo-Json -Depth 40), $utf8)
    $archive = Join-Path $prepared.work 'payload.tar'
    $null = & node scripts/deploy-prepare.mjs --package $prepared.dist $planPath $prepared.manifestPath $archive
    if ($LASTEXITCODE -ne 0) { throw 'Packaging failed; hosting unchanged.' }
    $archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    $stage = Invoke-Remote 'stage'
    $stagePath = (($stage.Records | Where-Object { $_ -like 'ABS_DEPLOY|STAGE|*' }) -split '\|')[2]
    Write-Host "Run: $runId. Uploading changes outside public_html..."
    & scp -O @sshOptions $archive "$($peer):$stagePath/payload.tar"
    if ($LASTEXITCODE -ne 0) { throw "Staging upload interrupted; live files unchanged. Recover with: npm run deploy -- -RecoverRun $runId" }
    $preparedRemote = Invoke-Remote 'prepare'
    $preparedRemote.Records | Where-Object { $_ -like 'ABS_DEPLOY|BACKUP|*' } | ForEach-Object { Write-Host $_ }
    $null = Invoke-Remote 'activate'
    try { Check-Http $prepared.work }
    catch {
        Write-Warning 'Website check failed. Restoring the previous files from backup...'
        $null = Invoke-Remote 'recover'
        throw
    }
    $null = Invoke-Remote 'finish'
    Write-Host "Verified release $($manifest.commit). Updated files: $($changes.Count)."
} finally { Pop-Location }
