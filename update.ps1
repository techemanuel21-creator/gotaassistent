# GotaAssistent - atualizador: baixa o código mais recente do GitHub e atualiza as bibliotecas. Mantém os seus dados, modelos de voz e ambiente.
#   irm https://raw.githubusercontent.com/techemanuel21-creator/gotaassistent/main/update.ps1 | iex
$env:GOTA_UPDATE = '1'
try {
    Invoke-Expression (Invoke-RestMethod ('https://raw.githubusercontent.com/techemanuel21-creator/gotaassistent/main/install.ps1?t=' + [DateTime]::UtcNow.Ticks))
} finally {
    Remove-Item Env:\GOTA_UPDATE -ErrorAction SilentlyContinue
}
