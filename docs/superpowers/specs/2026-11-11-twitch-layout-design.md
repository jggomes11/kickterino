# Disposição do Twitchterino no Kickterino

Solicitação: usar a mesma disposição da interface final do Twitchterino. Referência concreta: renderer/index.html, theme.css e lista de canais de /workspace/twitchterino.

Aplicar diretamente a organização existente: cabeçalho compacto (marca, juntar pontos, bônus, resumo, login, engrenagem e painel); quatro seletores abaixo; gaveta de configurações; canais à esquerda com busca, fixados, ao vivo e offline recolhível; chat ao centro e painel de bônus à direita. Adaptar a aparência para a identidade verde Kick e manter todos os controles Kick, custos numéricos de bônus, limites e regras de coleta.

Abordagem: adaptar localmente a estrutura e estilos da referência. Evitar redesenho novo ou pacote compartilhado; não introduzir baús, OAuth ou funções exclusivas da Twitch. Nenhuma alteração no transporte, sessão ou isolamento das contas.

Em janelas estreitas, sobrepor o painel somente à área principal, preservando a linha de quatro contas. Configurações fecham por clique externo, Escape ou seleção de outra conta. Busca filtra canais; selecionar outra conta limpa a busca. Manter preferência local do painel e comportamento de adicionar canais.

Validação: npm test preservado; fixture Electron real verifica disposição, busca, abertura/fechamento da gaveta, presença dos controles e ausência de sobreposição nos seletores, além das quatro sessões e persistência já cobertas. Inspeção visual por captura. Gerar instalador Windows atualizado pelo workflow existente para continuar os testes do usuário.
