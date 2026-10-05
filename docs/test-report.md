# Relatório de verificação

Data: 05/10/2026. Ambiente: projeto real Supabase `GPT-AUTONOMO`, frontend publicado na Vercel e build Vite de produção.

## Testes unitários — 4 aprovados

1. Celular brasileiro, com e sem código do país, e rejeição de número incompleto.
2. Fuso de São Paulo, incluindo mudança de dia antes da meia-noite UTC.
3. Receita prevista separada de pagamentos; cancelamento preserva receita recebida; estorno e despesas afetam o lucro.
4. Escape de conteúdo de cliente antes da renderização HTML.

## Banco de dados — 12 verificações aprovadas

1. Idempotência da mesma reserva.
2. Intervalos sobrepostos no mesmo barbeiro são rejeitados.
3. Histórico e cancelamento isolados por identidade de dispositivo.
4. Almoço, fechamento e domingo respeitados.
5. Falha de reagendamento preserva a reserva original.
6. Cancelamento libera horário; alteração de cadastro preserva valores históricos.
7. Barbeiros diferentes podem atender simultaneamente.
8. Visitantes não têm privilégio nas tabelas privadas nem nas RPCs de servidor.
9. Acesso administrativo bloqueado sem autorização.
10. Reagendamento atualiza a agenda do dia anterior e mantém os serviços históricos na notificação.
11. Repetição de pagamento não duplica recebimento; cancelamento administrativo após pagamento preserva receita até estorno.
12. Fila de notificações persiste sem credenciais do WhatsApp.

Todos os fixtures desse teste foram revertidos na própria transação. O teste identificou uma ambiguidade SQL no filtro financeiro administrativo, corrigida na migration `validation_fixes`, e passou após a correção. A migration `operational_consistency` também foi aplicada e o teste foi executado novamente, sem alterar artificialmente o status do atendimento pago.

## API real e Realtime — 11 verificações aprovadas

1. Catálogo carregado pela Edge Function real.
2. Duas requisições simultâneas pelo mesmo horário: uma resposta 200 e uma 409.
3. Repetição do UUID da reserva retorna o mesmo agendamento.
4. Um dispositivo não lê nem cancela reservas de outro.
5. Reagendamento em conflito preserva o intervalo anterior.
6. Reagendamento disponível altera a reserva atomicamente.
7. Cancelamento libera disponibilidade pela API.
8. Requisição administrativa sem sessão recebe 401.
9. A chave pública não invoca a RPC privilegiada diretamente.
10. Worker sem chave recebe 401; webhook não autenticado recebe 401/503 conforme a configuração.
11. Realtime recebeu mudanças do sinal público, sem dados pessoais.

As duas reservas e as três identidades criadas para esses testes foram removidas após a execução. Não houve envio de WhatsApp.

## Segurança

O Supabase Security Advisor retornou `lints: []` após configurar políticas explícitas nas tabelas privadas. O catálogo tem RLS e somente SELECT público; nenhuma tabela com nomes, telefones, pagamentos ou reservas é publicada no Realtime. Chaves de servidor, senha e token de WhatsApp não estão no frontend ou no repositório.

## Build

`npm run build` passou, gerando as duas entradas `index.html` e `admin.html`.

## Limites

- Senha inicial do proprietário não foi fornecida; o fluxo seguro de primeiro acesso/recuperação foi implementado.
- E-mails de confirmação e recuperação não foram verificados na caixa postal real.
- Não foram recebidas credenciais/templates do WhatsApp e não foi feito envio real nem validada entrega pelo provedor.
- Dados de teste foram removidos ou revertidos. O calendário da barbearia inicia sem reservas.
- Os horários iniciais dos serviços são provisórios.

## Interface publicada — verificação realizada

No navegador desktop, no endereço de produção:

1. Seleção conjunta de Corte e Sobrancelha: R$40, 50 minutos.
2. Consulta dos horários reais, com almoço ausente da disponibilidade.
3. Confirmação e comprovante; dados conferidos no banco real.
4. Histórico preservado após recarregar `/meus-agendamentos`.
5. Reagendamento de 06/10 às 09:00 para 07/10 às 10:00, mantendo serviços, duração e valor.
6. Cancelamento com confirmação e status cancelado no histórico.
7. Painel sem sessão mostra login; Primeiro acesso mostra cadastro com senha escolhida pelo proprietário, sem acesso aos dados administrativos.

A identidade local de QA foi limpa pela opção da aplicação. A reserva de QA, consentimento, notificações e registros de auditoria correspondentes foram removidos após os testes. A consulta final confirmou zero reservas e zero notificações. Não houve envio de WhatsApp.

Avaliação visual em viewport desktop de 1348 px. As regras responsivas estão implementadas; não foi feito teste em aparelho móvel real. Login administrativo completo e entrega de e-mail dependem da configuração e dos dados seguros do proprietário.

![Página publicada](site-preview-1791217888986.jpg)

## Publicação

O commit de implementação na `main` acionou a Vercel automaticamente. Deployment `dpl_5HoNcRi1mcXqm5FxukN3koiR4ht1`, estado READY, alvo production, SHA `31637073dc7d2e3e534c58950c046521ba91b632`.

`https://teste-gpt-autonomo.vercel.app/` e `/admin.html` responderam HTTP 200 em requisições sem cookies ou credenciais. O navegador carregou os assets, catálogo, API e Realtime reais. A política SSO da Vercel não foi alterada; sua remoção foi recusada pela revisão automática e tornou-se desnecessária após confirmar o acesso público ao endereço principal.

A operação de leitura dos logs de build pela integração Vercel retornou 403 para o escopo da equipe. O resultado da publicação foi confirmado pelo estado READY, pelo commit associado e pelo funcionamento efetivo do site.

A configuração de Site URL/Redirect URLs do Supabase Auth não está exposta pela integração utilizada. O dashboard exigiu login, portanto essas URLs ainda precisam ser conferidas para confirmar o primeiro acesso e a recuperação de senha do proprietário.
