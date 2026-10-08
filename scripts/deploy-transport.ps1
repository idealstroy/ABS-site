# Send UTF-8 through a native process, not PowerShell's text pipeline. Windows
# .NET may add a stdin preamble; the Base64 decoder handles it before invoking sh.
function ConvertTo-DeployShellTransport {
    param([string]$Program)
    $encoding = New-Object System.Text.UTF8Encoding($false)
    $normalized = $Program.TrimStart([char]0xFEFF).Replace("`r`n", "`n").Replace("`r", "`n")
    # Decode in a Unix pipe before sh reads it: SSH-side stdin encoding cannot
    # turn the first assignment into a command. GNU base64 ignores BOM/CR noise.
    return [pscustomobject]@{
        Command = "command -v base64 >/dev/null 2>&1 || { echo 'Hosting command base64 not found' >&2; exit 127; }; base64 -di | sh -s"
        InputText = [Convert]::ToBase64String($encoding.GetBytes($normalized)) + "`n"
    }
}

function Invoke-DeployProcessInput {
    param([string]$Executable, [string[]]$Arguments, [string]$InputText)
    $quoted = @($Arguments | ForEach-Object {
        if ($_.Contains('"') -or $_.EndsWith('\')) { throw 'Unsupported process argument.' }
        '"' + $_ + '"'
    }) -join ' '
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $Executable
    $startInfo.Arguments = $quoted
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    # Keep stderr/console available for OpenSSH password prompts and errors.
    $startInfo.RedirectStandardError = $false
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        $null = $process.Start()
        $encoding = New-Object System.Text.UTF8Encoding($false)
        $text = $InputText.TrimStart([char]0xFEFF).Replace("`r`n", "`n").Replace("`r", "`n")
        $bytes = $encoding.GetBytes($text)
        $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
        $process.StandardInput.BaseStream.Close()
        $stdout = $process.StandardOutput.ReadToEnd()
        $process.WaitForExit()
        return [pscustomobject]@{ Output = $stdout; ExitCode = $process.ExitCode }
    } finally { $process.Dispose() }
}
