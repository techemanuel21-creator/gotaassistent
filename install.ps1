# GotaAssistent - instalador e atualizador para Windows (PowerShell, sem administrador)
#   instalar  : irm https://raw.githubusercontent.com/techemanuel21-creator/gotaassistent/main/install.ps1 | iex
#   atualizar : irm https://raw.githubusercontent.com/techemanuel21-creator/gotaassistent/main/update.ps1  | iex
# Rodar de novo é seguro: troca os arquivos do programa e mantém as bibliotecas, os modelos de voz e os seus dados (%APPDATA%\Gota).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = 'techemanuel21-creator/gotaassistent'
$branch = 'main'
$root = Join-Path $env:LOCALAPPDATA 'GotaAssistent'
$app = Join-Path $root 'app'
$update = [bool]$env:GOTA_UPDATE
Write-Host ("== GotaAssistent: " + $(if ($update) { 'atualizando' } else { 'instalando' }) + " em $root") -ForegroundColor Cyan

function Update-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine') }
function Step($text) { Write-Host "-- $text" -ForegroundColor Yellow }

# 1. ferramentas: Bun (compila e roda o app) e Python 3.12 (voz, telas, WhatsApp, Outlook)
Update-Path
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Step 'Instalando o Bun (só para o seu usuário)...'
    winget install --id Oven-sh.Bun -e --scope user --accept-source-agreements --accept-package-agreements
    Update-Path
    if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { throw 'Nao consegui instalar o Bun. Instale em bun.sh e rode este comando de novo.' }
}
function Find-Python {
    foreach ($c in @(@('py', '-3.12'), @('python'))) {
        try {
            $exe = $c[0]; $extra = @($c | Select-Object -Skip 1)
            $v = & $exe @extra -c "import sys;print('%d.%d' % sys.version_info[:2])" 2>$null
            if ($LASTEXITCODE -eq 0 -and $v -eq '3.12') { return ,$c }
        } catch {}
    }
    return $null
}
$py = Find-Python
if (-not $py) {
    Step 'Instalando o Python 3.12 (só para o seu usuário)...'
    winget install --id Python.Python.3.12 -e --scope user --accept-source-agreements --accept-package-agreements
    Update-Path
    $py = Find-Python
    if (-not $py) { throw 'Nao consegui instalar o Python 3.12. Instale em python.org e rode este comando de novo.' }
}

# 2. o programa: fecha o GotaAssistent, baixa o código do GitHub e troca os arquivos (mantém node_modules, .venv e models)
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like "$root*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 1
$tmp = Join-Path $env:TEMP ('gotaassistent_dl_' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
    $zip = Join-Path $tmp 'src.zip'
    if ($env:GOTA_SOURCE_ZIP) {
        Copy-Item $env:GOTA_SOURCE_ZIP $zip
    } else {
        Step 'Baixando o código do GitHub...'
        Invoke-WebRequest "https://github.com/$repo/archive/refs/heads/$branch.zip?t=$([DateTime]::UtcNow.Ticks)" -OutFile $zip -UseBasicParsing
    }
    Expand-Archive $zip -DestinationPath $tmp -Force
    $src = (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName
    if (-not (Test-Path (Join-Path $src 'packages\desktop\package.json'))) { throw 'O download veio incompleto.' }
    New-Item -ItemType Directory -Force $app | Out-Null
    robocopy $src $app /MIR /XD node_modules .venv models out dist .turbo /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Falha ao copiar os arquivos (robocopy $LASTEXITCODE)." }
} finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
$version = 'desconhecida'
try {
    $c = Invoke-RestMethod "https://api.github.com/repos/$repo/commits/$branch" -Headers @{ 'User-Agent' = 'gotaassistent-installer' }
    $version = $c.sha.Substring(0, 7) + ' - ' + ($c.commit.message -split "`n")[0]
} catch {}
Set-Content (Join-Path $app 'VERSION.txt') $version -Encoding ASCII

Push-Location $app
try {
    # 3. bibliotecas do app (a primeira vez demora uns 10 minutos; depois só o que mudou)
    Step 'Instalando as bibliotecas do app (a primeira vez demora)...'
    git config core.autocrlf false 2>$null
    Get-ChildItem patches -File -ErrorAction SilentlyContinue | ForEach-Object {   # os patches precisam de quebra de linha LF
        $t = [IO.File]::ReadAllText($_.FullName)
        if ($t.Contains("`r`n")) { [IO.File]::WriteAllText($_.FullName, $t.Replace("`r`n", "`n"), (New-Object Text.UTF8Encoding($false))) }
    }
    & bun install
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar as bibliotecas do app (bun install).' }

    # 4. ambiente Python das funções do Gota (voz, telas, WhatsApp, Outlook)
    $venvPy = Join-Path $app 'python\.venv\Scripts\python.exe'
    if (-not (Test-Path $venvPy)) {
        Step 'Criando o ambiente Python...'
        $exe = $py[0]; $extra = @($py | Select-Object -Skip 1)
        & $exe @extra -m venv (Join-Path $app 'python\.venv')
    }
    Step 'Instalando as bibliotecas de voz e telas...'
    & $venvPy -m pip install --upgrade pip --quiet
    & $venvPy -m pip install -r (Join-Path $app 'python\requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar as bibliotecas Python.' }

    # 5. janela (Electron), servidor do app e interface
    Step 'Preparando a janela...'
    Push-Location (Join-Path $app 'packages\desktop')
    & bun run install-electron
    & bun ./scripts/copy-icons.ts dev
    Pop-Location
    & (Join-Path $app 'script\brand-electron.ps1') -Root $app   # GotaAssistent.exe (nome e logo do Gota no Gerenciador de Tarefas)
    Push-Location (Join-Path $app 'packages\opencode')
    & bun script/build-node.ts
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar o servidor do app.' }
    Pop-Location
    Push-Location (Join-Path $app 'packages\desktop')
    & bun run electron-vite build
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar a interface.' }
    Pop-Location
} finally {
    Pop-Location
}

# 6. atalhos na área de trabalho e no menu Iniciar (recriados sempre)
$shell = New-Object -ComObject WScript.Shell
$icon = Join-Path $app 'packages\desktop\icons\dev\icon.ico'
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))) {
    $lnk = $shell.CreateShortcut((Join-Path $dir 'GotaAssistent.lnk'))
    $lnk.TargetPath = (Get-Command powershell.exe).Source
    $lnk.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $app 'run.ps1') + '"'
    $lnk.WorkingDirectory = $app
    $lnk.IconLocation = $icon
    $lnk.Save()
}

Write-Host ''
Write-Host "Versao instalada: $version" -ForegroundColor Green
Write-Host 'Pronto! Abra o GotaAssistent pelo atalho na area de trabalho.' -ForegroundColor Green
Write-Host 'Na primeira vez: Modelos de IA (conecte um modelo com a sua chave de API) e, se quiser, Conexoes (WhatsApp e Outlook).'
Write-Host 'Atalhos: Ctrl+Alt+L liga, Ctrl+Alt+G pergunta rapida. Os modelos de voz sao baixados na primeira ligacao.'
Write-Host 'Para atualizar depois: irm https://raw.githubusercontent.com/techemanuel21-creator/gotaassistent/main/update.ps1 | iex'
