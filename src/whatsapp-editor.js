import { escape, phoneMask } from './utils.js';

export function whatsappSettingsMarkup(status) {
  const w = status?.whatsapp ?? {};
  const ready = w.configured === true;
  return `<section class="panel-card special-panel whatsapp-settings"><div class="panel-heading"><div><h3>WhatsApp automático</h3><p>Envie lembretes 30 minutos antes do atendimento.</p></div><span class="badge ${ready ? 'confirmado' : 'pending'}">${ready ? w.automatic_enabled === false ? 'Pausado' : 'Conectado' : 'Falta conectar'}</span></div><p>${ready ? 'A conexão está pronta. Os clientes que autorizarem recebem o lembrete automaticamente.' : 'Conecte sua conta oficial do WhatsApp Business em poucos passos. Você só precisa do token da Meta e do ID da conta.'}</p>${w.sender_phone ? `<p><strong>Número conectado:</strong> ${escape(phoneMask(w.sender_phone))}${w.verified_name ? ` · ${escape(w.verified_name)}` : ''}</p>` : ''}<div class="detail-actions"><button id="connect-whatsapp" class="btn primary small">${ready ? 'Conectar / gerenciar WhatsApp' : 'Conectar meu WhatsApp'}</button>${ready ? `<button id="toggle-whatsapp" class="btn secondary small">${w.automatic_enabled === false ? 'Ativar lembretes' : 'Pausar lembretes'}</button>` : ''}</div><p class="fine-print">A conexão é validada antes de salvar. Nenhuma mensagem é enviada durante a configuração.</p></section>`;
}

export function whatsappConnectionFields(status) {
  const w = status?.whatsapp ?? {};
  const secret = (name, label, present) => `<label>${label}<input name="${name}" type="password" autocomplete="new-password" maxlength="4096" ${present ? '' : 'required'} placeholder="${present ? 'Já salvo — deixe vazio para manter' : 'Cole aqui'}"></label>`;
  return `<div class="wa-quickstart">
    <div class="wa-progress"><span>1</span><div><strong>Copie os dados da Meta</strong><small>Abra o painel oficial e selecione seu aplicativo com WhatsApp configurado.</small><a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer">Abrir Meta for Developers ↗</a></div></div>
    <div class="wa-progress"><span>2</span><div><strong>Preencha somente os dados principais</strong><small>O token autoriza o envio. O ID da conta identifica seu WhatsApp Business.</small></div></div>
    ${secret('access_token','Token de acesso da Meta',w.has_token)}
    <label>ID da conta WhatsApp Business (WABA)<input name="waba_id" inputmode="numeric" pattern="[0-9]{5,30}" required value="${escape(w.waba_id)}" placeholder="Ex.: 123456789012345"></label>
    <details class="wa-advanced"><summary>Configurações avançadas (normalmente não precisa alterar)</summary>
      <label>ID do telefone remetente — opcional, será localizado automaticamente<input name="phone_number_id" inputmode="numeric" pattern="[0-9]{5,30}" value="${escape(w.phone_number_id)}" placeholder="Detectar automaticamente"></label>
      <label>Versão da API<input name="graph_version" required pattern="v[0-9]{1,3}\\.0" value="${escape(w.graph_version || 'v25.0')}"></label>
      <label>Nome do modelo aprovado de lembrete<input name="reminder_template" required pattern="[a-z0-9_]{1,100}" value="${escape(w.reminder_template || 'barber_booking_reminder')}"></label>
      <details class="whatsapp-help"><summary>Como criar o modelo de lembrete</summary><p>Na Meta, crie um modelo em português (Brasil), categoria utilidade, com seis parâmetros numerados no corpo. Depois aguarde a aprovação.</p><pre>Olá, {{1}}! Lembramos do seu atendimento na {{2}}.
Horário: {{3}}.
Serviços: {{4}}.
Profissional: {{5}}.
Consulte sua reserva no dispositivo em que agendou: {{6}}.</pre></details>
      <label>Modelo de aviso ao barbeiro (opcional)<input name="owner_template" pattern="[a-z0-9_]{1,100}" value="${escape(w.owner_template)}" placeholder="Deixe vazio por enquanto"></label>
      ${secret('app_secret','Segredo do aplicativo (opcional para webhook)',w.has_app_secret)}
      ${secret('verify_token','Código de verificação do webhook (opcional)',w.has_verify_token)}
    </details>
    <label class="checkbox-inline"><input name="automatic_enabled" type="checkbox" ${w.automatic_enabled !== false ? 'checked' : ''}> Ativar lembretes automáticos</label>
    <p class="fine-print">O token é armazenado criptografado no servidor e nunca é exibido novamente. A validação consulta sua conta e o modelo aprovado, mas não envia mensagens.</p>
  </div>`;
}
