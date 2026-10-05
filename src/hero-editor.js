import { auth, api } from './api.js';
import { $, icon, busy, toast } from './ui.js';
import { escape } from './utils.js';
import { getBranding, applyBranding } from './branding.js';
import { HERO_DEFAULTS, HERO_STYLES, HERO_PRESETS, normalizeHero, heroHighlightMarkup } from './hero-art.js';
import { IMAGE_TYPES, validImageFile } from './image-utils.js';

const BUCKET = 'barber-hero', MAX_SIZE = 5 * 1024 * 1024;
export function heroSettingsMarkup(settings) {
  const hero = normalizeHero(settings);
  return `<section class="panel-card hero-settings-panel"><div class="panel-heading"><div><h3>Destaque da página inicial</h3><p>Personalize a área da tesoura e do texto “Bom corte. Sem espera.”.</p></div>${icon('scissors', 22)}</div><div class="hero-editor-layout"><form id="hero-form" class="admin-form"><fieldset class="hero-source"><legend>O que mostrar</legend><label><input type="radio" name="hero_mode" value="preset" ${hero.hero_mode === 'preset' ? 'checked' : ''}> Artes do sistema</label><label><input type="radio" name="hero_mode" value="image" ${hero.hero_mode === 'image' ? 'checked' : ''}> Minha imagem</label></fieldset><div id="hero-preset-control"><label>Arte pronta<select name="hero_preset">${Object.entries(HERO_PRESETS).map(([value, label]) => `<option value="${value}" ${hero.hero_preset === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><div id="hero-image-control" class="logo-control"><label>Imagem para o destaque<input type="file" id="hero-image-file" accept="image/png,image/jpeg,image/webp" aria-describedby="hero-image-help"></label><div class="logo-controls"><span id="hero-image-selection">${hero.hero_image_url ? 'Imagem atual salva' : 'Nenhuma imagem selecionada'}</span><button id="remove-hero-image" class="text-btn" type="button" ${hero.hero_image_url ? '' : 'disabled'}>Remover imagem</button></div><p id="hero-image-help" class="fine-print">PNG, JPG ou WebP, até 5 MB. A foto é ajustada automaticamente ao formato escolhido.</p></div><fieldset class="hero-style-options" id="hero-style-control"><legend>Formato da imagem</legend>${Object.entries(HERO_STYLES).map(([value, label]) => `<label class="hero-style-option"><input type="radio" name="hero_style" value="${value}" ${hero.hero_style === value ? 'checked' : ''}><span class="hero-shape-sample shape-${value}" aria-hidden="true"></span><span>${label}</span></label>`).join('')}</fieldset><p class="fine-print hero-style-help" id="hero-style-help">Os formatos se aplicam à sua imagem enviada.</p><label id="hero-position-control">Enquadramento da imagem<select name="hero_position"><option value="center" ${hero.hero_position === 'center' ? 'selected' : ''}>Centralizado</option><option value="top" ${hero.hero_position === 'top' ? 'selected' : ''}>Priorizar o topo</option><option value="bottom" ${hero.hero_position === 'bottom' ? 'selected' : ''}>Priorizar a parte de baixo</option></select></label><div class="form-row"><label>Primeira linha do texto<input name="hero_title" maxlength="60" value="${escape(hero.hero_title)}" placeholder="Bom corte."></label><label>Segunda linha do texto<input name="hero_subtitle" maxlength="60" value="${escape(hero.hero_subtitle)}" placeholder="Sem espera."></label></div><div class="branding-actions"><button class="btn primary" type="submit">Salvar destaque ${icon('check', 16)}</button><button class="text-btn" id="reset-hero" type="button">Voltar ao destaque padrão</button></div></form><aside class="hero-preview-wrap"><span class="tiny-label">PRÉVIA DO DESTAQUE</span><div class="hero-editor-preview"><div class="hero-highlight" id="hero-preview"></div></div><p class="fine-print">Você pode alternar entre sua foto e as artes do sistema. O destaque muda na página dos clientes depois de salvar.</p></aside></div></section>`;
}

export function bindHeroSettings(settings, { onDirty, onSaved }) {
  const form = $('#hero-form'), initial = normalizeHero(settings), storage = auth.storage.from(BUCKET);
  let imageUrl = initial.hero_image_url, file = null, objectUrl = '', imageRequest = 0, imageLoading = false, submitting = false, disposed = false;
  const releasePreview = () => { if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = ''; };
  const draft = () => normalizeHero({ ...initial, ...Object.fromEntries(new FormData(form).entries()), hero_image_url: imageUrl });
  function preview() {
    if (disposed || !form.isConnected) return;
    const config = draft(), ownImage = config.hero_mode === 'image';
    $('#hero-preset-control').hidden = ownImage;
    $('#hero-image-control').hidden = !ownImage;
    $('#hero-position-control').hidden = !ownImage;
    $('#hero-style-control').hidden = !ownImage;
    $('#hero-style-help').hidden = !ownImage;
    $('#remove-hero-image').disabled = !imageUrl && !file;
    $('#hero-preview').innerHTML = heroHighlightMarkup({ ...getBranding(), ...config }, { previewUrl: objectUrl });
    $('#hero-preview').classList.toggle('awaiting-image', ownImage && !imageUrl && !file);
  }
  document.addEventListener('brandingchange', preview);
  form.addEventListener('input', () => { onDirty(true); preview(); });
  form.addEventListener('change', () => { onDirty(true); preview(); });
  $('#hero-image-file').onchange = async event => {
    const next = event.target.files[0]; if (!next) return;
    const request = ++imageRequest; imageLoading = false;
    if (!validImageFile(next, MAX_SIZE)) { event.target.value = ''; toast('Escolha uma imagem PNG, JPG ou WebP de até 5 MB.', true); return; }
    imageLoading = true;
    const nextUrl = URL.createObjectURL(next), image = new Image(); image.src = nextUrl;
    try { await image.decode(); } catch {
      URL.revokeObjectURL(nextUrl);
      if (request === imageRequest && !disposed) { imageLoading = false; event.target.value = ''; toast('Essa imagem não pôde ser aberta. Escolha outra.', true); }
      return;
    }
    if (disposed || request !== imageRequest) { URL.revokeObjectURL(nextUrl); return; }
    imageLoading = false; releasePreview(); objectUrl = nextUrl; file = next;
    $('#hero-image-selection').textContent = next.name; onDirty(true); preview();
  };
  $('#remove-hero-image').onclick = () => {
    imageRequest++; imageLoading = false; releasePreview(); imageUrl = ''; file = null;
    form.querySelector('#hero-image-file').value = '';
    form.elements.hero_mode.value = 'preset';
    $('#hero-image-selection').textContent = 'Nenhuma imagem selecionada'; onDirty(true); preview();
  };
  $('#reset-hero').onclick = () => {
    imageRequest++; imageLoading = false; releasePreview(); file = null;
    form.querySelector('#hero-image-file').value = '';
    for (const key of ['hero_mode', 'hero_style', 'hero_preset', 'hero_position', 'hero_title', 'hero_subtitle']) form.elements[key].value = HERO_DEFAULTS[key];
    $('#hero-image-selection').textContent = imageUrl ? 'Imagem atual salva' : 'Nenhuma imagem selecionada'; onDirty(true); preview();
  };
  const ownedPath = url => {
    const prefix = storage.getPublicUrl('').data.publicUrl;
    return url?.startsWith(prefix) ? url.slice(prefix.length).replace(/^\//, '') : null;
  };
  form.onsubmit = async event => {
    event.preventDefault(); if (submitting) return;
    if (imageLoading) { toast('Aguarde a imagem aparecer na prévia antes de salvar.'); return; }
    const config = draft();
    if (config.hero_mode === 'image' && !imageUrl && !file) { toast('Envie uma imagem ou escolha uma das artes do sistema.', true); return; }
    submitting = true; let uploaded = '', saved = false, nextImageUrl = imageUrl;
    try {
      await busy(form.querySelector('[type="submit"]'), (async () => {
        const controls = [...form.querySelectorAll('input,select,button')], disabled = controls.map(control => control.disabled);
        controls.forEach(control => control.disabled = true);
        try {
          if (file && config.hero_mode === 'image') {
            const { data, error } = await auth.auth.getUser();
            if (error || !data.user) throw new Error('Entre novamente no painel para enviar a imagem.');
            const path = `images/${data.user.id}/${crypto.randomUUID()}.${IMAGE_TYPES[file.type]}`;
            const result = await storage.upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
            if (result.error) throw new Error('Não foi possível enviar a imagem. Confira sua conexão e tente novamente.');
            uploaded = path; nextImageUrl = storage.getPublicUrl(path).data.publicUrl;
          }
          config.hero_image_url = nextImageUrl;
          await api('settings', { branding: config }, true);
          saved = true; imageUrl = nextImageUrl; onDirty(false);
          const oldPath = initial.hero_image_url !== imageUrl && ownedPath(initial.hero_image_url);
          Object.assign(initial, config); file = null; releasePreview();
          applyBranding({ ...getBranding(), ...config });
          if (!disposed && form.isConnected) { form.querySelector('#hero-image-file').value = ''; $('#hero-image-selection').textContent = imageUrl ? 'Imagem atual salva' : 'Nenhuma imagem selecionada'; preview(); }
          if (oldPath) await storage.remove([oldPath]).catch(() => {});
          await onSaved();
        } finally { controls.forEach((control, index) => control.disabled = disabled[index]); preview(); }
      })());
      toast('Destaque da página inicial salvo.');
    } catch (error) {
      if (uploaded && !saved) {
        try { const catalog = await api('catalog'); if (catalog.branding?.hero_image_url !== nextImageUrl) await storage.remove([uploaded]); } catch { /* Uma resposta perdida pode ter sido gravada; preserve o arquivo até confirmar. */ }
      }
      toast(error.message, true);
    } finally { submitting = false; }
  };
  preview(); return () => { disposed = true; imageRequest++; releasePreview(); document.removeEventListener('brandingchange', preview); };
}
