# Auditoria Electron — Kickterino

Data: 13/11/2026. Código revisado: 984fdf874be95e2dd770fe6b7ed05ef5eef61b7f, produção v0.3.1 mais documentação. Auditoria independente e somente leitura. `npm test`: 51 passaram, zero falhas. Não há benchmark real do Kick nesta revisão.

## Desempenho e ciclo de vida

| Prioridade | Evidência | Proposta / validação |
|---|---|---|
| Alta: quatro logins permanentes | `account-runtime.js:1048` chama createApiWindow para todos os slots; `:141–154` cria página robots.txt e fecha apenas escondendo. APIs já são nativas (`:200`, `security/requests.js:44`). | Login sob demanda, sem renderer ocioso; preservar Session, retomada de sessão e popups oficiais. Economia é hipótese. |
| Alta: métricas e snapshots duplicados | `account-runtime.js:831`, `account-manager.js:10`, `main.js:70–81`, timer `account-runtime.js:1050` | Até vinte leituras globais por rodada de status dos quatro slots, fora bandeja/poll. Medir uma vez no shell, resumos leves e broadcasts agrupados; `account-runtime.js:611` também gera snapshot completo só para obter memoryMB. |
| Alta: poll sem orçamento agregado | `account-runtime.js:503–536`, `:837–865` | Três requests por canal, sequenciais, timeout20 s cada; 17 canais indisponíveis poderiam levar cerca de 17 minutos só nesses requests. POLL_STUCK_MS/pollStartedAt existem, mas guard usa apenas polling. Testar cancelamento por época, limite agregado e concorrência pequena, erros parciais e recuperação. Não aumentar carga sem limite. |
| Média: players recriados na renovação | `account-runtime.js:94`, `:206`, `:848–852` | Mudança de session_token ou XSRF invalida/destrói; fingerprint no poll pode invalidar novamente. Coalescer eventos mantendo credenciais antigas suspensas e confirmar mesma identidade antes de preservar recursos. Frequência/custo real ainda não medidos. |
| Média: playlist pode escolher só áudio | `account-runtime.js:112` | Ordena todas as variantes por bandwidth e perde metadados intercalados. Fixtures com vídeo/áudio separados; preservar associações, filtrar vídeo, verificar resolução/reprodução e crédito real. Tratar em rodada própria. |
| Média: manifesto público repetido | `account-runtime.js:490`, `:1052–1053` | Compartilhar busca pública por app, mantendo aplicação por slot. |
| Posterior: UI e disco | `renderer/renderer.js:367–403`, `account-runtime.js:53`, `:451`, `:597` | Medir render/pausas; preservar relatórios, formato e retenção. |

Timers Kick já são rastreados/cancelados (`account-runtime.js:62`, `:1058`) e withTimeout limpa o timer (`:129`): manter essas propriedades.

## Bônus automáticos: requisito de paridade com Twitch

| Regra | Kick atual | Referência Twitch |
|---|---|---|
| Identificação | 300/500/1000 pontos | xp / capture / lure |
| Duração | 1 h | 1/3/5/10 h |
| Custo | Global fixo | Por recompensa/canal |
| Disponibilidade | Não consultada | Habilitada, não pausada e em estoque |
| Automático / meta | Patamares fixos | Próxima meta e pacote com custos do canal |
| Compra / histórico | Queda do saldo e combinações fixas | Resgate identificado e inferência conservadora |
| UI | Opções fixas | bonusOptions, preços/pacotes e canal com bônus |

Evidências Kick: account-runtime.js:354/369 (constantes e avisos), :395/405/413 (inferência/duração), :503 (consulta sem catálogo), :629/644 (ranking), :794 (snapshot), :967 (alvo); security/ipc.js:60; renderer/index.html:19; renderer/renderer.js:382/418/470/637.

Referência Twitch: account-runtime.js:258/272/300/306/312/330/369/403/1075/1094.

Na Twitch, automático significa meta, foco/rotação, avisos e observação de resgates. O aplicativo não compra automaticamente recompensas PokeIdle. O baú gratuito automático da Twitch é uma função específica e não deve ser confundido com os bônus/pacotes do Kick.

### Contrato de paridade proposto

- Alvo: vazio para automático, ou xp:1/xp:3/xp:5/xp:10 e equivalentes capture/lure.
- Recompensa: id, kind, hours, cost, available, title; catálogo por conta/canal com estado known/unknown/error e instante da observação.
- Compra: t, kind, hours, cost, slug, source, redemptionId opcional; origem manual, confirmed ou legacy-inferred.
- Mesma política de custos, metas, preferência por canal com bônus, margem de troca de 50 pontos, cooldown de 30 minutos e avisos sem celebrar saldo inicial.
- Transporte, confirmação e cookies continuam específicos da plataforma e isolados por conta. Dados do catálogo que dependam do usuário não entram em cache público compartilhado.

### Fonte real de preços: dependência de integração

O cliente atual permite somente user, channels/{slug}[/me|/points] e envio de chat. refreshChannel não extrai catálogo. O Swagger oficial documenta GET /public/v1/channels/rewards com OAuth e channel:rewards:read/write, sem seleção de broadcaster/slug. Isso não comprova leitura do catálogo de canais arbitrários com a sessão espectadora atual.

Validar o payload de leitura apresentado pela loja oficial à conta autorizada antes de implementar o adaptador de catálogo. Não inventar endpoint, aceitar credenciais de broadcaster como substituto de cookies de espectador, nem tratar uma estimativa como preço/disponibilidade confirmados.

Fontes verificadas na revisão:
- https://api.kick.com/swagger/doc.json
- https://github.com/KickEngineering/KickDevDocs/blob/main/scopes/scopes.md
- https://help.kick.com/en/articles/10709188-guide-to-channel-points

### Migração

0 → automático vazio; 300 → xp:1; 500 → capture:1; 1000 → lure:1. Migração idempotente e com versão de schema; preservar timestamp, custo antigo, canal e identidade. Registros antigos de compra recebem tipo/duração compatíveis e origem legacy-inferred; não recalcular valores pelo catálogo novo nem promover inferência a confirmação. Migrar também históricos salvos por identidade em cada slot. UI, IPC, cronômetros, avisos, relatório e modo dormir devem consumir o novo contrato em conjunto.

## Ordem e aceite

Separar a rodada de desempenho da paridade funcional de bônus, permitindo atribuir variações de consumo. Portar ao Kick somente otimizações comuns validadas na Twitch, testar as particularidades de cookies e polling, e medir o próprio Kick antes/depois. A coleta Twitch não é baseline do Kick.

A política de bônus pode ser testada com fixtures canônicas em ambos os apps; a integração real exige confirmar catálogo, preço, disponibilidade e resgate da conta correta. A falha de login relatada no protótipo Tauri não foi atribuída ao Electron e continua fora desta etapa.

Nenhuma modificação de produto foi feita e nenhuma economia ou equivalência real de bônus foi declarada nesta auditoria.
