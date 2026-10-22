# Gota 2.0

O Gota (mordomo gato) sobre o **opencode**: o motor oficial do opencode (por isso os modelos gratuitos dele funcionam) com a identidade, a personalidade e as funções do Gota.

| Peça | Onde | O que faz |
|---|---|---|
| Motor | `desktop/opencode/opencode.exe` (oficial, 1.19.1) | agente de programação (`build`), terminal, sessões, LSP e formatadores, modelos gratuitos |
| Personalidade e config | `config/build_config.py` | gera `%APPDATA%\Gota\opencode-config`: persona ("senhor Emanuel", lida do perfil do Gota), tema do terminal, permissões, servidor MCP |
| Funções do Gota | `python/gota_mcp/server.py` (MCP) | tela com OCR, WhatsApp, Outlook, base de conhecimento, memória, script Cisco, voz |
| Interface de janela | `packages/app` + `packages/ui` (código do opencode 1.19.1, editado) | tema azul-marinho do Gota, gato animado (piscar, ler ao pensar), logo, nome e textos em português |
| Ícones | `script/gota-icons.py` | gera favicon, PWA e apple-touch com o gato |

Rodar: `.\gota.ps1` (terminal) ou `.\gota.ps1 web` (janela). Compilar a interface: `cd packages\app; bun run build`.

Observações
- O servidor hospedado do opencode (Zen, Go e o plano gratuito dele) foi removido: `disabled_providers` na configuração e nenhuma tela de assinatura ou de limite gratuito. O motor continua sendo o opencode oficial, só que sem esse provedor.
- Instalar dependências no Windows: os arquivos `patches/*.patch` precisam de quebras de linha LF (`git config core.autocrlf false`).

## Modelos
O Gota 2.0 conecta qualquer modelo só com a chave de API: DeepSeek, OpenRouter, Google, OpenAI, Anthropic, Groq, Mistral, xAI e "Provedor personalizado compatível com OpenAI" (qualquer outro), na janela (Conectar provedor) ou no terminal (`/connect`). Sem modelo conectado, a janela mostra "Selecionar modelo".

## GotaAssistent desktop (janela)

O app de janela (Electron, do próprio opencode) com a identidade do Gota, no layout de abas com uma **faixa lateral** própria (Criar, Procurar, Projetos, Ligar, Telas, Conexões, Rotinas, Modelos de IA, e as conversas agrupadas por projeto).

| Função | Onde | Como funciona |
|---|---|---|
| Ligação por voz | painel **Ligar** | microfone → texto (Vosk/Whisper, offline) → agente → voz do Gota (Piper), com o gato de telefone (ouvindo, pensando, falando). Fala só as 3 primeiras frases; o resto fica na tela |
| Microfone e "Hey Gota" | **Ligar → Voz e microfone** | escolhe o microfone, testa e liga o "Hey Gota" |
| Ver telas | painel **Telas** | miniaturas das telas, apelidos, analisar uma ou todas (OCR do Windows, linhas de erro primeiro) |
| WhatsApp e Outlook | painel **Conexões** | WhatsApp: abre o WhatsApp Web e você lê o QR code. Outlook: código de login da Microsoft |
| Rotinas e tarefas | painel **Rotinas** | rotinas por horário e tarefas em segundo plano, só leitura, com notificação do Windows |

Tudo isso roda no serviço nativo `python/gota_native` (API local com senha, iniciada pelo app). O agente também usa essas funções como ferramentas (`python/gota_mcp`).

Rodar em desenvolvimento: `cd packages\desktop; bun run electron-vite dev` (com `OPENCODE_CONFIG_DIR` apontando para a saída de `python config\build_config.py`).
Ícones: `python script\gota-emblem.py`. Estilo: `packages/app/src/gota/gota.css`.