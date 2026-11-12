# Validação, operação e entrega — Kickterino

## Evidência desta varredura

- Comando: `npm test`, diretório do projeto, Node 24.22.1, Linux do ambiente de desenvolvimento.
- Resultado observado: **51 testes, 51 passaram, 0 falhas**.
- Reexecutar suite não é medição de desempenho, teste de login real ou validação nativa Windows nova.
- Alterações desta tarefa são documentação e links no README; não houve mudança em código, dependências, empacotamento ou binários.

## Matriz de testes rastreados

| Arquivo | O que exercita |
| --- | --- |
| [tests/account-fixture.test.cjs](../../tests/account-fixture.test.cjs) | Critérios da fixture de perfis e exigência de encerramento natural; falhas não viram sucesso por cleanup. |
| [tests/account-view.test.cjs](../../tests/account-view.test.cjs) | Respostas atrasadas, seleção A→B→A, ponte congelada, reload, notificações e captura de conta. |
| [tests/accounts.test.cjs](../../tests/accounts.test.cjs) | Arquivar/restaurar relatórios por identidade; adotar histórico legado. |
| [tests/application.test.cjs](../../tests/application.test.cjs) | Aplicação real carregada sob doubles Electron: transporte, identidade, logout e comandos; não é login real. |
| [tests/ipc.test.cjs](../../tests/ipc.test.cjs) | Autenticação de origem/frame e validação de argumentos/limites. |
| [tests/multi-account.test.cjs](../../tests/multi-account.test.cjs) | Quatro runtimes/sessões, configs independentes, origem de comandos/popups e continuidade em background. |
| [tests/platform.test.cjs](../../tests/platform.test.cjs) | Destinos/cabeçalhos e caminhos permitidos do transporte; há casos das duas plataformas no módulo compartilhado. |
| [tests/policy.test.cjs](../../tests/policy.test.cjs) | Metadados do fork, inclusão de módulos e política de pacote/updater conforme asserções do arquivo. |
| [tests/requests.test.cjs](../../tests/requests.test.cjs) | Timeout/abort, redirects, limites, cookies malformados e invalidação do cliente. |

Doubles de Electron no helper rodam código do app em VM, capturam chamadas, janelas e efeitos; não reproduzem todos os comportamentos de Chromium/Windows. Testes de platform/ipc podem conter caminhos de ambas as plataformas por reaproveitamento; isso não prova que os dois produtos tenham as mesmas funções.

### Fixtures e ferramentas adicionais

- [tests/electron-fixture.cjs](../../tests/electron-fixture.cjs) via `npm run test:electron`: Electron real, servidor local e credenciais fictícias para transporte e proteção. Flags Linux headless/no-sandbox são confinadas ao runner de teste.
- [scripts/validate-accounts.cjs](../../scripts/validate-accounts.cjs): executável Windows real em perfil temporário, quatro janelas de login/partições com cookies fictícios, preferências, segunda execução e quit/reopen natural. Sem contas autenticadas e sem prova de pontos reais.
- `npm run test:accounts` usa main/renderer reais, bootstrap de protocolo com identidades/canais fictícios e oito players. Testa busca/gaveta, janela de 820px e hit testing de modal. Esse cenário não carrega streams reais nem serve de benchmark. A captura gerada vai para .superpowers, não altera arquivos rastreados.

## Pipeline vigente

O workflow principal é disparado por PR, workflow_dispatch e pushes em main/codex/**. Usa windows-latest, Node24, `npm ci`, suite, fixtures Electron e quatro contas fictícias, audits, script de empacotamento nativo e validação de quatro partições no executável unpacked. O artefato kickterino-windows-candidate inclui instalador, metadados, checksum e evidências. Upload usa always: um artefato existente isoladamente não prova que o job passou; conferir conclusion e account-validation. Actions usam versões @v4, não SHA completo.

Fonte: [.github/workflows/windows-validation.yml](../../.github/workflows/windows-validation.yml).

Há também [.github/workflows/publish-verified-release.yml](../../.github/workflows/publish-verified-release.yml), criado para publicar **esta versão específica**: branch explícita, filtro por mudança do próprio YAML, SOURCE/VERSION/run ID/nome de artefato fixos, validação de metadados e SHA256SUMS e upload com token do próprio repositório. Não é um serviço automático de update nem uma rotina genérica para novas versões. Não editar esse workflow incidentalmente durante documentação/migração, pois ele tem efeito externo de publicação.

## Release publicada e identidade do instalador

| Campo | Valor conferido |
| --- | --- |
| Release | [v0.3.1](https://github.com/jggomes11/kickterino/releases/tag/v0.3.1) |
| Código usado no build | `90aaf8176ada0aef4f8cbe244e48fea764538643` |
| Build/validação Windows | [Actions 43133279874](https://github.com/jggomes11/kickterino/actions/runs/43133279874) — success |
| Publicação | [Actions 43146973196](https://github.com/jggomes11/kickterino/actions/runs/43146973196) — publicação concluída nesta conversa |
| Executável | `Kickterino-Setup.exe` |
| SHA-256 do instalador conferido | `63662a63a7f5e3f3c53d372a8eac4b25ac278ed812918b7af0f7b7c956f1e4c6` |
| Aplicação | `com.vinniisaantos.kickterino`; mesmo userData padrão da instalação existente |
| Distribuição | NSIS, instalação por usuário/oneClick, atalhos de desktop/menu, inicia após instalar |
| Assinatura/update | Sem assinatura digital; sem verificação/download/instalação automática |
| Ícones | PNG da identidade Kick usado pelo runtime e pelo builder Windows |

Os assets da release incluem instalador, `SHA256SUMS.txt`, `release-build-info.json` e `account-validation.json`. JSON/texto são evidências, não aplicativos portáteis. Arquivos de source code gerados pelo GitHub são separados do instalador. O pacote contém LICENSE, main/manager/runtime, preload, renderer, PNG e security/**; scripts de CI e perfis não entram no aplicativo.

O script package-windows-release.cjs exige Windows e árvore rastreada limpa, recusa release-output existente, compila NSIS sem publicar e produz metadados+checksum. Metadados não provam login ou pontos.

O campo sourceSha do relatório de partições pode ser "local" porque a fixture usa fallback quando VALIDATION_SOURCE_SHA não foi exportado. Na release 0.3.1, a identidade exata vem de release-build-info.json e headSha do run; não tratar o fallback como commit verificável.

## Execução local e manutenção

```sh
npm ci
npm test
npm run test:electron
npm run test:accounts
npm start
```

Compilação de diretório Linux para inspeção: `npm run dist:linux -- --dir --publish never`. No ambiente restrito foi necessário usar caches graváveis/uma distribuição Electron local da mesma versão; isso é adaptação do ambiente, não alteração de produto. Para Windows, executar pipeline nativo ou `npm run dist -- --publish never` no Windows. Não publicar apenas por um build compilar: conferir origem, assertions e hashes.

Sempre sair pela bandeja antes de atualizar. Não importar automaticamente pastas de navegador; uma engine nova pode não ler armazenamento/cookies criptografados do Electron. Canais, preferências, relatórios e perfil precisam de plano de migração explícito. Não enviar perfis ou tokens a repositórios/relatórios.

## Lacunas e alcance da evidência

- Nenhum teste sintético prova que a plataforma credita pontos em contas reais ou garante suporte futuro dos endpoints.
- A conversa/README registra aceitação histórica de login/coleta/baú e duas contas reais no Twitchterino. Não reinterpretar isso como quatro contas reais verificadas ou nova execução ao preparar esta documentação.
- No Kickterino há medições históricas do projeto original sobre duas lives; não houve nova medição real neste levantamento.
- Regras de ranking, custo de longas sessões, compra externa, DST/relógio alterado, falhas de escrita/crash e crescimento de arquivos lógicos não têm equivalência integral garantida pelos totais de testes.
- Migração de cookies entre engines, funcionamento de login social e reprodução oculta precisam de investigação específica. Não há perfil de RAM/CPU/GPU/rede por cenário nesta base.
- Datas/duração de bônus usam relógio local e timestamp do PC; comportamento em alteração de relógio/fuso não é contrato formal validado.

Essas lacunas são entradas para a fase seguinte, não autorização para mudar regras de negócio silenciosamente.
