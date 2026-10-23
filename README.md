# GotaAssistent

O Gota, mordomo gato, como aplicativo de janela para Windows: um agente de programação e de operação do computador, com voz, telas, WhatsApp, Outlook, base de conhecimento e rotinas. Feito sobre o [opencode](https://github.com/sst/opencode) (licença MIT), com a identidade, a personalidade e as funções do Gota.

## Instalar em outra máquina (Windows 10/11)

Abra o PowerShell (não precisa ser administrador) e rode:

```powershell
irm https://raw.githubusercontent.com/techemanuel21-creator/gotaassistent/main/install.ps1 | iex
```

Ele instala o Bun e o Python 3.12 (só para o seu usuário, via winget, se faltarem), baixa o código, prepara tudo e cria o atalho **GotaAssistent** na área de trabalho. A primeira instalação leva cerca de 15 a 20 minutos (bibliotecas). Precisa de internet e de uns 4 GB livres.

## Instalador MSI offline (sem internet)

`powershell -ExecutionPolicy Bypass -File installer\build-msi.ps1` gera `installer\dist\GotaAssistent-<versão>.msi` (~560 MB) com tudo dentro: o app, o Python 3.12 e suas bibliotecas, o Electron e os modelos de voz (Vosk, Whisper base, Piper). Copie o arquivo para outra máquina e dê dois cliques: instala só para o usuário, sem administrador e sem rede. Só montar o MSI precisa de internet. Antes, abra o Gota uma vez e faça uma ligação para baixar os modelos de voz para `models\`.

## Atualizar

```powershell
irm https://raw.githubusercontent.com/techemanuel21-creator/gotaassistent/main/update.ps1 | iex
```

Troca o código pelo mais recente e mantém as bibliotecas, os modelos de voz e os seus dados (`%APPDATA%\Gota`).

## Primeiro uso

1. O app pergunta o seu nome e como tratá-lo.
2. **Modelos de IA** → conecte um modelo só com a chave de API (DeepSeek, OpenRouter, Google, OpenAI, Anthropic, Groq, Mistral, xAI ou qualquer provedor compatível com OpenAI).
3. **Conexões** → WhatsApp (QR code) e Outlook (código de login), se quiser.

## O que tem

- **Ligação por voz** e **pergunta rápida**, com o gato que sobe no canto da tela: `Ctrl+Alt+L` liga (e desliga), `Ctrl+Alt+G` faz uma pergunta e responde em voz alta. Também funciona com **"Hey Gota"** (em Ligar → Voz e microfone).
- **Telas** com apelidos e leitura por OCR; **WhatsApp** e **Outlook**; **base de conhecimento** de TI (Veeam, redes, Windows, Linux...) e habilidades passo a passo.
- **Rotinas** e tarefas em segundo plano (só leitura, com notificação).
- Agente de programação do opencode: edita arquivos, roda comandos (com permissão), LSP e formatadores.
- **Segundo plano:** fechar a janela só a esconde; o gato fica na bandeja do Windows (perto do relógio, talvez dentro do "^"), com atalhos, ligação e rotinas funcionando. Clique no ícone para abrir; o menu tem "Iniciar com o Windows" e "Sair".
- **Conversas:** botão direito numa conversa da faixa lateral → renomear, apagar ou **mesclar** (o contexto das outras passa para a conversa escolhida, que fica só uma).
- No Gerenciador de Tarefas o app aparece como **GotaAssistent**, com a logo do Gota.

## Para quem desenvolve

`bun install`, depois `cd packages\desktop; bun run electron-vite dev`. As funções nativas ficam em `python/` (`gota_native`: serviço local; `gota_mcp`: ferramentas do agente). Veja `GOTA2.md`.
