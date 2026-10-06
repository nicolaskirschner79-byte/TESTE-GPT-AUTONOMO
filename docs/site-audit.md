# Avaliação do sistema da barbearia

**Atualização posterior:** financeiro, navegação e rodapé foram corrigidos, e a agenda foi simplificada em calendário. Veja [corrections.md](corrections.md) para o estado atual, os testes e as duas pendências externas. O relatório abaixo registra o estado encontrado antes dessas correções.

Revisão de 5 de outubro de 2026. Site: https://teste-gpt-autonomo.vercel.app/. Marca observada em produção: **GORDIN 244 DU CORTE**.

## Alteração realizada

A agenda passa a mostrar o status na cor do horário, na faixa lateral e no fundo da reserva. A mesma identificação aparece na visão semanal, no cartão do cliente e nos marcadores compartilhados com o histórico e o painel.

| Status | Cor |
|---|---|
| A confirmar | Amarelo |
| Confirmado | Verde |
| Em atendimento | Azul |
| Concluído | Roxo |
| Cancelado | Vermelho |
| Não compareceu | Cinza |

Uma legenda mantém os nomes visíveis; a identificação não depende exclusivamente da cor. Os textos usam tons escuros sobre fundos suaves. O contraste calculado entre texto e fundo dos seis status ficou entre 5,68:1 e 6,37:1. As cores dos status são independentes das cores escolhidas para a marca da barbearia.

## Cobertura e resultados

Foram executados **21 testes da aplicação**, **37 grupos de verificações no banco**, build de produção, verificações HTTP e inspeção do fluxo público no navegador. Os testes do banco usam registros temporários e rollback; as reservas, os pagamentos e as configurações reais foram preservados. Não foi feita uma reserva real pelo navegador nem enviado WhatsApp ou e-mail durante esta avaliação.

| Área | Verificação executada | Resultado e limite |
|---|---|---|
| Página pública | Marca carregada do Supabase; seleção de Corte + Sobrancelha; data, horário, contato e prévia | Prévia correta: R$40, 50 minutos, Nicolas, 06/10 às 09:00–09:50. A confirmação final não foi acionada. |
| Disponibilidade | Expediente, almoço, bloqueios, datas fechadas, duração dos serviços, profissional desativado e ocupação | Regras aprovadas no banco. Horários disponíveis também foram observados na página pública. |
| Reservas e histórico | Criação, repetição idempotente, histórico restrito ao dispositivo e reagendamento | Aprovados por RPC com fixtures temporários. Navegação pública apresentou o problema descrito abaixo. |
| Agenda administrativa | Dia/semana, início, versão desatualizada, limite de um atendimento em curso por profissional e conclusão | 10 grupos em `tests/agenda.sql` aprovados; não foi possível verificar visualmente a agenda em uma sessão autenticada do proprietário. |
| Financeiro | Pagamento parcial, saldo, repetição idempotente, despesas, cancelamento com pagamento e estorno | Operações aprovadas no banco. Há um problema na consulta que alimenta os indicadores de hoje, descrito abaixo. |
| Cadastros | Serviço, profissional, vínculo entre ambos, expediente, bloqueio/remoção e fechamento/remoção de data especial | Aprovados em `tests/system-audit.sql`, sem alterar os cadastros reais. |
| Nome, logo, cores e fonte | Persistência, alterações parciais, catálogo público e acesso do proprietário | 11 grupos em `tests/branding.sql` aprovados. Políticas de Storage verificadas; upload real pelo formulário autenticado não foi realizado. |
| Imagem da landing page | Quatro formatos, três artes, textos, enquadramento e preservação da marca | 8 grupos em `tests/hero.sql` aprovados. Limites e políticas de Storage verificados; upload real pelo formulário não foi realizado. |
| Segurança | API administrativa sem sessão, permissões privadas, operações financeiras e fila | `admin_data` e `whoami` retornaram HTTP 401; catálogo público retornou HTTP 200. Visitantes não executam operações administrativas nas verificações do banco. |
| Entrada do painel | Página de login, recuperação disponível e ausência de cadastro público do proprietário | Página protegida observada. Login efetivo, recuperação pela caixa postal e expiração de sessão não foram testados nesta revisão. |
| WhatsApp | Consentimento, inclusão na fila, bloqueio de lembrete repetido, cron e respostas recentes do worker | Regras do banco aprovadas. Envio externo está impedido por configuração incompleta. |

Os 37 grupos do banco correspondem a `agenda.sql` (10), `branding.sql` (11), `hero.sql` (8) e `system-audit.sql` (8). Os 21 testes de `npm test` abrangem telefone, datas, cálculos, apresentação, identidade visual e opções do destaque.

## Problemas encontrados

### 1. WhatsApp não está configurado — prioridade alta

**Constatação em produção.** Na consulta realizada havia **10 mensagens pendentes**. O cron está ativo e chama o worker a cada minuto. As respostas recentes das 22:40, 22:41 e 22:42 UTC foram HTTP 200 com `{"configured":false,"processed":0}`.

Isso significa que o agendador da fila funciona, mas o processador não tem a configuração necessária para enviar as mensagens. HTTP 200 não comprova envio. Os agendamentos continuam salvos, porém avisos ao barbeiro e lembretes não chegam ao WhatsApp por esse caminho.

**Próxima ação:** concluir a configuração do remetente oficial, token, templates aprovados e webhook, seguindo [whatsapp.md](whatsapp.md). Depois, testar uma mensagem para destinatário autorizado e confirmar a entrega real. Avaliar a idade das mensagens pendentes antes de liberar a fila, para não enviar lembretes antigos. Não enviar credenciais pelo chat.

### 2. Filtro de período pode zerar indicadores de hoje — prioridade alta

**Confirmado no código e reproduzido com dados sintéticos locais; não reproduzido dentro da interface autenticada.** Em `src/admin.js`, `adminDataRequest()` amplia o início da consulta para incluir os últimos sete dias, mas mantém o final em `state.to`. Se o proprietário escolher um período que termina antes de hoje, a consulta deixa de trazer os pagamentos e despesas de hoje.

`overview()` tenta calcular “Receita recebida hoje”, “Lucro de hoje” e o gráfico dos últimos sete dias usando esses dados incompletos. Na reprodução local, um recebimento de R$35 hoje virou R$0 depois de aplicar o limite de um período encerrado em setembro. Períodos antigos também podem deixar incompleto o gráfico.

**Correção sugerida:** consultar os dados diários e dos últimos sete dias separadamente do intervalo escolhido no financeiro; preservar a validação do limite de período da API. Atualizar a referência de “hoje” quando a tela atravessar a meia-noite.

### 3. “Novo agendamento” mantém o endereço do histórico — prioridade média

**Reproduzido no navegador em produção.** A partir de `/meus-agendamentos`, clicar em “Novo agendamento” mostra o formulário, mas o endereço continua `/meus-agendamentos`. Ao atualizar a página, o histórico aparece novamente. O fluxo preserva a etapa em memória ao alternar telas, mas ela é perdida no recarregamento.

O manipulador de `#new-booking` em `src/client.js` troca a tela sem atualizar a URL. Após a confirmação de reserva há outra troca de tela que também precisa manter endereço e conteúdo consistentes.

**Correção sugerida:** centralizar a navegação das duas telas, atualizando a URL em todas as transições, e verificar recarregamento e botões de navegação do navegador.

### 4. Horário do rodapé está fixo — prioridade média

**Limitação confirmada no código; divergência com o expediente atual não foi demonstrada.** A página pública sempre informa “Seg–sáb, 9h às 19h / Almoço 12h–13h”, embora o painel permita alterar o expediente por profissional. A disponibilidade respeita os dados do banco; o texto do rodapé não acompanha essa alteração.

**Correção sugerida:** mostrar horários vindos das configurações, ou direcionar para o expediente dos profissionais quando eles tiverem agendas diferentes.

### 5. Proteção contra senhas vazadas desativada — prioridade média

**Aviso do consultor de segurança do Supabase.** Foi identificado `auth_leaked_password_protection` desativado. Não foi identificado outro aviso de segurança nessa consulta; isso não equivale a uma auditoria completa de segurança.

**Próxima ação:** conferir a disponibilidade da proteção no plano contratado e ativá-la quando disponível. A documentação do Supabase informa que ela depende do plano Pro ou superior. Também é recomendável integrar autenticação de dois fatores ao painel. Nenhuma configuração de autenticação ou plano foi alterada nesta revisão.

Referência: https://supabase.com/docs/guides/auth/password-security.

## Melhorias para a operação da barbearia

| Prioridade | Melhoria | Benefício |
|---|---|---|
| 1 | Indicador visível de WhatsApp configurado e alerta quando houver mensagens pendentes | Evita que o barbeiro considere enviado algo que ainda está na fila. |
| 2 | Lembretes automáticos antes do horário, com consentimento e prevenção de duplicidade | Reduz faltas. Hoje o cron processa a fila; o lembrete é solicitado manualmente no painel. |
| 3 | Separar situação do atendimento e situação do pagamento: pendente, parcial e pago | Um pagamento parcial atualmente conclui o atendimento, mantendo o saldo disponível para recebimento. Separar as duas situações deixa a operação mais clara. |
| 4 | Fechamento diário e exportação CSV de pagamentos, estornos e despesas | Facilita conferir dinheiro/Pix/cartões e acompanhar o resultado do dia. |
| 5 | Lista de espera e encaixes que usem a duração do serviço escolhido | Permite preencher cancelamentos sem criar conflito de horários. |
| 6 | Histórico do cliente no painel, com última visita e serviços mais frequentes | Ajuda no atendimento e no retorno do cliente; o acesso do cliente em outro aparelho pode futuramente usar verificação por código. |
| 7 | Limite de tempo nas requisições e recuperação clara em falhas de rede | Evita botões em estado de carregamento por tempo indefinido. |
| 8 | Instalação como aplicativo no celular e atalhos para a agenda de hoje | Facilita abrir o painel durante o trabalho. Reservas devem continuar sendo confirmadas pelo servidor. |

## Verificações que ainda precisam de uso real

- Navegação completa do proprietário autenticado, incluindo modais, teclado, telas pequenas e uploads efetivos de logo/imagem.
- Login, recebimento e conclusão do e-mail de recuperação. Conferir Site URL e Redirect URLs de Auth conforme https://supabase.com/docs/guides/auth/redirect-urls.
- Envio e entrega de WhatsApp, assinatura do webhook com eventos reais e aprovação dos templates pela Meta.
- Disputa simultânea entre dois clientes pela API externa. As restrições e transições transacionais foram verificadas no banco; o teste externo que cria reservas reais não foi repetido nesta avaliação.
- Acessibilidade completa com leitor de tela e medição de desempenho em celulares reais.

Os logs agregados das Edge Functions consultados nas últimas 24 horas não mostraram respostas 5xx nesse recorte. Houve respostas de autenticação/conflito e chamadas anteriores do worker com 404; as respostas recentes do worker foram 200, com configuração incompleta. Esse recorte não comprova ausência de todos os erros do sistema.

A avaliação cobre os fluxos existentes por código, banco e navegação pública. As áreas que exigem sessão do proprietário, caixa postal ou entrega externa permanecem explicitamente sem verificação completa de ponta a ponta.
