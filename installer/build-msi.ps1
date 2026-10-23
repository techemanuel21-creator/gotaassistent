# GotaAssistent - monta o instalador MSI 100% offline (por usuario, sem administrador).
# Dentro dele vai TUDO: o app (com o motor), o Electron, o Python 3.12 com as bibliotecas, os modelos de voz (Vosk, Whisper base, Piper) e a configuracao.
# Uso:  powershell -ExecutionPolicy Bypass -File installer\build-msi.ps1     ->  installer\dist\GotaAssistent-<versao>.msi
# Precisa de internet so para MONTAR (Python, bibliotecas, ferramentas do MSI); o MSI pronto instala sem rede.
param([string]$Version = '1.0.0', [switch]$SkipBuild, [ValidateSet('zip', 'msi')][string]$Format = 'zip')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = Split-Path $PSScriptRoot
$stage = Join-Path $PSScriptRoot 'stage'
$dist = Join-Path $PSScriptRoot 'dist'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
function Step($t) { Write-Host "== $t" -ForegroundColor Cyan }

# 0. Python 3.12 do sistema (so para baixar as bibliotecas certas) e o Bun
$hostPy = @('py', '-3.12')
& $hostPy[0] $hostPy[1] -c "import sys;print(sys.version)" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Precisa do Python 3.12 instalado para montar o MSI.' }
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { throw 'Precisa do Bun para montar o MSI.' }

# 1. o app: motor + janela (out/)
if (-not $SkipBuild) {
    Step 'Compilando o motor e a interface'
    Push-Location (Join-Path $repo 'packages\opencode'); & bun script/build-node.ts; if ($LASTEXITCODE -ne 0) { throw 'build-node falhou' }; Pop-Location
    Push-Location (Join-Path $repo 'packages\desktop'); & bun ./scripts/copy-icons.ts dev; & bun run electron-vite build; if ($LASTEXITCODE -ne 0) { throw 'electron-vite falhou' }; Pop-Location
}

Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage, $dist | Out-Null
$app = Join-Path $stage 'app'
New-Item -ItemType Directory -Force $app | Out-Null

# 2. pasta do app para o electron-builder: out/, icones e as bibliotecas de execucao (sem as de desenvolvimento)
Step 'Preparando o app'
Copy-Item (Join-Path $repo 'packages\desktop\out') (Join-Path $app 'out') -Recurse
Copy-Item (Join-Path $repo 'packages\desktop\icons\dev') (Join-Path $app 'resources\icons') -Recurse
Copy-Item (Join-Path $repo 'packages\desktop\src\overlay') (Join-Path $app 'src\overlay') -Recurse   # o popup do Ctrl+Alt+L/G (a janela do gato)
$deskPkg = Get-Content (Join-Path $repo 'packages\desktop\package.json') -Raw | ConvertFrom-Json
$rootPkg = Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json
$deps = [ordered]@{}
foreach ($p in $deskPkg.dependencies.PSObject.Properties) {
    $v = $p.Value
    if ($v -like 'catalog:*') { $v = $rootPkg.workspaces.catalog.($p.Name) }
    $deps[$p.Name] = $v
}
$nodePty = '@lydell/node-pty-win32-x64'
$deps[$nodePty] = $rootPkg.workspaces.catalog.'@lydell/node-pty'
$pkg = [ordered]@{ name = 'gotaassistent'; productName = 'GotaAssistent'; version = $Version; description = 'GotaAssistent'; author = 'GotaAssistent'; type = 'module'; main = './out/main/index.js'; dependencies = $deps }
$noBom = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $app 'package.json'), ($pkg | ConvertTo-Json -Depth 5), $noBom)   # sem BOM: o electron-builder nao le JSON com BOM
Push-Location $app
& bun install --production --linker hoisted
if ($LASTEXITCODE -ne 0) { throw 'bun install (app) falhou' }
Pop-Location

# 3. Python embutido + bibliotecas (tudo dentro de python\runtime)
Step 'Python embutido e bibliotecas'
$extra = Join-Path $stage 'extra'
$py = Join-Path $extra 'python'
New-Item -ItemType Directory -Force (Join-Path $py 'runtime') | Out-Null
$cache = Join-Path $PSScriptRoot 'cache'
New-Item -ItemType Directory -Force $cache | Out-Null
$embed = Join-Path $cache 'python-3.12.10-embed-amd64.zip'
if (-not (Test-Path $embed)) { Invoke-WebRequest 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip' -OutFile $embed -UseBasicParsing }
Expand-Archive $embed -DestinationPath (Join-Path $py 'runtime') -Force
$site = Join-Path $py 'runtime\Lib\site-packages'
New-Item -ItemType Directory -Force $site | Out-Null
& $hostPy[0] $hostPy[1] -m pip install --quiet --disable-pip-version-check --only-binary=:all: --target $site -r (Join-Path $repo 'python\requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'pip falhou' }
# o python embutido le so este arquivo: bibliotecas + o codigo do Gota (a pasta python, acima de runtime)
Set-Content (Join-Path $py 'runtime\python312._pth') "python312.zip`r`n.`r`nLib\site-packages`r`n..`r`nimport site`r`n" -Encoding ASCII
Get-ChildItem $site -Recurse -Directory -Force -Include '__pycache__', 'tests', 'test' -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch 'numpy|scipy' } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

# 4. o codigo do Gota (python e config) e os modelos de voz
Step 'Codigo do Gota e modelos de voz'
foreach ($d in 'gota', 'gota_mcp', 'gota_native') { Copy-Item (Join-Path $repo "python\$d") (Join-Path $py $d) -Recurse }
Get-ChildItem $py -Recurse -Directory -Force -Filter '__pycache__' | Where-Object { $_.FullName -notlike "*runtime*" } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $repo 'config') (Join-Path $extra 'config') -Recurse
$models = Join-Path $extra 'models'
New-Item -ItemType Directory -Force $models | Out-Null
foreach ($m in 'piper', 'vosk-pt') {
    $src = Join-Path $repo "models\$m"
    if (-not (Test-Path $src)) { throw "Falta o modelo de voz: $src (abra o Gota e faca uma ligacao uma vez para baixa-lo)" }
    Copy-Item $src (Join-Path $models $m) -Recurse
}
$wh = Join-Path $repo 'models\whisper\models--Systran--faster-whisper-small'
if (-not (Test-Path $wh)) { throw "Falta o modelo Whisper small: $wh" }
New-Item -ItemType Directory -Force (Join-Path $models 'whisper') | Out-Null
Copy-Item $wh (Join-Path $models 'whisper\models--Systran--faster-whisper-small') -Recurse

# 5. electron-builder -> MSI (por usuario). Usa o Electron que ja esta em node_modules (sem baixar outro).
Step 'Gerando o MSI'
$electronDist = (Get-ChildItem (Join-Path $repo 'node_modules\.bun\electron@*\node_modules\electron\dist') -Directory | Select-Object -First 1).FullName
$cfg = @"
module.exports = {
  appId: 'ai.opencode.desktop.dev',
  productName: 'GotaAssistent',
  artifactName: 'GotaAssistent-`${version}.`${ext}',
  electronDist: String.raw``$electronDist``,
  electronVersion: '$((Get-Item (Join-Path $electronDist 'electron.exe')).VersionInfo.ProductVersion)',
  directories: { output: String.raw``$dist``, buildResources: 'resources' },
  npmRebuild: false,
  asar: true,
  asarUnpack: ['**/*.node', '**/node-pty*/**'],
  files: ['out/**/*', 'src/overlay/**/*', 'resources/icons/**/*', 'package.json', 'node_modules/**/*', '!node_modules/**/{test,tests,__tests__,*.md,*.map}'],
  extraResources: [
    { from: 'resources/icons', to: 'icons' },
    { from: String.raw``$(Join-Path $repo 'packages\ui\src\assets\gota-cat')``, to: 'ui/src/assets/gota-cat' },
  ],
  extraFiles: [
    { from: String.raw``$py``, to: 'python' },
    { from: String.raw``$(Join-Path $extra 'config')``, to: 'config' },
    { from: String.raw``$models``, to: 'models' },
  ],
  protocols: { name: 'GotaAssistent', schemes: ['opencode'] },
  win: { icon: 'resources/icons/icon.ico', target: ['$(if ($Format -eq 'msi') { 'msi' } else { 'dir' })'], signAndEditExecutable: true },
  msi: { oneClick: true, perMachine: false, createDesktopShortcut: true, createStartMenuShortcut: true, runAfterFinish: true, shortcutName: 'GotaAssistent' },
}
"@
[IO.File]::WriteAllText((Join-Path $app 'electron-builder.config.cjs'), $cfg, $noBom)
Push-Location $app
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
& bun --bun (Join-Path $repo 'packages\desktop\node_modules\electron-builder\cli.js') --win $(if ($Format -eq 'msi') { 'msi' } else { 'dir' }) --config electron-builder.config.cjs --publish never
if ($LASTEXITCODE -ne 0) { throw 'electron-builder falhou' }
Pop-Location
if ($Format -eq 'msi') {
    Get-ChildItem $dist -Filter *.msi | ForEach-Object { Write-Host ("MSI pronto: {0} ({1:N0} MB)" -f $_.FullName, ($_.Length / 1MB)) -ForegroundColor Green }
} else {
    # zip portatil: GotaAssistent.exe fica na RAIZ da pasta do Gota, junto de python, models e config; os dados do programa vao para a pasta "data" dela
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zipFile = Join-Path $dist "GotaAssistent-$Version.zip"
    Remove-Item $zipFile -ErrorAction SilentlyContinue
    [IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $dist 'win-unpacked'), $zipFile, [IO.Compression.CompressionLevel]::Optimal, $false)
    Write-Host ("ZIP pronto: {0} ({1:N0} MB)" -f $zipFile, ((Get-Item $zipFile).Length / 1MB)) -ForegroundColor Green
}
