# Kickterino Security and Multi-account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for inline execution or superpowers:subagent-driven-development if the user chooses delegation. Track steps using checkboxes. Approved for implementation; source changes completed, native Windows and live-account acceptance pending.

**Goal:** Replicar o tratamento seguro de tokens e quatro contas opcionais numa janela do Twitchterino, preservando funções Kick.

**Architecture:** Primeiro proteger transporte, identidade e IPC na conta atual; depois extrair runtimes isolados sob um único shell. Adaptar módulos locais do Twitchterino, testando contratos Kick independentemente.

**Tech Stack:** Electron 45.2.1, electron-builder 26.18.0, JavaScript CommonJS/vanilla, Node >=22.13 (validar com Node24), node:test; sem novas dependências de produto.

**Spec:** docs/superpowers/specs/2026-11-11-security-multi-account-design.md

## Global Constraints

- Quatro slots fixos opcionais: account-1 até account-4; uma janela principal, uma bandeja e um registro de inicialização.
- Slot1 preserva persist:kick e config.json na raiz do userData; slots2–4 usam persist:kick-account-N e accounts/account-N/config.json.
- Manter appId com.vinniisaantos.kickterino, perfil padrão instalado e suporte KICKTERINO_DATA para testes isolados.
- Novas contas mantêm os padrões Kick: farming=true, maxWatchers=2, rotation=true e lowQuality=true; preservar preferências existentes e migração configVersion atual.
- Tokens e XSRF somente no processo principal para consultas do aplicativo; páginas oficiais continuam administrando seus próprios cookies/login.
- Transporte usa a sessão do slot, HTTPS em https://kick.com, rotas conhecidas, redirecionamentos proibidos, timeout de 20 segundos e resposta máxima de 2 MiB.
- IPC aceita apenas o frame principal da interface local exata, com argumentos validados antes dos efeitos; preload indisponível a páginas remotas e subframes.
- Atualizações automáticas desativadas; metadados do fork jggomes11/kickterino; distribuição Windows somente Kickterino-Setup.exe, preservando licença MIT e autoria.
- Não copiar cookies de navegadores ou outros perfis, simular visualizações nem contornar controles de acesso da Kick.

## Review Focus

- Logout durante consulta/fila de lojas: nenhuma resposta antiga pode restaurar estado ou abrir a próxima loja.
- Cookie renovado para a mesma identidade conserva baseline; outra identidade separa relatórios.
- Seleção A→B com chat, relatório, popup ou notificação pendente mantém a origem correta.
- Slots novos não compartilham arrays/objetos de configuração e slot1 mantém os dados antigos.
- Bloqueio/expiração na Kick resulta em estado indisponível sem fallback com token na página.

## Task 1: Transporte autenticado da conta atual

**Files:** criar security/requests.js, security/platform.js, tests/requests.test.cjs, tests/platform.test.cjs; modificar main.js (sessionToken/kickFetch/poll), package.json.

**Interfaces:** adaptar createSessionClient({getSession,getHeaders,resolveUrl,timeoutMs,maxResponseBytes}) → {request,invalidate,suspend,resume,generation}; createPlatformClient('kick',getSession) → cliente; request(path,{method='GET',body}={}) → Promise<{status,json}>.

- [x] Escrever testes request_uses_selected_session, request_rejects_redirect_timeout_oversize e kick_routes_reject_untrusted_input: sessão recebida é a selecionada; redirects='error'; abort é disparado em timeout; limite 2 MiB inclui stream sem Content-Length; nenhuma consulta fora da allowlist lê cookies ou faz fetch. Testar cookies malformados e resposta 401/403 sem vazamento.
- [x] Executar `node --test tests/requests.test.cjs tests/platform.test.cjs`; confirmar falhas por módulos/contratos ausentes.
- [x] Adaptar os módulos homônimos do Twitchterino. Permitir GET /api/v1/user, /api/v2/user, /api/v2/channels/:slug e sufixos /me e /points; POST somente /api/v2/messages/send/:id. Validar slug [a-z0-9_-]{2,30} e ID decimal positivo de até 20 dígitos. Construir Bearer e X-XSRF-TOKEN no main. Trocar kickFetch e remover dependência de apiReady nas consultas/poll, preservando login oficial.
- [x] Adicionar script test com `node --test tests/*.test.cjs` e engines Node >=22.13. Executar os testes anteriores; exigir zero falhas.
- [x] Commit: `git add main.js security/requests.js security/platform.js tests/requests.test.cjs tests/platform.test.cjs package.json && git commit -m "fix: keep Kick API credentials in the main process"`.

## Task 2: IPC e ciclo de identidade

**Files:** criar security/ipc.js, security/accounts.js, tests/ipc.test.cjs, tests/accounts.test.cjs, tests/application.test.cjs, tests/helpers/app.cjs; modificar main.js e preload.js.

**Interfaces:** createIpcRegistrar({ipcMain,getMainWindow,uiDocument,platform,getContext}) → handleIpc(channel,handler); validateIpcArgs(channel,args,context) → argumentos validados; selectReportAccount(config,identity) → boolean de mudança. Adaptar APIs homônimas Twitch, mantendo apenas campos de relatório Kick.

- [x] Escrever testes ipc_rejects_remote_subframe_other_document, ipc_validates_every_registered_command, logout_cancels_store_queue_and_pending_poll, same_identity_renewal_preserves_baseline, changed_identity_archives_reports e unverified_identity_does_not_collect. Asserções: zero efeitos para origem/argumento inválido; daily/purchases preservados na mesma identidade e restaurados ao retornar; nenhuma escrita/reabertura de loja após logout.
- [x] Executar `node --test tests/ipc.test.cjs tests/accounts.test.cjs tests/application.test.cjs`; registrar falhas esperadas.
- [x] Centralizar todos os handlers; bloquear navegação/popup da UI e expor preload somente no documento local/frame principal. Adaptar limites Kick do validador Twitch: chat até 500 caracteres e chatroom conhecido; filas até 100 slugs únicos conhecidos; maxWatchers 1–30; custos 0/300/500/1000 conforme comando; retângulos finitos dentro do viewport. Manter os contratos válidos atuais.
- [x] Verificar identidade autenticada, invalidar gerações em mudanças de cookie/logout, impedir operações até reverificação e aplicar fences a poll, chat, relatórios, lojas e teste de limite. Separar relatórios por identidade; migrar legado só na primeira identidade verificada. Cancelar fila antes de fechar lojas no logout.
- [x] Executar `npm test`; exigir zero falhas e cobertura de todos os canais registrados pelo helper.
- [x] Commit dos arquivos desta tarefa: `git commit -m "fix: guard Kick IPC and account lifecycle"` após adicionar somente esses arquivos.

## Task 3: Quatro runtimes isolados

**Files:** criar account-runtime.js, account-manager.js, tests/multi-account.test.cjs; modificar main.js, security/ipc.js e tests/helpers/app.cjs.

**Interfaces:** createAccountRuntime({id,partition,dataDirectory,getMainWindow,emit,onChanged,showMain,isOpenAtLogin,setOpenAtLogin}) → {id,partition,start,snapshot,poll,invoke,getIpcContext,stop}; createAccountManager({runtimes,initialAccountId}) → {contexts,snapshot,select,invoke,acceptEvent,activeId}. invoke(id,command,args,event) → Promise<{accountId,result}>. Usar account-1…account-4, como no Twitchterino.

- [x] Escrever testes four_runtimes_are_independent, selection_keeps_background_players, logout_only_stops_own_slot, popup_inherits_origin_session, config_defaults_are_deeply_independent e slot1_preserves_existing_profile. Asserções: quatro sessões/configs distintas; logout A não altera B; alterar channels/daily de A não altera B; segunda execução só foca shell.
- [x] Executar `node --test tests/multi-account.test.cjs`; confirmar falhas antes da extração.
- [x] Extrair as funções por conta para factory sem redesenhar players/chat/qualidade/teste de limite. main.js retém shell/tray/autostart/lock; inicializar quatro slots, mas não players sem identidade verificada. Usar paths fixos do spec e defaults independentes. Encerrar todos os runtimes em Sair.
- [x] Adaptar envelope IPC account:command {accountId,command,args} e account:select id; capturar runtime antes de await. Autostart e app:quit permanecem globais. Snapshot agrega metadados de slots sem credenciais; notificações carregam origem e a selecionam antes de abrir canal.
- [x] Executar `npm test`; exigir zero falhas, inclusive regressões da conta única.
- [x] Commit dos arquivos desta tarefa: `git commit -m "feat: isolate four Kick account runtimes"`.

## Task 4: Seleção de conta e proteção da interface

**Files:** criar security/account-view.js, tests/account-view.test.cjs; modificar preload.js, renderer/index.html, renderer/renderer.js e renderer/features.css.

**Interfaces:** window.kick.selectAccount(id) → Promise<snapshot>; ações existentes capturam accountId ao serem chamadas; eventos e respostas incluem accountId. Adaptar guard de visualização do Twitchterino para aceitar somente a seleção vigente, inclusive ordem de solicitações.

- [x] Escrever testes delayed_A_cannot_replace_B, rapid_selection_keeps_latest, delayed_report_and_chat_keep_owner e frozen_bridge_wrapper_works. Asserções: seleção final vence; resposta A não renderiza em B; bridge congelada do contextBridge continua utilizável.
- [x] Executar `node --test tests/account-view.test.cjs`; confirmar falhas esperadas.
- [x] Adicionar quatro seletores com nomes/status no formato Twitchterino. Limpar chat/modal/relatório ao selecionar; rejeitar eventos antigos sem suspender coleta. Garantir ações e exportação de relatório vinculadas à origem. Manter controles Kick existentes.
- [x] Executar `npm test`; inspecionar Electron com fixture fictícia e alternância rápida; verificar seleção, notificações e ausência de dados cruzados.
- [x] Commit dos arquivos desta tarefa: `git commit -m "feat: switch Kick accounts in one window"`.

## Task 5: Fixture Electron, instalador e validação Windows

**Files:** criar scripts/test-electron.cjs, tests/electron-fixture.cjs, scripts/validate-accounts.cjs, scripts/package-windows-release.cjs, tests/policy.test.cjs, tests/account-fixture.test.cjs e .github/workflows/windows-validation.yml; modificar package.json, package-lock.json e README.md.

**Interfaces:** `npm run test:electron` executa fixture isolada; `node scripts/validate-accounts.cjs` valida um app e quatro slots em perfil temporário; `node scripts/package-windows-release.cjs` empacota sem publicar e produz manifesto de commit/checksums. Adaptar scripts equivalentes do Twitchterino, sem caminhos de release antigos.

- [x] Escrever testes installer_only_includes_runtime_security_license, updater_never_runs e four_slot_fixture_requires_natural_restart: pacote inclui módulos e LICENSE; somente nsis no Windows; nenhuma chamada de updater; fixture falha se faltar qualquer slot/persistência. Executar `node --test tests/policy.test.cjs tests/account-fixture.test.cjs` e confirmar falhas.
- [x] Remover electron-updater e configuração portable; apontar metadados para jggomes11/kickterino, preservar appId/nome/perfil, incluir módulos e LICENSE no pacote. Atualizar lockfile e resolver findings de auditoria com alterações compatíveis verificadas, sem mudança incidental do Electron.
- [x] Implementar fixture Electron com transporte controlado e tokens fictícios: redirecionamento recusado, sessão correta, token ausente dos scripts/IPC, rejeição de páginas remotas e resultado antigo após logout. Adicionar script test:electron.
- [x] Implementar fixture Windows com quatro cookies fictícios distintos, preferências diferentes, alternância sem parar timers, segunda abertura focando a mesma janela e quit/reopen natural preservando cookies/config. Cleanup não pode converter falha em sucesso. CI executa npm ci, npm test, npm run test:electron, fixture Windows e build sem publish.
- [ ] Executar `npm ci`, `npm test`, `npm run test:electron`, `npm audit`, `npm audit --omit=dev` e `npm run dist:linux -- --dir --publish never`. Executar no Windows `node scripts/validate-accounts.cjs` e `node scripts/package-windows-release.cjs`; exigir resultados reais registrados e conteúdo/checksums conferidos. Reportar separadamente qualquer etapa indisponível.
- [x] Atualizar README com instalação única, quatro slots opcionais, preservação de perfil, atualizações manuais, limite de evidência fictícia e instruções de teste real em duas contas. Commit dos arquivos desta tarefa: `git commit -m "build: validate and package multi-account Kickterino"`.

## Aceitação e passagem para execução

- [x] Revisar o diff completo contra o spec: nenhum token em código de página/log/IPC; nenhuma função Kick perdida; todos os limites e fences preservados. Corrigir achados e repetir apenas verificações afetadas.
- [ ] Entregar candidato identificado pelo commit e hash, com resultados automatizados e limitações. Não publicar release por inferência do pedido de planejamento.
- [ ] Validar no Windows com duas contas reais: login oficial, canais e configurações distintos, pontos em ambas durante alternância, chat com identidade correta, logout isolado e persistência após reiniciar. Quatro contas reais permanecem não verificadas se só duas forem usadas.
- [ ] Registrar resultado real antes de propor publicação estável.

Recomendação de execução: inline, pois transporte, identidade e extração têm dependências fortes e há um modelo existente para adaptar. Delegação é alternativa se o usuário a escolher. Revisão do plano precede qualquer implementação.

Status de execução: 51 testes unitários/integrados passam; fixtures Electron e quatro contas fictícias com persistência passam no Linux/X11; auditorias sem findings; pacote Linux conferido. Instalador e fixture Windows aguardam executor Windows; validação com contas reais aguarda o usuário. Ver docs/VALIDATION.md.
