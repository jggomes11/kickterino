# Validação da alteração

Implementação em codex/secure-multi-account. Nenhuma release publicada.

## Resultados no ambiente Linux

- Node 24 / Electron 45.2.1.
- npm ci reproduzível (cache local temporário).
- npm test: suite de transporte, IPC, identidade, isolamento e interface.
- npm run test:electron: Chromium real, servidor local, credenciais fictícias; cookies, cabeçalhos Kick, redirecionamentos, timeout, invalidação e preload local.
- npm run test:accounts: main.js e renderer reais, respostas Kick controladas por protocolo só no bootstrap de teste; quatro identidades fictícias, oito players, preferências e cookies distintos; encerramento natural e reinício preservam quatro perfis. Display compartilhado X11 usado porque a bandeja requer ambiente gráfico.
- npm audit e npm audit --omit=dev: zero vulnerabilidades conhecidas no lockfile verificado.
- Pacote Linux diretório: electron-builder --linux --dir --publish never --config.electronDist=node_modules/electron/dist. Distribuição Electron 45.2.1 local já disponível; opção evita cache padrão fora das pastas graváveis. ASAR conferido: runtimes, módulos de segurança e licença presentes.

A execução headless sem display não valida o app completo (GTK da bandeja encerra o processo). O fixture de transporte isolado funciona headless. Cache npm padrão e cache Electron padrão eram somente leitura; os comandos usaram caches temporários. Essas adaptações são de teste, não mudam a inicialização do produto.

## Verificações pendentes no Windows

Workflow windows-validation.yml preparado, ainda não executado neste ambiente Linux. Ele gera instalador sem publicar, manifesto e checksum e executa a fixture nativa com perfis fictícios. Não há afirmação de instalador ou quatro perfis Windows já validados.

Login real e ganho de pontos dependem dos endpoints atuais da Kick e das contas do usuário. Validar duas contas reais antes de publicação estável, conforme README. Quatro slots fictícios não provam quatro contas reais recebendo pontos.
