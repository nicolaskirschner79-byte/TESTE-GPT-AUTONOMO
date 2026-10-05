import { escape } from './utils.js';
import { icon } from './ui.js';
import { safeImageUrl } from './image-utils.js';

export const HERO_DEFAULTS = Object.freeze({
  hero_mode: 'preset', hero_image_url: '', hero_style: 'rounded', hero_preset: 'scissors',
  hero_position: 'center', hero_title: 'Bom corte.', hero_subtitle: 'Sem espera.',
});
export const HERO_STYLES = Object.freeze({ rounded: 'Arredondada', circle: 'Círculo', frame: 'Moldura', organic: 'Orgânica' });
export const HERO_PRESETS = Object.freeze({ scissors: 'Tesoura clássica', pole: 'Barber pole', monogram: 'Monograma da marca' });
export function normalizeHero(settings = {}) {
  const input = settings.branding || settings;
  return {
    hero_mode: input.hero_mode === 'image' ? 'image' : 'preset',
    hero_image_url: safeImageUrl(input.hero_image_url),
    hero_style: Object.hasOwn(HERO_STYLES, input.hero_style) ? input.hero_style : HERO_DEFAULTS.hero_style,
    hero_preset: Object.hasOwn(HERO_PRESETS, input.hero_preset) ? input.hero_preset : HERO_DEFAULTS.hero_preset,
    hero_position: ['center', 'top', 'bottom'].includes(input.hero_position) ? input.hero_position : 'center',
    hero_title: typeof input.hero_title === 'string' ? input.hero_title.trim().slice(0, 60) : HERO_DEFAULTS.hero_title,
    hero_subtitle: typeof input.hero_subtitle === 'string' ? input.hero_subtitle.trim().slice(0, 60) : HERO_DEFAULTS.hero_subtitle,
  };
}
export function heroPresetMarkup(preset, shopName = '') {
  if (preset === 'monogram') {
    const initials = shopName.trim().split(/\s+/).slice(0, 2).map(word => [...word][0] || '').join('').toUpperCase();
    return `<span class="hero-monogram" aria-hidden="true">${escape(initials || 'SB')}</span>`;
  }
  if (preset === 'pole') return `<svg width="80" height="80" viewBox="0 0 80 80" fill="none" aria-hidden="true"><path d="M24 14h32M24 66h32" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><rect x="27" y="19" width="26" height="42" rx="6" fill="currentColor" fill-opacity=".08" stroke="currentColor" stroke-width="2"/><path d="m29 32 22-11m-22 25 22-11m-22 24 22-11" stroke="currentColor" stroke-width="5"/><path d="M21 73h38M31 8h18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;
  return icon('scissors', 76);
}
export function heroHighlightMarkup(settings, { previewUrl = '' } = {}) {
  const config = normalizeHero(settings), name = settings.shop_name || 'Sistema Barber';
  const local = typeof previewUrl === 'string' && previewUrl.startsWith('blob:') ? previewUrl : '';
  const source = local || config.hero_image_url;
  const photo = config.hero_mode === 'image' && source;
  const artwork = photo
    ? `<img class="hero-image" src="${escape(source)}" alt="Imagem de destaque de ${escape(name)}" width="600" height="600" decoding="async" referrerpolicy="no-referrer">`
    : heroPresetMarkup(config.hero_preset, name);
  return `<figure class="hero-art ${photo ? 'hero-photo' : 'hero-preset'} hero-style-${config.hero_style}" data-position="${config.hero_position}">${artwork}</figure>${config.hero_title || config.hero_subtitle ? `<div class="hero-note-rule"></div><p class="hero-caption">${config.hero_title ? `<span>${escape(config.hero_title)}</span>` : ''}${config.hero_subtitle ? `<span>${escape(config.hero_subtitle)}</span>` : ''}</p>` : ''}`;
}
