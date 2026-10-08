# Correções do Sistema Barber — 8 de outubro de 2026

As reservas continuam ocupando exatamente **60 minutos**, conforme a decisão do proprietário. A previsão dos serviços não estende automaticamente uma reserva.

| Achado da avaliação | Correção |
| --- | --- |
| WhatsApp apresentado ao cliente sem configuração | O catálogo publica somente um indicador de disponibilidade, sem credenciais. O consentimento só aparece quando lembretes automáticos estão configurados e ativos; a API também confere essa condição. |
| Serviço longo em reserva de uma hora | Avisos na seleção, confirmação, comprovante e detalhes. O proprietário pode criar um bloco adicional, em horas completas, se houver espaço e expediente. Cancelar ou reagendar libera o bloco associado. |
| Botões de alteração após o prazo | O histórico usa a antecedência configurada e mostra o prazo ou a orientação de contato. O banco continua sendo a autoridade da regra. |
| Migrations divergentes | Os cinco nomes locais antigos foram alinhados aos IDs já aplicados. A migration nova é `20261008155958_reliability_fixes.sql`. As migrations iniciais não foram reaplicadas. |
| Limite somente por dispositivo | Limite também por celular, com locks transacionais, e limites menores por operação/IP. O telefone permanece sem verificação de posse; essa proteção reduz abuso e não substitui uma confirmação por SMS ou CAPTCHA. |
| Histórico perdido ao trocar de navegador | Chave de acesso que o cliente pode guardar e restaurar. O servidor valida a chave antes de substituir a identidade local. O telefone sozinho não autoriza acesso. Visitar a página não cria mais registros de clientes. |
| Falta de segundo fator | Interface de inscrição e desafio TOTP. Após um fator verificado ser ativado, a API exige JWT válido com `aal2`; uploads também exigem o segundo fator. O proprietário precisa concluir a ativação com seu aplicativo. |
| Índices e respostas administrativas | Índices das três FKs apontadas, índice para limite por telefone e ordenação de notificações. Histórico de notificações paginado; outras páginas podem omitir esse conjunto. |
| Financeiro confundia recebimento e conclusão | Adiantamentos mantêm o atendimento ativo. A conclusão é explícita. Um atendimento já totalmente pago pode ser concluído sem lançar outro pagamento. Idempotência e limites de saldo/estorno são preservados. |
| Expediente editado incompatível com reservas | Alterações que invalidam reservas futuras ou o tempo extra associado são recusadas. A remoção de horário especial também protege reservas existentes. Intervalos da agenda continuam fixos em 60 minutos. |
| Fila sem diagnóstico operacional | O worker registra horário de execução, configuração, quantidade processada e erro seguro. Avisos expirados são encerrados mesmo sem conexão. O painel diferencia falhas, respostas ambíguas e ausência de verificação recente. |
| Manutenção e testes | Regras compartilhadas em módulos próprios, arquivos principais formatados, CI com testes e build, Postgres isolado com as migrations completas e verificações reproduzíveis de produção. |
| Cópia dos registros | Exportação autenticada dos dados operacionais no painel. Não contém chaves de clientes, segredos ou contas de acesso. Não é um backup completo do Supabase e não substitui uma política de recuperação do provedor. |

## Validação executada

- **65 testes** passaram, incluindo aplicação das migrations no Postgres isolado, financeiro, cancelamento, conflitos, tempo adicional, recuperação, paginação, permissões e MFA nos uploads.
- Compilação de produção com Vite concluída.
- `npm audit`: nenhuma vulnerabilidade reportada nas dependências instaladas.
- **15 verificações HTTP em produção**: catálogo, disponibilidade, duração, ausência de exposição de credenciais, identidade desconhecida e bloqueio de funções administrativas/worker sem autorização. Não criaram clientes ou agendamentos e não enviaram mensagens.
- **10 regras verificadas no Postgres remoto**, com fixtures revertidas em uma subtransação. Incluem criação de reserva de uma hora, previsão longa, tempo extra, conflito, pagamentos e conclusão, liberação do bloco, recuperação e permissões. Nenhuma reserva de teste permaneceu no banco.
- Backend publicado: `barber-api` versão 4, `whatsapp-worker` versão 4 e `whatsapp-webhook` versão 3.
- Advisor de segurança após a migration: somente proteção contra senhas vazadas desativada. Avisos de índices ainda não utilizados são informativos; não há mais os três avisos de FKs sem índice.
- O cron registrou uma verificação do worker após a atualização, com `configured=false`, `processed=0` e sem erro.

## Configurações externas que permanecem necessárias

1. **WhatsApp real:** conectar no painel a conta WhatsApp Business, o remetente e os modelos aprovados pela Meta. Nenhuma conexão estava salva durante esta publicação. A ausência de conexão é informada na página pública e no painel; não foi feito um envio real.
2. **Autenticador do proprietário:** em Configurações, ativar o aplicativo autenticador e guardar a chave de recuperação antes de confirmar o código. Nenhum fator foi cadastrado automaticamente no aparelho do proprietário.
3. **Proteção contra senhas vazadas:** exige plano compatível do Supabase. Nenhuma assinatura ou alteração paga foi realizada. Referência: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.
4. **Recuperação completa de dados:** definir a política de backup do provedor e testar a restauração em um projeto separado. A exportação operacional não inclui esquema, autenticação, arquivos do Storage ou segredos.

## Reproduzir as verificações

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run build
node --env-file=.env.local tests/production-readonly.mjs
```

`tests/production-transaction.sql` contém o teste remoto reversível e não invoca provedores externos. Use somente após aplicar as migrations e conferir o projeto de destino. Os testes antigos que criam reservas reais não devem ser usados como teste de leitura em produção.

O login real do proprietário, a inscrição do autenticador e a entrega de mensagens pela Meta dependem das credenciais e dos dispositivos do proprietário. As regras correspondentes foram exercitadas em testes isolados; essas integrações reais não foram declaradas como validadas.
