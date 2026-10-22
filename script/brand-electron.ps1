# Faz uma copia do Electron com a marca do GotaAssistent: o executavel passa a se chamar GotaAssistent.exe, com o icone e os dados de versao do Gota.
# Assim o Gerenciador de Tarefas, a barra de tarefas e a bandeja mostram "GotaAssistent" (e nao "Electron"). Rodar de novo e seguro.
param([string]$Root = (Split-Path $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$dist = Get-ChildItem (Join-Path $Root 'node_modules\.bun\electron@*\node_modules\electron\dist') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $dist) { throw 'Electron nao encontrado: rode "bun run install-electron" em packages\desktop.' }
$rcedit = Get-ChildItem (Join-Path $Root 'node_modules\.bun\electron-winstaller@*\node_modules\electron-winstaller\vendor\rcedit.exe') -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $rcedit) { throw 'rcedit nao encontrado (vem com o electron-winstaller, instalado pelo bun install).' }
$out = Join-Path $Root 'packages\desktop\.gota-electron'
$exe = Join-Path $out 'GotaAssistent.exe'
$stamp = Join-Path $out 'branded.txt'
$electronVersion = (Get-Item (Join-Path $dist.FullName 'electron.exe')).VersionInfo.ProductVersion
$icon = Join-Path $Root 'packages\desktop\icons\dev\icon.ico'
$want = "$electronVersion|" + (Get-Item $icon).LastWriteTimeUtc.Ticks
if ((Test-Path $exe) -and (Test-Path $stamp) -and ((Get-Content $stamp -Raw).Trim() -eq $want)) { return }   # already branded

Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like "$out*" } | Stop-Process -Force -ErrorAction SilentlyContinue
robocopy $dist.FullName $out /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Falha ao copiar o Electron (robocopy $LASTEXITCODE)." }
Move-Item (Join-Path $out 'electron.exe') $exe -Force
$name = 'GotaAssistent'
& $rcedit.FullName $exe --set-icon $icon --set-version-string FileDescription $name --set-version-string ProductName $name --set-version-string CompanyName $name `
    --set-version-string InternalName $name --set-version-string OriginalFilename "$name.exe" --set-version-string LegalCopyright $name --set-file-version 1.0.0.0 --set-product-version 1.0.0
if ($LASTEXITCODE -ne 0) { throw 'Falha ao trocar o icone e os dados do executavel (rcedit).' }
Set-Content $stamp $want -Encoding ASCII
Write-Host "Executavel pronto: $exe"
