# Inventário rastreado — Kickterino

Fonte: `git ls-files` e conteúdo em `aa05dc37d8bad0d370210833ca2a86f12c5f6f45`. **53 arquivos** classificados; dependências instaladas e saídas ignoradas não fazem parte desta contagem. Valores de linhas são do arquivo de origem; esta documentação foi adicionada depois. Hashes/bytes de todos os itens em [snapshot.json](snapshot.json). Não é uma auditoria de cada dependência transitiva nem de sites externos.

| Arquivo | Linhas | Responsabilidade |
| --- | --- | --- |
| [.github/workflows/publish-verified-release.yml](../../.github/workflows/publish-verified-release.yml) | 37 | Workflow CI/release; descrito em VALIDAÇÃO E ENTREGA |
| [.github/workflows/windows-validation.yml](../../.github/workflows/windows-validation.yml) | 32 | Workflow CI/release; descrito em VALIDAÇÃO E ENTREGA |
| [.gitignore](../../.gitignore) | 7 | Exclusões de dependências, saídas de build e scratch |
| [LICENSE](../../LICENSE) | 21 | Licença MIT/autoria preservada |
| [README.md](../../README.md) | 93 | Guia do produto, instalação e limitações |
| [account-manager.js](../../account-manager.js) | 31 | Seleção/agregação/despacho dos quatro slots |
| [account-runtime.js](../../account-runtime.js) | 1069 | Comportamentos por conta, mídia, integração e regras |
| [build/icon.png](../../build/icon.png) | binário | Recurso de empacotamento/ícone e sua procedência; não lógica de coleta |
| [docs/VALIDATION.md](../../docs/VALIDATION.md) | 33 | Registro histórico de validação, pode conter estados de etapas anteriores |
| [docs/account-fixture.png](../../docs/account-fixture.png) | binário | Imagem/documentação pública; não dados de usuário |
| [docs/app.png](../../docs/app.png) | binário | Imagem/documentação pública; não dados de usuário |
| [docs/icon.png](../../docs/icon.png) | binário | Imagem/documentação pública; não dados de usuário |
| [docs/index.html](../../docs/index.html) | 89 | Site estático de divulgação/download, separado da UI do app |
| [docs/parceiros.json](../../docs/parceiros.json) | 6 | Lista pública de parceiros do fork (runtime consulta upstream explicitamente) |
| [docs/releases/v0.3.1.pt-BR.md](../../docs/releases/v0.3.1.pt-BR.md) | 7 | Notas de versão históricas/publicadas |
| [docs/style.css](../../docs/style.css) | 70 | CSS do site estático |
| [docs/superpowers/plans/2026-11-11-security-multi-account.md](../../docs/superpowers/plans/2026-11-11-security-multi-account.md) | 105 | Plano/design histórico; confrontar intenção com código vigente |
| [docs/superpowers/specs/2026-11-11-security-multi-account-design.md](../../docs/superpowers/specs/2026-11-11-security-multi-account-design.md) | 45 | Plano/design histórico; confrontar intenção com código vigente |
| [docs/superpowers/specs/2026-11-11-twitch-layout-design.md](../../docs/superpowers/specs/2026-11-11-twitch-layout-design.md) | 11 | Plano/design histórico; confrontar intenção com código vigente |
| [iniciar.bat](../../iniciar.bat) | 4 | Launcher de desenvolvimento Windows; instala dependências se ausentes |
| [main.js](../../main.js) | 148 | Shell Electron e ciclo global |
| [package-lock.json](../../package-lock.json) | 3566 | Resolução reprodutível de dependências de build |
| [package.json](../../package.json) | 95 | Manifesto, scripts, versões e empacotamento |
| [preload.js](../../preload.js) | 63 | Ponte IPC local e filtragem por conta |
| [renderer/features.css](../../renderer/features.css) | 71 | Estilos de bônus, relatórios e contas |
| [renderer/index.html](../../renderer/index.html) | 107 | Estrutura da UI e CSP |
| [renderer/renderer.js](../../renderer/renderer.js) | 736 | DOM/chat/controles/modais/notificações |
| [renderer/style.css](../../renderer/style.css) | 115 | Estilos base |
| [renderer/theme.css](../../renderer/theme.css) | 274 | Tema e disposição/responsividade |
| [scripts/account-fixture.cjs](../../scripts/account-fixture.cjs) | 20 | Asserções de defaults/partições e encerramento natural |
| [scripts/cdp-client.cjs](../../scripts/cdp-client.cjs) | 47 | Cliente CDP de teste e tratamento de desconexão |
| [scripts/package-windows-release.cjs](../../scripts/package-windows-release.cjs) | 18 | Preparação do instalador e metadados de origem |
| [scripts/profile-process.cjs](../../scripts/profile-process.cjs) | 13 | Identificação/encerramento de processos de teste |
| [scripts/test-accounts.cjs](../../scripts/test-accounts.cjs) | 99 | Fixture real source+UI com dados fictícios e perfis |
| [scripts/test-electron.cjs](../../scripts/test-electron.cjs) | 16 | Runner Electron isolado com perfil temporário |
| [scripts/validate-accounts.cjs](../../scripts/validate-accounts.cjs) | 142 | Validação nativa Windows do app empacotado |
| [security/account-view.js](../../security/account-view.js) | 30 | Época da seleção e rejeição de respostas antigas |
| [security/accounts.js](../../security/accounts.js) | 25 | Adoção/arquivo de relatórios por identidade |
| [security/ipc.js](../../security/ipc.js) | 136 | Validação de origem/argumentos de comandos |
| [security/platform.js](../../security/platform.js) | 57 | Allowlist de endpoints e construção de headers |
| [security/requests.js](../../security/requests.js) | 97 | Transporte, abort, limite de corpo e cookies |
| [tests/account-fixture.test.cjs](../../tests/account-fixture.test.cjs) | 22 | Critérios da fixture de perfis e exigência de encerramento natural; falhas não viram sucesso por cleanup. |
| [tests/account-view.test.cjs](../../tests/account-view.test.cjs) | 90 | Respostas atrasadas, seleção A→B→A, ponte congelada, reload, notificações e captura de conta. |
| [tests/accounts.test.cjs](../../tests/accounts.test.cjs) | 26 | Arquivar/restaurar relatórios por identidade; adotar histórico legado. |
| [tests/app-bootstrap.cjs](../../tests/app-bootstrap.cjs) | 21 | Fixture/helper: ver contratos e efeitos simulados no arquivo |
| [tests/application.test.cjs](../../tests/application.test.cjs) | 67 | Aplicação real carregada sob doubles Electron: transporte, identidade, logout e comandos; não é login real. |
| [tests/electron-fixture.cjs](../../tests/electron-fixture.cjs) | 61 | Fixture/helper: ver contratos e efeitos simulados no arquivo |
| [tests/helpers/app.cjs](../../tests/helpers/app.cjs) | 138 | Fixture/helper: ver contratos e efeitos simulados no arquivo |
| [tests/ipc.test.cjs](../../tests/ipc.test.cjs) | 116 | Autenticação de origem/frame e validação de argumentos/limites. |
| [tests/multi-account.test.cjs](../../tests/multi-account.test.cjs) | 120 | Quatro runtimes/sessões, configs independentes, origem de comandos/popups e continuidade em background. |
| [tests/platform.test.cjs](../../tests/platform.test.cjs) | 64 | Destinos/cabeçalhos e caminhos permitidos do transporte; há casos das duas plataformas no módulo compartilhado. |
| [tests/policy.test.cjs](../../tests/policy.test.cjs) | 15 | Metadados do fork, inclusão de módulos e política de pacote/updater conforme asserções do arquivo. |
| [tests/requests.test.cjs](../../tests/requests.test.cjs) | 112 | Timeout/abort, redirects, limites, cookies malformados e invalidação do cliente. |

## Documentação acrescentada por este levantamento

`README.md`, `ESTADO_ATUAL.md`, `REGRAS_NEGOCIO.md`, `DESEMPENHO.md`, `VALIDACAO_E_ENTREGA.md`, `INVENTARIO.md`, `COMPARATIVO.md`, `defaults.example.json`, `snapshot.json` nesta pasta. O README da raiz recebe um link de entrada. Não são contados recursivamente como arquivos da base anterior.

`defaults.example.json` é extraído da constante DEFAULT_CONFIG em código. É um exemplo público da versão atual, **não** um schema JSON validado pelo aplicativo nem uma exportação de perfil. Campos criados por migração/uso estão descritos no estado atual.
