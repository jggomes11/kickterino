# Validação Windows — Kick experimental

O pacote não é uma versão estável. Leia build-info.json para versão, commit e signed:false. Execute `./Start-WindowsValidation.ps1 -CheckOnly` para verificar integridade sem abrir a interface. O launcher usa LOCALAPPDATA/ChannelClientValidation/kickterino/<source12>; os quatro novos slots começam pausados. Para reutilizar um perfil isolado existente, use `-ProfileCommit <12 caracteres hexadecimais>`. O perfil precisa existir nesse diretório; a instalação normal permanece independente.

1. Abra pelo launcher e confira quatro contas. Entre somente pela janela oficial Kick. Feche a janela depois e confirme que a sessão fica salva após sair pela bandeja e reabrir.
2. Com duas contas × duas lives, ligue Juntar pontos e confirme que o saldo realmente sobe em cada canal. Aquecimento não deve atrasar o registro do primeiro crédito. Trocas A→B→A e renovação da mesma identidade conservam players/horário; trocar identidade ou sair encerra recursos antigos e limpa referências privadas.
3. Confirme que canais online com assinatura têm prioridade mesmo com a meta já atingida ou rotação desligada. Nunca ultrapasse o limite de vagas automáticas. Um canal offline libera vaga; pausar continua funcionando.
4. Confira os12 pacotes XP/Capture/Lure1/3/5/10h, preço do catálogo e disponibilidade habilitado/não pausado. Estimativas são identificadas. A loja oficial continua manual; não compre recompensas para este ensaio. Queda ambígua do saldo não comprova compra; registro manual e inferido mantêm origem e duração.
5. Confira layout, painel, chat e configurações na sua escala de tela; abra/feche loja sem resgate. Teste logout e saída natural. Não envie cookies, tokens, perfil ou nomes de conta.

Use `-Measure -Diagnostics` para coleta com aquecimento600s/duração1800s, ou um smoke curto explícito. O coletor é o mesmo validado para Twitch; resultados de Twitch não descrevem Kick. Evidência de CI usa perfis vazios/cookies falsos, sem login real, pontos reais ou economia de recursos comprovada.
