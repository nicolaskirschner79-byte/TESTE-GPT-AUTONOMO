# Configuração da plataforma oficial do WhatsApp

O código chama `POST https://graph.facebook.com/{WHATSAPP_GRAPH_VERSION}/{WHATSAPP_PHONE_NUMBER_ID}/messages`, usando um token de servidor. Ele não abre `wa.me` para simular um envio automático.

## Pré-requisitos

- App no Meta for Developers com o produto WhatsApp configurado.
- Remetente oficial registrado e habilitado. Lembretes aos clientes podem usar o número do barbeiro como remetente; o mesmo número não recebe mensagens enviadas por ele próprio.
- Token adequado e permissão de envio de mensagens.
- Destinatários de teste autorizados pela Meta, quando usando um remetente de teste.
- Templates aprovados em `pt_BR`. O código usa templates em todos os envios para funcionar também fora de janelas de conversa.

## Secrets

Você pode conectar a conta em **Painel → Configurações → Conectar WhatsApp**. O painel consulta os telefones da conta e verifica que o modelo em `pt_BR` está aprovado e tem os parâmetros esperados. A verificação não envia mensagens nem registra/migra telefones na Meta. A autorização de envio é guardada em JSON criptografado no Supabase Vault (`barber_whatsapp_config`), acessível somente ao backend. O navegador recebe apenas dados públicos e indicadores de presença dos segredos. Campos de segredo vazios preservam os valores já salvos. O modelo de aviso ao barbeiro e o retorno de entrega são opcionais para enviar lembretes aos clientes.

A conexão utiliza a conta oficial da Meta; o projeto ainda não possui um aplicativo Meta habilitado para Embedded Signup. Não há fluxo fictício de QR Code. Primeiro habilite o remetente e aprove o modelo na Meta. Não envie tokens pelo chat.

Como alternativa, copie os nomes de `supabase/secrets.env.example` para **Supabase → Edge Functions → Secrets** e preencha-os por esse canal seguro.

| Nome | Conteúdo |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Token de envio oficial, mantido no servidor |
| `WHATSAPP_WABA_ID` | ID da conta WhatsApp Business, usado na validação da conexão |
| `WHATSAPP_PHONE_NUMBER_ID` | Identificador do remetente, não o número de telefone |
| `WHATSAPP_SENDER_PHONE` | Número remetente completo, ex.: 5515... |
| `WHATSAPP_GRAPH_VERSION` | Versão da Graph API habilitada no app, ex.: vXX.X |
| `WHATSAPP_OWNER_TEMPLATE` | Nome aprovado do template de atualização ao barbeiro |
| `WHATSAPP_REMINDER_TEMPLATE` | Nome aprovado do template de lembrete ao cliente |
| `WHATSAPP_APP_SECRET` | App Secret para validar a assinatura HMAC do webhook |
| `WHATSAPP_VERIFY_TOKEN` | String aleatória escolhida para validar a inscrição do webhook |
| `PUBLIC_SITE_URL` | URL pública do site de agendamento |

Não versionar um arquivo com valores reais. O worker usa uma chave interna criada no Vault pelo banco; essa chave não precisa ser copiada nem enviada ao ChatGPT.

## Template de atualização ao barbeiro

Crie o template `barber_owner_update` ou ajuste `WHATSAPP_OWNER_TEMPLATE`. Corpo sugerido, com nove parâmetros nessa ordem:

```text
Sistema Barber · {{1}}
Cliente: {{2}}
Celular: {{3}}
Serviços: {{4}}
Quando: {{5}}
Valor: {{6}}
Reserva: {{7}}
Agenda de {{8}}: {{9}}
```

As categorias, o conteúdo e a aprovação do template ficam a critério da Meta. O último parâmetro contém a agenda ordenada do barbeiro na data reservada; o código limita parâmetros de texto a 900 caracteres para preservar compatibilidade. Agendas extensas devem ser consultadas integralmente no painel.

## Template de lembrete

Crie `barber_booking_reminder` com seis parâmetros nessa ordem:

```text
Olá, {{1}}! Este é seu lembrete do {{2}}.
Atendimento: {{3}}
Serviços: {{4}}
Profissional: {{5}}
Consulte sua reserva no dispositivo em que agendou: {{6}}
```

O cliente precisa marcar uma autorização separada durante a reserva. O banco bloqueia o envio se não houver consentimento, se a reserva estiver cancelada ou se o atendimento já tiver passado.

## Webhook

Configure a callback URL:

`https://hvsqlrqegjbjqspaqcsc.supabase.co/functions/v1/whatsapp-webhook`

Use `WHATSAPP_VERIFY_TOKEN` na inscrição e habilite eventos de mensagens/status. O GET devolve `hub.challenge` somente quando o token corresponde. POSTs exigem `X-Hub-Signature-256` válido, calculado sobre o corpo original com o App Secret.

## Fila e tentativas

- Uma reserva confirmada continua confirmada se o WhatsApp falhar.
- A API dispara processamento em segundo plano; `barber-whatsapp-queue` consulta a fila a cada minuto.
- Sem secrets/templates, os jobs não são retirados da fila.
- O lock `FOR UPDATE SKIP LOCKED` e o lease impedem workers concorrentes de processar o mesmo job.
- HTTP 429 pode ser repetido com intervalo exponencial, até seis tentativas. Falhas definitivas ficam registradas.
- Timeout, resposta ambígua do provedor ou lease expirado recebem estado **Verificar envio**. Reenviar automaticamente nesses casos poderia duplicar a mensagem. O webhook pode reconciliar o envio por ID do provedor ou pelo identificador opaco do job.
- **Enviado** não é **Entregue**. Os estados de entrega/leitura dependem dos eventos reais do webhook.

## Lembretes automáticos de 30 minutos

O cron existente invoca o worker a cada minuto, independentemente de uma sessão do proprietário ou da página estar aberta. Quando a conexão está pronta e a automação está habilitada, o worker inclui reservas `agendado`/`confirmado` com consentimento e início nos próximos 30 minutos. O horário esperado é `starts_at - 30 minutos`; a precisão normal é de aproximadamente um minuto, mais latência do provedor. Uma reserva feita/reativada com menos de 30 minutos de antecedência entra na próxima verificação. Se o servidor se recuperar de uma interrupção antes do atendimento, o lembrete também pode sair atrasado. Reservas cujo horário passou nunca recebem um lembrete novo.

A chave única combina reserva e instante de início: confirmações e ticks repetidos não geram outro lembrete. Reagendamentos invalidam a mensagem pendente e passam a usar o novo início. Um lembrete manual solicitado dentro da janela dos 30 minutos suprime o automático para o mesmo início. Cancelamento, atendimento iniciado, ausência ou retirada de consentimento invalidam a fila. Imediatamente antes da chamada à Meta, o worker verifica novamente a reserva; uma alteração ocorrida depois que a requisição já chegou à Meta não pode recolher uma mensagem.

**Pausar lembretes automáticos** impede inclusão e claim das mensagens automáticas pendentes. Lembretes manuais continuam disponíveis. **Ativar** retoma as verificações. Avisos ao barbeiro com mais de 24 horas expiram em vez de serem enviados em massa quando a conta é conectada. O HTTP 202 do worker indica apenas processamento aceito, que continua em segundo plano; o resultado real é persistido na fila.

O envio manual permanece disponível após prévia; solicitações repetidas em menos de 15 minutos são bloqueadas.

## Teste real a realizar após configurar

Faça uma reserva de teste, confirme que ela permanece no banco, acompanhe a fila, confira o WhatsApp do barbeiro e o webhook de entrega. Depois cancele ou reagende e valide a atualização. Faça um lembrete apenas para um cliente que tenha consentido. Esse teste externo ainda não foi executado.

Referências oficiais: [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/overview) e [validação de webhook do SDK da Meta](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/).
