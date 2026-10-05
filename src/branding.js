import { escape } from './utils.js';
import { icon } from './ui.js';
import { safeImageUrl } from './image-utils.js';
import { HERO_DEFAULTS, normalizeHero, heroHighlightMarkup, heroPresetMarkup } from './hero-art.js';

export const DEFAULT_BRANDING = Object.freeze({
  shop_name: 'Sistema Barber', tagline: 'Seu tempo. Seu estilo.', logo_url: '',
  accent_color: '#d83737', header_color: '#191919', background_color: '#f6f6f3', font: 'inter',
  ...HERO_DEFAULTS,
});
export const BRAND_FONTS = Object.freeze({
  inter: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  system: 'Arial, Helvetica, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
});
const CACHE_KEY = 'barber-branding-v1';
const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || '') ? value.toLowerCase() : fallback;
let current = { ...DEFAULT_BRANDING };

export const safeLogoUrl = safeImageUrl;
export function normalizeBranding(settings = {}) {
  const input = settings.branding || settings;
  return {
    shop_name: String(settings.shop_name || input.shop_name || DEFAULT_BRANDING.shop_name).trim().slice(0, 100),
    tagline: typeof input.tagline === 'string' ? input.tagline.trim().slice(0, 100) : DEFAULT_BRANDING.tagline,
    logo_url: safeLogoUrl(input.logo_url),
    accent_color: color(input.accent_color, DEFAULT_BRANDING.accent_color),
    header_color: color(input.header_color, DEFAULT_BRANDING.header_color),
    background_color: color(input.background_color, DEFAULT_BRANDING.background_color),
    font: Object.hasOwn(BRAND_FONTS, input.font) ? input.font : DEFAULT_BRANDING.font,
    ...normalizeHero(input),
  };
}
const rgb = value => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
function luminance(value) {
  const [r, g, b] = rgb(value).map(n => { const v = n / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  return .2126 * r + .7152 * g + .0722 * b;
}
export function contrastText(background) { return luminance(background) > .179 ? '#000000' : '#ffffff'; }
export function shade(value, factor) { return '#' + rgb(value).map(v => Math.round(v * factor).toString(16).padStart(2, '0')).join(''); }
export function accentText(value) {
  let text = value;
  while ((1.05 / (luminance(text) + .05)) < 4.5) text = shade(text, .85);
  return text;
}
export function initials(name) { return name.trim().split(/\s+/).slice(0, 2).map(word => [...word][0] || '').join('').toUpperCase(); }
function nameMarkup(name) {
  const words = name.split(/\s+/), last = words.pop();
  return `${escape(words.join(' '))}${words.length ? ' ' : ''}<b>${escape(last)}</b>`;
}
export function logoMarkup(url, size = 24) {
  return url ? `<img class="brand-logo" src="${escape(url)}" alt="" decoding="async" referrerpolicy="no-referrer">` : icon('scissors', size);
}
export function getBranding() { return { ...current }; }
export function brandMarkup(subtitle) {
  return `<span class="brand-symbol" data-brand-symbol>${logoMarkup(current.logo_url)}</span><span class="brand-copy"><span class="brand-name" data-brand-name>${nameMarkup(current.shop_name)}</span><small ${subtitle === undefined ? 'data-brand-tagline' : ''}>${escape(subtitle ?? current.tagline)}</small></span>`;
}
export function applyBranding(settings, { persist = true } = {}) {
  current = normalizeBranding(settings);
  if (typeof document === 'undefined') return current;
  const style = document.documentElement.style;
  const variables = {
    '--red': current.accent_color, '--red-dark': shade(current.accent_color, .82),
    '--brand-accent-text': accentText(current.accent_color), '--on-accent': contrastText(current.accent_color),
    '--brand-header': current.header_color, '--on-header': contrastText(current.header_color),
    '--brand-bg': current.background_color, '--on-bg': contrastText(current.background_color),
  };
  Object.entries(variables).forEach(([key, value]) => style.setProperty(key, value));
  style.fontFamily = BRAND_FONTS[current.font];
  document.querySelectorAll('[data-brand-name]').forEach(el => el.innerHTML = nameMarkup(current.shop_name));
  document.querySelectorAll('[data-shop-name]').forEach(el => el.textContent = current.shop_name);
  document.querySelectorAll('[data-shop-initials]').forEach(el => el.textContent = initials(current.shop_name));
  document.querySelectorAll('[data-brand-symbol]').forEach(el => el.innerHTML = logoMarkup(current.logo_url));
  document.querySelectorAll('[data-brand-tagline]').forEach(el => el.textContent = current.tagline);
  document.querySelectorAll('[data-brand-home]').forEach(el => el.setAttribute('aria-label', current.shop_name + ', início'));
  const heroKey = JSON.stringify({ shop_name: current.shop_name, ...normalizeHero(current) });
  document.querySelectorAll('[data-hero-highlight]').forEach(el => {
    if (el.dataset.heroConfig !== heroKey) { el.innerHTML = heroHighlightMarkup(current); el.dataset.heroConfig = heroKey; }
  });
  document.dispatchEvent(new CustomEvent('brandingchange'));
  document.title = `${current.shop_name} · ${location.pathname.includes('admin.html') ? 'Painel do proprietário' : 'Agendamento online'}`;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', current.header_color);
  document.querySelector('meta[name="description"]')?.setAttribute('content', `Agende seu atendimento na ${current.shop_name}. Horários atualizados e seus agendamentos no mesmo dispositivo.`);
  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) {
    const fallback = icon('scissors', 24).replace('currentColor', contrastText(current.accent_color)).replace('<path', `<rect width="24" height="24" rx="5" fill="${current.accent_color}" stroke="none"/><path`);
    favicon.href = current.logo_url || 'data:image/svg+xml,' + encodeURIComponent(fallback);
    if (current.logo_url) favicon.removeAttribute('type'); else favicon.type = 'image/svg+xml';
  }
  if (persist) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(current)); } catch { /* A identidade também funciona sem armazenamento local. */ } }
  return current;
}
export function initBranding() {
  try { const cached = JSON.parse(localStorage.getItem(CACHE_KEY)); if (cached) applyBranding(cached, { persist: false }); } catch { /* Configurações novas virão do servidor. */ }
  window.addEventListener('storage', event => {
    if (event.key === CACHE_KEY && event.newValue) { try { applyBranding(JSON.parse(event.newValue), { persist: false }); } catch { /* Cache inválido não altera a página. */ } }
  });
  document.addEventListener('error', event => {
    if (event.target instanceof HTMLImageElement && event.target.classList.contains('brand-logo')) event.target.parentElement.innerHTML = icon('scissors', 24);
    if (event.target instanceof HTMLImageElement && event.target.classList.contains('hero-image')) {
      const art = event.target.closest('.hero-art');
      art.innerHTML = heroPresetMarkup(current.hero_preset, current.shop_name);
      art.classList.remove('hero-photo'); art.classList.add('hero-preset', 'image-unavailable');
    }
  }, true);
}
