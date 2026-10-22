# Abre o GotaAssistent (janela e bandeja). Usado pelo atalho criado pelo instalador. Com -Hidden abre so na bandeja (usado ao iniciar com o Windows).
param([switch]$Hidden)
$root = $PSScriptRoot
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
$python = Join-Path $root 'python\.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { $python = 'python' }
# personalidade (nome e tratamento do perfil), permissoes e funcoes do Gota para o motor
$env:OPENCODE_CONFIG_DIR = (& $python (Join-Path $root 'config\build_config.py')).Trim()
# executavel com a marca do Gota (Gerenciador de Tarefas e bandeja mostram GotaAssistent, nao Electron)
& (Join-Path $root 'script\brand-electron.ps1') -Root $root
$exe = Join-Path $root 'packages\desktop\.gota-electron\GotaAssistent.exe'
if (-not (Test-Path $exe)) { throw 'GotaAssistent.exe nao encontrado: rode o instalador de novo.' }
$args = @('.')
if ($Hidden) { $args += '--hidden' }
Start-Process -FilePath $exe -ArgumentList $args -WorkingDirectory (Join-Path $root 'packages\desktop')
