import { auth, api } from './api.js';
import { $, icon, busy, toast } from './ui.js';
import { escape } from './utils.js';
import { DEFAULT_BRANDING, BRAND_FONTS, normalizeBranding, logoMarkup, contrastText, applyBranding, getBranding } from './branding.js';
import { IMAGE_TYPES, validImageFile } from './image-utils.js';

const BUCKET = 'barber-branding';
const MAX_SIZE = 2 * 1024 * 1024;

export function brandingSettingsMarkup(settings) {
  const brand = normalizeBranding(settings);
  return `<section class="panel-card branding-panel"><div class="panel-heading"><div><h3>Identidade visual</h3><p>A mesma marca no agendamento, no login e no painel.</p></div>${icon('scissors', 22)}</div><div class="branding-editor"><form class="admin-form" id="branding-form"><div class="form-row"><label>Nome da barbearia<input name="shop_name" value="${escape(brand.shop_name)}" required minlength="2" maxlength="100" autocomplete="organization"></label><label>Frase da marca<input name="tagline" value="${escape(brand.tagline)}" maxlength="100" placeholder="Uma frase que combina com você"></label></div><div class="logo-control"><label>Logo da barbearia<input id="brand-logo-file" type="file" accept="image/png,image/jpeg,image/webp" aria-describedby="logo-help"></label><div class="logo-controls"><span id="logo-selection">${brand.logo_url ? 'Logo atual salva' : 'Ícone padrão de tesoura'}</span><button id="remove-brand-logo" class="text-btn" type="button" ${brand.logo_url ? '' : 'disabled'}>Remover logo</button></div><p id="logo-help" class="fine-print">PNG, JPG ou WebP, até 2 MB. Para melhor resultado, use uma imagem quadrada com fundo transparente.</p></div><div class="brand-colors">${[['accent_color', 'Cor principal'], ['header_color', 'Cabeçalho e menu'], ['background_color', 'Fundo das páginas']].map(([key, label]) => `<label>${label}<span class="color-control"><input name="${key}" type="color" value="${brand[key]}" aria-label="${label}"><span data-color-code="${key}">${brand[key].toUpperCase()}</span></span></label>`).join('')}</div><label>Fonte do sistema<select name="font"><option value="inter" ${brand.font === 'inter' ? 'selected' : ''}>Moderna · Inter / sistema</option><option value="system" ${brand.font === 'system' ? 'selected' : ''}>Simples · Arial</option><option value="serif" ${brand.font === 'serif' ? 'selected' : ''}>Clássica · Georgia</option></select></label><div class="branding-rules"><label>Antecedência mínima para cancelar (minutos)<input name="cancellation_minutes" type="number" min="0" max="10080" value="${settings.cancellation_minutes}" required></label><p class="fine-print">Zero permite cancelamento até o início do atendimento. Fuso horário: America/Sao_Paulo.</p></div><div class="branding-actions"><button class="btn primary" type="submit">Salvar configurações ${icon('check', 16)}</button><button class="text-btn" id="reset-brand-colors" type="button">Restaurar cores e fonte</button></div></form><aside class="branding-preview-wrap"><span class="tiny-label">PRÉVIA DA IDENTIDADE</span><div id="branding-preview" class="branding-preview"></div><p class="fine-print">As alterações entram no sistema depois de salvar. Clientes com a página aberta recebem a atualização automaticamente.</p></aside></div></section>`;
}

export function bindBrandingSettings(settings, { onDirty, onSaved }) {
  const form = $('#branding-form'), initial = normalizeBranding(settings);
  let logo = initial.logo_url, file = null, objectUrl = '', submitting = false, disposed = false, imageRequest = 0, imageLoading = false;
  const dispose = () => { disposed = true; imageRequest++; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  const draft = () => {
    const data = new FormData(form);
    return normalizeBranding({ ...initial, ...Object.fromEntries(data.entries()) });
  };
  function preview() {
    if (disposed || !form.isConnected) return;
    const brand = draft(), headerText = contrastText(brand.header_color);
    const previewElement = $('#branding-preview');
    previewElement.style.fontFamily = BRAND_FONTS[brand.font];
    previewElement.style.setProperty('--preview-header', brand.header_color);
    previewElement.style.setProperty('--preview-header-text', headerText);
    previewElement.style.setProperty('--preview-bg', brand.background_color);
    previewElement.style.setProperty('--preview-text', contrastText(brand.background_color));
    previewElement.style.setProperty('--preview-accent', brand.accent_color);
    previewElement.style.setProperty('--preview-accent-text', contrastText(brand.accent_color));
    previewElement.innerHTML = `<div class="preview-header"><span class="preview-symbol">${logoMarkup(objectUrl || logo)}</span><span><strong>${escape(brand.shop_name)}</strong><small>${escape(brand.tagline)}</small></span></div><div class="preview-body"><span class="preview-eyebrow">AGENDAMENTO ONLINE</span><h3>Seu horário.<br>Do seu jeito.</h3><div class="preview-service"><span>Corte de cabelo<small>Um cuidado para o seu estilo</small></span>${icon('scissors', 22)}</div><span class="preview-button">Escolher horário ${icon('arrow', 16)}</span></div>`;
    form.querySelectorAll('[data-color-code]').forEach(el => el.textContent = brand[el.dataset.colorCode].toUpperCase());
    $('#remove-brand-logo').disabled = !logo && !file;
  }
  form.addEventListener('input', () => { onDirty(true); preview(); });
  $('#brand-logo-file').onchange = async event => {
    const next = event.target.files[0];
    if (!next) return;
    const request = ++imageRequest;
    imageLoading = false;
    if (!validImageFile(next, MAX_SIZE)) {
      event.target.value = ''; toast('Escolha uma imagem PNG, JPG ou WebP de até 2 MB.', true); return;
    }
    imageLoading = true;
    const nextUrl = URL.createObjectURL(next), image = new Image(); image.src = nextUrl;
    try { await image.decode(); } catch { URL.revokeObjectURL(nextUrl); if (request === imageRequest) { imageLoading = false; event.target.value = ''; toast('Essa imagem não pôde ser aberta. Escolha outra logo.', true); } return; }
    if (disposed || request !== imageRequest) { URL.revokeObjectURL(nextUrl); return; }
    imageLoading = false;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = nextUrl; file = next; onDirty(true);
    $('#logo-selection').textContent = next.name; preview();
  };
  $('#remove-brand-logo').onclick = () => {
    imageRequest++; imageLoading = false;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = ''; file = null; logo = ''; $('#brand-logo-file').value = '';
    $('#logo-selection').textContent = 'Ícone padrão de tesoura'; onDirty(true); preview();
  };
  $('#reset-brand-colors').onclick = () => {
    for (const key of ['accent_color', 'header_color', 'background_color', 'font']) form.elements[key].value = DEFAULT_BRANDING[key];
    onDirty(true); preview();
  };
  const storage = auth.storage.from(BUCKET);
  const ownedPath = url => {
    const prefix = storage.getPublicUrl('').data.publicUrl;
    return url?.startsWith(prefix) ? url.slice(prefix.length).replace(/^\//, '') : null;
  };
  form.onsubmit = async event => {
    event.preventDefault(); if (submitting) return;
    if (imageLoading) { toast('Aguarde a imagem carregar na prévia antes de salvar.'); return; }
    submitting = true;
    const brand = draft(), cancellation = Number(form.elements.cancellation_minutes.value);
    let uploaded = '', saved = false, nextLogo = logo;
    try {
      await busy(form.querySelector('[type="submit"]'), (async () => {
        // Congela os campos durante upload e gravação, preservando a prévia selecionada.
        const controls = [...form.querySelectorAll('input,select,button')];
        const disabled = controls.map(control => control.disabled);
        controls.forEach(control => control.disabled = true);
        try {
          if (file) {
            const { data, error } = await auth.auth.getUser();
            if (error || !data.user) throw new Error('Entre novamente no painel para enviar a logo.');
            const path = `logos/${data.user.id}/${crypto.randomUUID()}.${IMAGE_TYPES[file.type]}`;
            const result = await storage.upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
            if (result.error) throw new Error('Não foi possível enviar a logo. Confira sua conexão e tente novamente.');
            uploaded = path; nextLogo = storage.getPublicUrl(path).data.publicUrl;
          }
          const { shop_name, tagline, accent_color, header_color, background_color, font } = brand;
          const visual = { tagline, accent_color, header_color, background_color, font, logo_url: nextLogo };
          await api('settings', { shop_name, cancellation_minutes: cancellation, branding: visual }, true);
          saved = true; logo = nextLogo; onDirty(false); applyBranding({ ...getBranding(), shop_name, ...visual });
          const oldPath = initial.logo_url !== logo && ownedPath(initial.logo_url);
          Object.assign(initial, brand, { logo_url: logo }); file = null;
          if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = '';
          if (!disposed && form.isConnected) { form.querySelector('#brand-logo-file').value = ''; $('#logo-selection').textContent = logo ? 'Logo atual salva' : 'Ícone padrão de tesoura'; preview(); }
          if (oldPath) await storage.remove([oldPath]).catch(() => {});
          await onSaved();
        } finally { controls.forEach((control, index) => control.disabled = disabled[index]); preview(); }
      })());
      toast('Identidade visual e preferências salvas.');
    } catch (error) {
      // Confirma a ausência de gravação antes de limpar um upload; uma resposta perdida pode ter sido salva.
      if (uploaded && !saved) {
        try { const catalog = await api('catalog'); if (catalog.branding?.logo_url !== nextLogo) await storage.remove([uploaded]); } catch { /* A logo fica preservada até confirmar o estado no servidor. */ }
      }
      toast(error.message, true);
    } finally { submitting = false; }
  };
  preview(); return dispose;
}
