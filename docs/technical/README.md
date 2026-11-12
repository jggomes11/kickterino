# Base técnica — Kickterino

Levantamento do código existente, sem proposta de substituição tecnológica e sem alteração do produto.
Versão `0.3.1`; checkout de origem `aa05dc37d8bad0d370210833ca2a86f12c5f6f45`; binário publicado a partir de `90aaf8176ada0aef4f8cbe244e48fea764538643`.
Captura: 2026-11-11T23:37:06-04:00 (America/Manaus).

**Leitura das evidências:** “implementado” significa encontrado no código; “teste” significa exercitado pelo cenário descrito; “observação histórica” vem de registro anterior; “a medir” não é uma conclusão de desempenho. Comentários e estimativas da plataforma não são garantias atuais de crédito de pontos.

## Documentos

| Documento | Para que serve |
| --- | --- |
| [Estado atual](ESTADO_ATUAL.md) | Arquitetura, fluxo de execução, integrações, armazenamento, IPC e dependências |
| [Regras de negócio](REGRAS_NEGOCIO.md) | Comportamentos que a reimplementação deve considerar, parâmetros e casos de aceitação |
| [Desempenho e baseline](DESEMPENHO.md) | Recursos mantidos hoje, hipóteses verificáveis e protocolo de medição ainda não executado |
| [Validação e entrega](VALIDACAO_E_ENTREGA.md) | Testes, evidências Windows, identidade da release e lacunas |
| [Inventário](INVENTARIO.md) | Todos os arquivos rastreados na origem do levantamento e suas responsabilidades |
| [Comparativo](COMPARATIVO.md) | Semelhanças, diferenças e limites de compartilhamento com o outro aplicativo |

## Como usar esta base

1. Ler o estado atual e as regras antes de discutir outra tecnologia.
2. Usar os IDs de regras como rastreabilidade dos futuros testes de equivalência.
3. Medir a versão publicada com o protocolo de desempenho; preencher os resultados, ainda ausentes.
4. Somente então comparar alternativas com o mesmo cenário de contas, canais e crédito real de pontos.

A documentação descreve a implementação, incluindo limitações. Não converte detalhes técnicos ou possíveis defeitos em requisitos que devam ser perpetuados. Os pontos de divergência precisam de decisão explícita na próxima fase.

## Identidade da base

- Repositório: [jggomes11/kickterino](https://github.com/jggomes11/kickterino).
- [Release v0.3.1](https://github.com/jggomes11/kickterino/releases/tag/v0.3.1) e [código do binário](https://github.com/jggomes11/kickterino/tree/90aaf8176ada0aef4f8cbe244e48fea764538643).
- `main` consultada no levantamento: `79e3596a19818986ab9dbf1f8060adce6cbeed98`. **Ela não contém toda a versão publicada.** Não iniciar uma migração apenas copiando `main` sem conferir tag/commit.
- O checkout auditado acrescenta o workflow/notas de publicação ao código da release. Os commits da documentação são posteriores e não representam outro binário.
- Escopo: arquivos rastreados de aplicação, segurança, interface, build, workflows, testes e documentação existente. Excluídos `node_modules`, binários extraídos, `.git`, perfis do usuário, cookies e segredos. Não foi feita inspeção de credenciais reais.
