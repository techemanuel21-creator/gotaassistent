# Gota 2.0: the official opencode (so opencode's free models work) with the Gota identity, persona and abilities.
#   .\gota.ps1            terminal interface (Gota theme) in the current folder
#   .\gota.ps1 web        window interface: local server + the Gota-branded app, opened in the browser
#   .\gota.ps1 run "..."  one question, answer in the terminal
param([Parameter(ValueFromRemainingArguments = $true)] $Rest)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
$python = Join-Path $root '..\desktop\.venv\Scripts\python.exe'
$python = if (Test-Path $python) { (Resolve-Path $python).Path } else { 'python' }
# the official engine ships inside the project (desktop/opencode), or comes from winget
$exe = @((Join-Path $root '..\desktop\opencode\opencode.exe'), (Join-Path $root 'opencode\opencode.exe')) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $exe) { $exe = (Get-Command opencode -ErrorAction SilentlyContinue).Source }
if (-not $exe) { throw 'opencode.exe nao encontrado (winget install SST.opencode).' }
$env:OPENCODE_CONFIG_DIR = (& $python (Join-Path $root 'config\build_config.py')).Trim()
if ($Rest -and $Rest[0] -eq 'web') {
    $ui = Join-Path $root 'packages\app'
    Start-Process $exe -ArgumentList 'serve', '--port', '4096', '--hostname', '127.0.0.1', '--cors', 'http://127.0.0.1:4444' -WindowStyle Hidden
    Start-Process bun -ArgumentList 'x', 'vite', 'preview', '--port', '4444', '--strictPort', '--host', '127.0.0.1' -WorkingDirectory $ui -WindowStyle Hidden
    Start-Sleep 6
    Start-Process 'http://127.0.0.1:4444'
    return
}
& $exe @Rest
