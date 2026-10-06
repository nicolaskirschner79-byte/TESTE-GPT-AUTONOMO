# Agendamentos de uma hora

Correção de 6 de outubro de 2026 para https://teste-gpt-autonomo.vercel.app/.

A soma das previsões dos serviços produzia reservas de 65, 130 ou 195 minutos. Por exemplo, 09:00–10:05 bloqueava a próxima vaga das 10:00. A ocupação agora é sempre de 60 minutos, para qualquer serviço ou combinação de serviços. Os preços continuam somados normalmente.

## Banco e disponibilidade

- A migração `20261006223000_fixed_hour_appointments.sql` foi aplicada no Supabase.
- Disponibilidade usa janelas de 60 minutos e início a cada 60 minutos a partir da abertura ou do fim do almoço. Um intervalo que termina às 10:00 permite o próximo começar às 10:00.
- Criação pública, agendamento manual e reagendamento seguem a mesma regra. Um trigger garante duração de 60 minutos inclusive ao reagendar reservas antigas, mantendo a restrição transacional de sobreposição.
- As seis reservas que ocupavam a agenda de hoje em diante foram normalizadas. Comparação antes/depois confirmou início, serviços, valores, pagamentos e histórico anterior preservados. A versão foi incrementada nos registros ajustados.
- Almoço, fechamento, datas especiais, bloqueios, horários passados e horários já ocupados continuam respeitados.
- A atualização do banco sinaliza a disponibilidade em tempo real. Não foram criadas reservas de teste nem processadas mensagens.

## Interface

A seleção de horários e os diálogos de reagendamento exibem o intervalo completo: **10:00–11:00**, **13:00–14:00** etc. A prévia e o resumo informam **1 hora reservada na agenda**. A duração individual continua marcada como previsão do serviço. No painel, horários livres aparecem inicialmente e podem ser ocultados pelo botão correspondente. Os campos de intervalo dos profissionais e horários especiais mostram o valor fixo de 60 minutos.

## Verificação

- 33 testes locais aprovados; build de produção e verificação de diferenças aprovados.
- `tests/fixed-hour.sql` executado em produção somente com consultas de leitura.
- As 15 combinações dos quatro serviços ativos retornaram duração de reserva de 60 minutos. As previsões e o total dos serviços foram preservados.
- No dia livre usado na verificação, 08/10/2026, os nove horários foram retornados: 09:00, 10:00, 11:00, 13:00, 14:00, 15:00, 16:00, 17:00 e 18:00. Todos terminam uma hora após o início.
- A agenda pública e a administrativa usam a mesma janela; horários adjacentes não são bloqueados pelo atendimento anterior. Almoço e fechamento permaneceram bloqueados.
- Nenhum novo aviso de segurança; permanece o aviso anterior de proteção contra senhas vazadas no plano Free.
- Os fixtures SQL anteriores tiveram as expectativas de duração atualizadas, mas não foram reexecutados em produção nesta etapa.
