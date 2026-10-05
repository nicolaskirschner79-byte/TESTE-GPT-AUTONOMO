# Relatório de verificação

Data: 05/10/2026. Ambiente: projeto real Supabase `GPT-AUTONOMO`, frontend local e build Vite de produção.

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

Os resultados de interface e publicação serão registrados após a verificação final.
