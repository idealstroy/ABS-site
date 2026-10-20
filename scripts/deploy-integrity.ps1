function Get-DeployStreamSha256 {
    param([System.IO.Stream]$Stream)
    if ($Stream.CanSeek) { $Stream.Position = 0 }
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hasher.ComputeHash($Stream)).Replace('-', '').ToLowerInvariant() }
    finally { $hasher.Dispose() }
}

function Get-DeployFileSha256 {
    param([string]$Path)
    $stream = [System.IO.File]::OpenRead($Path)
    try { return Get-DeployStreamSha256 $stream }
    finally { $stream.Dispose() }
}

function Assert-DeployResponse {
    param($Response, [string]$LocalFile, [string]$Url)
    if ($Response.StatusCode -ne 200) { throw "HTTP $($Response.StatusCode): $Url" }
    $expected = Get-DeployFileSha256 $LocalFile
    $actual = Get-DeployStreamSha256 $Response.RawContentStream
    if ($actual -ne $expected) { throw "Public file differs from release: $Url" }
}
