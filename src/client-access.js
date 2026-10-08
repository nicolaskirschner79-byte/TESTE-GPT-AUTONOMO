import { deviceToken, restoreDevice } from './api.js';
import { modal, toast } from './ui.js';
import { escape } from './utils.js';

export function saveAccessDialog() {
  const key = deviceToken();
  const dialog = modal('Salvar minha chave de acesso', `<p>Guarde esta chave em um lugar seguro. Ela permite consultar, cancelar e reagendar suas reservas em outro navegador, dentro do prazo permitido.</p><label>Chave de acesso<input id="saved-access-key" readonly autocomplete="off" spellcheck="false" value="${escape(key)}"></label><p class="fine-print">Quem tiver esta chave poderá gerenciar suas reservas. Não a compartilhe publicamente. A barbearia não envia essa chave por telefone.</p><button class="btn primary" id="download-access">Baixar chave</button>`);
  dialog.querySelector('#download-access').onclick = () => {
    const blob = new Blob([`Chave de acesso às minhas reservas\n${key}\n\nGuarde em segurança. Na página Meus agendamentos, use Recuperar acesso.\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'minha-chave-agendamentos.txt'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Chave preparada para download.');
  };
}

export function restoreAccessDialog(onRestored) {
  modal('Recuperar acesso às reservas', '<p>Use a chave que você salvou no navegador anterior. Informar somente o celular não libera acesso às reservas.</p><form><label>Chave salva<input name="access_key" required minlength="43" maxlength="43" autocomplete="off" spellcheck="false"></label></form><p class="fine-print">Se você perdeu a chave, fale com a barbearia. O acesso atual será substituído somente após validar a chave.</p>', {
    confirm: 'Recuperar acesso',
    onConfirm: async dialog => {
      const form = dialog.querySelector('form');
      if (!form.reportValidity()) throw new Error('Confira a chave de acesso.');
      await restoreDevice(new FormData(form).get('access_key'));
      await onRestored(); toast('Acesso recuperado.');
    },
  });
}
