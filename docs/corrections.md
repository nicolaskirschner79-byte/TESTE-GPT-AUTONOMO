# Correções e agenda em calendário

Esta atualização resolve os problemas de código apontados na [avaliação do site](site-audit.md) e substitui a agenda extensa por um calendário diário/semanal. A marca e as reservas reais continuam sendo consultadas no Supabase.

## O que mudou

| Item da avaliação | Resultado |
|---|---|
| Indicadores de hoje zerados ao filtrar um período passado | Corrigido. O período financeiro e os últimos sete dias usam consultas independentes; os indicadores de hoje usam a segunda consulta. |
| Referência de hoje congelada quando a tela atravessa a meia-noite | Corrigido. Consultas e formulários calculam a data atual em São Paulo. A agenda acompanha a virada do dia quando está seguindo Hoje; o período financeiro acompanha a virada do mês quando está seguindo o mês atual. |
| Novo agendamento mantém URL do histórico | Corrigido. Navegação centralizada, com atualização da URL também após reservar e tratamento dos botões Voltar/Avançar do navegador. |
| Rodapé informa expediente fixo | Corrigido. O texto fixo foi substituído por Ver horários disponíveis, que leva à seleção real de serviço, profissional e data. |
| Requisição sem limite de espera | Corrigido. Limite de 15 segundos, mensagem legível e nenhum reenvio automático de operações. A chave idempotente de uma confirmação interrompida é preservada. |
| Painel permanece aberto sem sessão válida | Melhorado. Ausência de sessão gera 401 e o evento de saída retorna à entrada do painel. |
| WhatsApp sem configuração | Diagnóstico disponível apenas para o proprietário, com campos faltantes sem valores de segredos. Notificações e Configurações mostram a pendência. Novos lembretes são rejeitados sem criar outro item na fila quando o envio está desconfigurado. O envio real ainda depende das credenciais externas. |
| Proteção contra senhas vazadas desativada | Pendência externa. A organização foi consultada e está no plano Free; a proteção depende do plano Pro ou superior. Nenhuma cobrança, alteração de plano ou troca de senha foi realizada. |

## Agenda simplificada

- Grade com horários à esquerda e cartões posicionados pela hora do atendimento.
- Dia: uma coluna por profissional; Semana: sete colunas, de segunda a domingo, na mesma escala.
- Confirmado em verde, pendente em amarelo, em atendimento em azul, concluído em roxo, cancelado em vermelho e ausência em cinza.
- Nome, horário e serviço em cada cartão; detalhes, telefone, confirmação, início, pagamentos, ausência, lembrete, cancelamento e reagendamento abrem ao clicar.
- Hoje, seletor de data, setas, busca e filtros. Cabeçalhos e horários permanecem visíveis durante a rolagem.
- Almoço, fechamento e bloqueios usam as regras cadastradas; atalhos + usam apenas horários retornados pelo servidor.
- Reservas sobrepostas em tela, inclusive canceladas e de outros profissionais, recebem faixas separadas. Isso não altera os horários registrados.
- A rolagem é preservada durante a sincronização e a busca; um atendimento em curso fora do período permanece acessível para conclusão.
- Cartões de contadores e painel lateral foram removidos. Restam um resumo curto e a legenda de cores.

A visualização usa uma altura mínima para reservas muito curtas, facilitando clicar; o horário exato de início/fim continua no título acessível e nos detalhes. A semana permite rolagem horizontal em telas pequenas. Alterar horário por arrastar não foi implementado: o reagendamento continua validado pelo servidor através do diálogo.

## Verificações realizadas

- `npm test`: 30 testes aprovados, incluindo regressão dos recebimentos de hoje, períodos independentes, navegação, timeout sem duplicação, diagnóstico sem exposição de credenciais, escala e distribuição de reservas no calendário.
- `npm run build` e `git diff --check` aprovados.
- `tests/agenda.sql`: 10 grupos aprovados, incluindo andamento, versões, horários, conclusão, pagamentos e autorização.
- `tests/system-audit.sql`: 8 grupos aprovados para cadastros, disponibilidade, reserva, reagendamento, despesas, pagamento parcial, cancelamento e estorno.
- Os dois testes SQL revertem seus fixtures; não persistem reservas, pagamentos ou mensagens de teste.
- Backend em produção: catálogo HTTP 200; operações administrativas e diagnóstico sem sessão HTTP 401; worker sem sua credencial HTTP 401.
- Funções `barber-api` e `whatsapp-worker` atualizadas no Supabase, preservando a autorização explícita já existente. Nenhuma migration de banco foi necessária.

Na consulta após a atualização havia 7 reservas reais, 3 pagamentos e 11 mensagens pendentes, iguais aos números consultados antes dos testes. O worker continuou informando configuração incompleta e nenhum processamento.

## Pendências externas e limites

**WhatsApp:** ainda faltam dados reais do remetente, token e modelos da Meta. O retorno de entrega também precisa dos segredos do webhook. Consulte [whatsapp.md](whatsapp.md) e use o canal de Secrets do Supabase; não envie valores pelo chat. Depois da configuração, validar destinatário autorizado e entrega real, conferindo a idade das mensagens já pendentes.

**Senhas vazadas:** a documentação do Supabase informa a disponibilidade no plano Pro ou superior: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection. A integração desta sessão não oferece alteração das configurações de Auth nem de plano. Esse aviso não foi eliminado e não deve ser confundido com uma correção de frontend.

A inspeção completa da interface autenticada depende de uma sessão segura do proprietário no navegador de teste. A confirmação de entrega de WhatsApp e o e-mail de recuperação continuam sem teste externo completo. Os testes de banco e apresentação não substituem essas verificações.
