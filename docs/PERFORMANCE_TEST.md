# Ensaio experimental Kickterino

Este pacote 0.3.2 é experimental, sem assinatura e identificado pelo commit em build-info.json. Não há ainda medição real antes/depois do Kick. Os números da Twitch não são baseline do Kick.

Extraia o pacote e execute `./Start-WindowsValidation.ps1`. O launcher verifica os hashes de todos os arquivos e usa perfil isolado em LOCALAPPDATA/ChannelClientValidation/kickterino/<12 primeiros caracteres do commit>. Novos slots começam pausados; perfis existentes não são sobrescritos. Faça login nas janelas oficiais de cada conta desejada.

Para medir, execute `./Start-WindowsValidation.ps1 -Measure -Diagnostics`. O launcher obtém o PID do executável verificado. Por padrão o coletor espera600s e observa1800s. Para smoke de integração apenas, use `-WarmupSeconds 0 -DurationSeconds 5`. Não interprete esse smoke como resultado de desempenho.

Cenário principal: duas contas com duas lives cada, mesmos canais e qualidade, janela principal aberta. Confirme créditos reais nas quatro lives e anote os saldos antes/depois sem resgates durante a medição. O primeiro ganho durante o aquecimento deve aparecer imediatamente. Troque a conta na interface e renove a sessão da mesma identidade sem recriar players ou zerar o baseline.

No aceite funcional, confira a prioridade dos canais com sub online mesmo após a meta, respeitando pausa e limite de vagas. Notificações e o modo antes de dormir só devem indicar compra para o pacote disponível no catálogo do canal, com o preço real. Estimativas continuam identificadas no planejamento. O Kick ainda não tem confirmação de resgate verificada: registros são manuais ou inferidos conservadoramente de quedas no saldo; uma queda ambígua exige registro manual. O aplicativo não realiza compras pagas automaticamente.

Ao sair ou trocar de identidade no mesmo slot, confira que saldos e relatórios desaparecem imediatamente. Um relatório aberto ou uma resposta atrasada da sessão anterior não deve reaparecer.

Este candidato corrige masters HLS que podiam selecionar só áudio: escolhe a menor variante real de vídeo e mantém as associações de áudio. Registre a qualidade efetiva antes/depois. Não há160p inventado nem mudança nas flags de reprodução. Uma troca de áudio-only para vídeo não é comparável como economia de RAM.

Arquivos: summary.json, environment.json, totals.csv e processes.csv; com diagnóstico ativado, resources-log.jsonl contém apenas papel, slot, IDs de processo/janela e visibilidade, sem URLs, cookies ou chat. points-log.jsonl é um histórico local privado por conta: preserve-o localmente e compartilhe somente saldos/horários necessários.

Depois: uma conta/duas lives, bandeja, três repetições e >=8h. Compare mediana/p95/pico somente entre ensaios próprios do Kick no mesmo cenário. Encerre pela bandeja. Não há publicação estável ou compra automática paga neste pacote.
