import { auth } from './api.js';
import { modal, toast, busy } from './ui.js';
import { escape } from './utils.js';

async function verifiedFactors() {
  const { data, error } = await auth.auth.mfa.listFactors();
  if (error) throw error;
  return data.totp.filter(factor => factor.status === 'verified');
}

export async function needsOwnerChallenge() {
  const { data, error } = await auth.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  return data.nextLevel === 'aal2' && data.currentLevel !== 'aal2';
}

export async function ownerChallenge(onSuccess, onLogout) {
  const factors = await verifiedFactors();
  if (!factors.length) throw new Error('Nenhum aplicativo autenticador ativo. Entre novamente.');
  document.querySelector('#app').innerHTML = `<main class="owner-challenge"><section class="panel-card"><h1>Confirme seu acesso</h1><p>Digite o código de seis números do seu aplicativo autenticador.</p><form id="owner-mfa-form"><label>Código do autenticador<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus></label><button class="btn primary full" type="submit">Verificar e entrar</button></form><button class="text-btn" id="mfa-logout">Sair desta sessão</button><p class="fine-print">Use o aplicativo configurado para este painel. Se perdeu o autenticador, a recuperação precisa ser feita pelo proprietário no Supabase.</p></section></main>`;
  document.querySelector('#mfa-logout').onclick = onLogout;
  document.querySelector('#owner-mfa-form').onsubmit = async event => {
    event.preventDefault();
    try {
      await busy(event.target.querySelector('button'), (async () => {
        const { error } = await auth.auth.mfa.challengeAndVerify({ factorId: factors[0].id, code: new FormData(event.target).get('code') });
        if (error) throw new Error('Código inválido ou expirado. Confira o aplicativo e tente novamente.');
        await onSuccess();
      })());
    } catch (error) { toast(error.message, true); }
  };
}

export function securitySettingsMarkup() {
  return '<section class="panel-card"><div class="panel-heading"><div><h3>Segurança e exportação</h3><p>Proteja o acesso administrativo e salve seus registros.</p></div></div><p id="owner-mfa-status">Consultando proteção do acesso…</p><button class="btn secondary small" id="owner-enroll-mfa" disabled>Ativar aplicativo autenticador</button><hr><p>Exporte agenda, serviços, pagamentos e despesas para guardar uma cópia dos registros operacionais.</p><button class="btn secondary small" id="owner-export">Baixar registros</button><p class="fine-print">O arquivo contém dados de clientes. Guarde em local seguro. Esta exportação não inclui contas de acesso, segredos, imagens ou a estrutura do banco.</p></section>';
}

export async function bindSecuritySettings({ exportData, onChanged }) {
  const status = document.querySelector('#owner-mfa-status'), button = document.querySelector('#owner-enroll-mfa');
  document.querySelector('#owner-export').onclick = async event => {
    try { await busy(event.currentTarget, exportData()); } catch (error) { toast(error.message, true); }
  };
  try {
    const factors = await verifiedFactors();
    if (!status.isConnected) return;
    status.textContent = factors.length ? 'Autenticador ativo. O segundo fator é exigido pela API e pelos uploads do painel.' : 'Ative o segundo fator com um aplicativo como Google Authenticator ou Microsoft Authenticator.';
    button.disabled = factors.length > 0;
    if (factors.length) button.textContent = 'Autenticador ativo';
    button.onclick = async () => {
      try {
        const { data: existing, error: listError } = await auth.auth.mfa.listFactors();
        if (listError) throw listError;
        for (const factor of existing.all.filter(f => f.factor_type === 'totp' && f.status === 'unverified' && f.friendly_name === 'Painel da barbearia')) {
          const { error } = await auth.auth.mfa.unenroll({ factorId: factor.id });
          if (error) throw error;
        }
        const { data, error } = await auth.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Painel da barbearia' });
        if (error) throw error;
        const qr = data.totp.qr_code.startsWith('data:image/svg+xml;utf-8,<')
          ? `data:image/svg+xml,${encodeURIComponent(data.totp.qr_code.slice(data.totp.qr_code.indexOf(',')+1))}`
          : data.totp.qr_code;
        let completed = false;
        const dialog = modal('Ativar aplicativo autenticador', `<p>Escaneie o QR code com seu aplicativo e guarde uma cópia segura da chave antes de ativar. Ela será necessária se você trocar de aparelho.</p><img class="mfa-qr" alt="QR code para cadastrar o autenticador" src="${escape(qr)}"><details><summary>Configurar manualmente / guardar chave</summary><code class="mfa-secret">${escape(data.totp.secret)}</code></details><form><label>Código de seis números<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><label class="checkbox-inline"><input type="checkbox" name="saved" required> Guardei a chave do autenticador em um local seguro.</label></form>`, {
          confirm: 'Verificar e ativar',
          onConfirm: async element => {
            const form = element.querySelector('form');
            if (!form.reportValidity()) throw new Error('Confira o código e confirme que guardou a chave.');
            const { error } = await auth.auth.mfa.challengeAndVerify({ factorId: data.id, code: new FormData(form).get('code') });
            if (error) throw new Error('Código inválido ou expirado. Confira o aplicativo.');
            completed = true; await onChanged(); toast('Autenticador ativado.');
          },
        });
        dialog.addEventListener('close', () => { if (!completed) auth.auth.mfa.unenroll({ factorId: data.id }).catch(() => {}); }, { once: true });
      } catch (error) { toast(error.message, true); }
    };
  } catch (error) { if (status.isConnected) status.textContent = `Não foi possível consultar o autenticador: ${error.message}`; }
}
