[CmdletBinding()]
param(
    [string]$RemotePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$distPath = Join-Path $projectRoot 'dist'
$configPath = Join-Path $projectRoot '.deploy-config.json'
$sshHost = 'idealstroy.beget.tech'
$sshUser = 'idealstroy_dev'

if ([string]::IsNullOrWhiteSpace($RemotePath) -and (Test-Path -LiteralPath $configPath)) {
    $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $RemotePath = [string]$config.remotePath
}

if ([string]::IsNullOrWhiteSpace($RemotePath)) {
    $RemotePath = Read-Host 'Enter the full website directory path on Beget (once)'
    if ([string]::IsNullOrWhiteSpace($RemotePath)) {
        throw 'RemotePath is required. Upload cancelled.'
    }
    [ordered]@{ remotePath = $RemotePath } | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
    Write-Host "The path was saved locally in $configPath. This file is excluded from Git."
}

$remoteTarget = "$sshUser@$($sshHost):$RemotePath"

if ($RemotePath.Contains("`r") -or $RemotePath.Contains("`n") -or $RemotePath.Contains("'") -or $RemotePath.Contains('"')) {
    throw 'RemotePath must be a single SSH path without quotes or line breaks.'
}

Push-Location $projectRoot
try {
    Write-Host 'Running the final build and checks before upload...'
    & npm test
    if ($LASTEXITCODE -ne 0) {
        throw "Pre-deploy checks failed with exit code $LASTEXITCODE. Upload cancelled."
    }

    $files = Get-ChildItem -LiteralPath $distPath -Force
    if ($files.Count -eq 0) {
        throw 'The dist directory is empty. Upload cancelled.'
    }

    $backupDate = Get-Date -Format 'yyyyMMdd'
    $backupRemotePath = "~/abs-engineer.ru/backup-served-$backupDate.tgz"
    $backupCommand = "mkdir -p ~/abs-engineer.ru && tar -czf $backupRemotePath -C '$RemotePath' ."

    Write-Host "Creating the server backup at $backupRemotePath"
    Write-Host 'OpenSSH will request the server password for the backup now.'
    & ssh "$sshUser@$($sshHost)" $backupCommand
    if ($LASTEXITCODE -ne 0) {
        throw "Backup failed with exit code $LASTEXITCODE. Upload cancelled."
    }

    Write-Host "Uploading the final build to $sshUser@$($sshHost):$RemotePath"
    Write-Host 'OpenSSH will request the server password now. It is not saved by this script.'
    & scp -O -r @($files.FullName) $remoteTarget
    if ($LASTEXITCODE -ne 0) {
        throw "Upload failed with exit code $LASTEXITCODE."
    }

    Write-Host 'Upload completed successfully.'
} finally {
    Pop-Location
}
