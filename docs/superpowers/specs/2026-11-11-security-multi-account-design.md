# Kickterino: tokens e quatro contas numa janela

## Decisão e objetivo

Em 11/11/2026, o usuário aprovou replicar as correções de tokens e o formato final de múltiplas contas do Twitchterino. Este documento registra esse escopo; o trabalho atual é planejamento, sem autorização inferida para publicar releases.

Até quatro contas opcionais numa única janela, com coleta simultânea independente. Alternar a conta exibida não interrompe as demais. Preservar as funcionalidades próprias da Kick: chat, pontos, players reais, rodízio, qualidade reduzida, favoritos, notificações, lojas, compras, relatórios e teste de limite.

## Abordagens

Escolhida: adaptar os módulos locais e a arquitetura final do Twitchterino, em duas etapas verificáveis: segurança da conta atual e depois isolamento de quatro runtimes. Reaproveita soluções já exercitadas, mas exige testar a integração Kick independentemente.

Alternativas descartadas: vários processos/perfis não reproduzem a janela única escolhida; trocar apenas um token global não permite coleta independente e atribuição assíncrona segura; reescrever com OAuth é outro projeto e não garante acesso aos pontos dos endpoints atuais.

## Restrições

- Quatro slots fixos opcionais: account-1 até account-4; uma janela principal, uma bandeja e um registro de inicialização.
- Slot1 preserva persist:kick e config.json na raiz do userData; slots2–4 usam persist:kick-account-N e accounts/account-N/config.json.
- Manter appId com.vinniisaantos.kickterino, perfil padrão instalado e suporte KICKTERINO_DATA para testes isolados.
- Novas contas mantêm os padrões Kick: farming=true, maxWatchers=2, rotation=true e lowQuality=true; preservar preferências existentes e migração configVersion atual.
- Tokens e XSRF somente no processo principal para consultas do aplicativo; páginas oficiais continuam administrando seus próprios cookies/login.
- Transporte usa a sessão do slot, HTTPS em https://kick.com, rotas conhecidas, redirecionamentos proibidos, timeout de 20 segundos e resposta máxima de 2 MiB.
- IPC aceita apenas o frame principal da interface local exata, com argumentos validados antes dos efeitos; preload indisponível a páginas remotas e subframes.
- Atualizações automáticas desativadas; metadados do fork jggomes11/kickterino; distribuição Windows somente Kickterino-Setup.exe, preservando licença MIT e autoria.
- Não copiar cookies de navegadores ou outros perfis, simular visualizações nem contornar controles de acesso da Kick.

## Arquitetura e sessão

main.js passa a controlar ciclo de vida global, janela, bandeja, instância única e gerenciador. account-runtime.js contém estado, sessão, cliente API, timers, players, lojas, fila de lojas, teste de limite, chat e relatórios de uma conta. account-manager.js mantém quatro IDs fixos e captura o runtime antes de aguardar comandos. Popups herdam a sessão da janela de origem, nunca a conta selecionada posteriormente.

security/requests.js, platform.js, ipc.js, accounts.js e account-view.js serão adaptados do Twitchterino, sem pacote compartilhado externo. kickFetch mantém Promise<{status,json}>, mas deixa de depender de executeJavaScript/apiReady. A janela oficial permanece para login, não para transportar consultas autenticadas. Scripts de inspeção de vídeo continuam sem tokens.

Verificar identidade por resposta autenticada dos endpoints /api/v1/user e /api/v2/user: priorizar ID estável validado, não inferir identidade pela presença de cookie. Se não houver identidade verificável, não coletar nem atribuir relatórios a uma conta presumida. Validar o formato real durante a integração; falha deve resultar em estado de sessão pendente/indisponível, sem fallback que injete tokens.

Renovação de cookies invalida consultas antigas e exige reverificação; mesma identidade preserva baseline. Mudança verificada de identidade reinicia baselines e arquiva/restaura daily e purchases por conta. Relatórios legados sem identificação são adotados pela primeira identidade verificada. Logout suspende novas operações, cancela consultas/filas/timers relevantes, fecha players/lojas da conta e limpa somente sua sessão. Toda escrita assíncrona exige geração e identidade ainda válidas.

Eventos, respostas e snapshots carregam accountId. UI descarta respostas de seleção anterior, limpa chat/modal/relatório ao trocar e apresenta quatro seletores com nome e estado. Autostart é global; coleta e preferências são por conta. Notificações selecionam a conta de origem ao abrir o canal. Segunda abertura foca a janela existente; fechar mantém a bandeja; Sair encerra todos os runtimes.

## Verificação e entrega

Primeiro demonstrar segurança e compatibilidade numa conta, depois executar regressões com quatro slots. Testes de transporte/IPC usam credenciais fictícias; fixture Electron comprova sessão real do Chromium e ausência de tokens no JavaScript. Fixture Windows inicia um app, grava cookies fictícios distintos, alterna slots e encerra/reabre naturalmente para comprovar persistência, incluindo foco pela segunda execução.

Validação real de login, pontos e chat depende das contas do usuário no Windows. Duas contas reais são o mínimo proposto, seguindo a aceitação final do Twitchterino; quatro slots são exercitados automaticamente, sem afirmar quatro contas reais verificadas. Não aplicar a medição antiga de limite como garantia da plataforma.

Empacotar instalador e conferir conteúdo, origem do build e checksums. Auditar dependências sem atualização incidental do Electron 45.2.1. Preparar candidato local; publicação estável aguarda resultado real e autorização de publicação. Decisões técnicas acima são propostas do implementador para concretizar o formato aprovado.
