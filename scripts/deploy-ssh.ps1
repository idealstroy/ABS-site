param([switch]$ValidateOnly, [switch]$UploadOnly)

if ($ValidateOnly -and $UploadOnly) { throw 'ValidateOnly and UploadOnly are mutually exclusive' }

$ErrorActionPreference = 'Stop'
if (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
. (Join-Path $PSScriptRoot 'deploy-integrity.ps1')

function Invoke-Native {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}

function Assert-Release {
    param([string]$Root)
    $required = @(
        'index.html',
        'robots.txt',
        'sitemap.xml',
        'assets/css/site.css',
        'assets/js/site.js',
        'actions/send-request.php',
        'actions/form-lib.php',
        'voditel-spetstehnika/index.html',
        'mashinisty-spetstehniki/index.html',
        'o-kompanii/index.html',
        'kontakty/index.html'
    )
    foreach ($file in $required) {
        $path = Join-Path $Root ($file.Replace('/', [IO.Path]::DirectorySeparatorChar))
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Incomplete release: $file is missing" }
    }
}

$hostName = if ($env:DEPLOY_HOST) { $env:DEPLOY_HOST } else { 'idealstroy.beget.tech' }
$userName = if ($env:DEPLOY_USER) { $env:DEPLOY_USER } else { 'idealstroy_dev' }
$target = if ($env:DEPLOY_TARGET_DIR) { $env:DEPLOY_TARGET_DIR } else { '/home/i/idealstroy/abs-engineer.ru/public_html' }
$port = if ($env:DEPLOY_PORT) { $env:DEPLOY_PORT } else { '22' }
$siteUrl = if ($env:DEPLOY_SITE_URL) { $env:DEPLOY_SITE_URL.TrimEnd('/') } else { 'https://abs-engineer.ru' }
$buildDir = if ($env:DEPLOY_BUILD_DIR) { $env:DEPLOY_BUILD_DIR } else { 'dist' }

if ($target -notmatch '^/[A-Za-z0-9_./-]+$' -or $target.Contains('..') -or $target.TrimEnd('/') -in @('/', '/var', '/var/www')) { throw "Unsafe target directory: $target" }
if ($port -notmatch '^\d{1,5}$' -or [int]$port -lt 1 -or [int]$port -gt 65535) { throw 'Invalid SSH port' }
if ($hostName -notmatch '^[A-Za-z0-9.-]+$' -or $userName -notmatch '^[A-Za-z0-9_-]+$') { throw 'Invalid SSH host or user' }
if ($siteUrl -notmatch '^https://[A-Za-z0-9.-]+(:\d+)?$') { throw 'DEPLOY_SITE_URL must be HTTPS' }

$buildPath = [IO.Path]::GetFullPath((Join-Path $repoRoot $buildDir))
if (-not $buildPath.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Build directory must be inside the repository' }

$releaseId = [guid]::NewGuid().ToString('N')
$stage = "$target.__deploy_$releaseId"
$archive = Join-Path $env:TEMP "abs-deploy-$releaseId.tar.gz"
$remote = "$userName@$hostName"
$sshArgs = @('-p', $port, '-o', 'ServerAliveInterval=30')
$scpArgs = @('-P', $port)
if ($env:DEPLOY_SSH_KEY) {
    $sshArgs += @('-i', $env:DEPLOY_SSH_KEY)
    $scpArgs += @('-i', $env:DEPLOY_SSH_KEY)
}

function Invoke-Remote {
    param([string]$Mode, [string]$Sha = '-')
    $command = "sh '$stage/deploy-remote.sh' '$Mode' '$target' '$stage' '$releaseId' '$Sha'"
    Invoke-Native 'ssh.exe' ($sshArgs + @($remote, $command))
}

$remotePrepared = $false
$activated = $false
try {
    if (-not $ValidateOnly -and -not $UploadOnly) {
        Write-Host 'Copying the current server site to backup...' -ForegroundColor Cyan
        Invoke-Native 'ssh.exe' ($sshArgs + @($remote, "mkdir -m 755 '$stage'"))
        $remotePrepared = $true
        Invoke-Native 'scp.exe' ($scpArgs + @((Join-Path $PSScriptRoot 'deploy-remote.sh'), "${remote}:$stage/deploy-remote.sh"))
        Invoke-Remote 'backup'
    }

    Write-Host 'Building and checking the release...' -ForegroundColor Cyan
    Invoke-Native 'npm.cmd' @('run', 'build')
    Assert-Release $buildPath
    Invoke-Native 'node.exe' @((Join-Path $PSScriptRoot 'validate-release.mjs'), $buildDir)
    Invoke-Native 'tar.exe' @('-czf', $archive, '--exclude=./_prototype', '--exclude=./var', '--exclude=.gitkeep', '-C', $buildPath, '.')
    $sha = Get-DeployFileSha256 $archive

    if ($ValidateOnly) {
        Write-Host 'Local deploy check passed. Nothing was sent to the server.' -ForegroundColor Green
        return
    }

    Write-Host 'Uploading the checked release...' -ForegroundColor Cyan
    if ($UploadOnly) {
        Invoke-Native 'ssh.exe' ($sshArgs + @($remote, "mkdir -m 755 '$stage'"))
        $remotePrepared = $true
        Invoke-Native 'scp.exe' ($scpArgs + @((Join-Path $PSScriptRoot 'deploy-remote.sh'), "${remote}:$stage/deploy-remote.sh"))
    }
    Invoke-Native 'scp.exe' ($scpArgs + @($archive, "${remote}:$stage/site.tar.gz"))
    if ($UploadOnly) {
        Invoke-Remote 'prepare-test' $sha
        Invoke-Remote 'cleanup-test'
        $remotePrepared = $false
        Write-Host 'Upload check passed. Live site and backups were not changed. Test stage removed.' -ForegroundColor Green
        return
    }
    Invoke-Remote 'prepare' $sha

    Write-Host 'Updating the live site...' -ForegroundColor Cyan
    $activated = $true
    Invoke-Remote 'activate'

    Write-Host 'Checking the public site...' -ForegroundColor Cyan
    $checks = @(
        '/',
        '/voditel-spetstehnika/',
        '/voditel-spetstehnika/voditel-gruzovogo-avtomobilya/',
        '/voditel-spetstehnika/voditel-samosvala/',
        '/voditel-spetstehnika/voditel-toplivozapravshchika/',
        '/voditel-spetstehnika/voditel-trala/',
        '/voditel-spetstehnika/voditel-tyagacha/',
        '/mashinisty-spetstehniki/',
        '/o-kompanii/',
        '/kontakty/'
    )
    $marker = (Invoke-WebRequest -Uri "$siteUrl/abs-deploy-version.txt?check=$releaseId" -UseBasicParsing -TimeoutSec 25).Content.Trim()
    if ($marker -ne $releaseId) { throw 'The public site did not serve this release' }
    foreach ($path in $checks) {
        $response = Invoke-WebRequest -Uri "$siteUrl$path" -UseBasicParsing -TimeoutSec 25
        $localFile = Join-Path $buildPath ($path.TrimStart('/') + 'index.html')
        Assert-DeployResponse $response $localFile $path
    }
    foreach ($file in @('assets/css/site.css', 'assets/js/site.js')) {
        $response = Invoke-WebRequest -Uri "$siteUrl/$file`?check=$releaseId" -UseBasicParsing -TimeoutSec 25
        Assert-DeployResponse $response (Join-Path $buildPath $file) "/$file"
    }
    # A cleanup failure must not roll back a release that already passed HTTP checks.
    $activated = $false
    Invoke-Remote 'finalize'
    $remotePrepared = $false
    Write-Host 'Deploy complete. Previous working version is in the server backup.' -ForegroundColor Green
}
catch {
    $failure = $_
    if ($activated) {
        Write-Warning 'Verification failed. Restoring the server backup...'
        try { Invoke-Remote 'rollback'; $remotePrepared = $false }
        catch { Write-Warning "Automatic rollback failed: $_" }
    }
    throw $failure
}
finally {
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
    if ($remotePrepared) { Write-Warning "A server staging directory remains at $stage. The live directory was not renamed." }
}
