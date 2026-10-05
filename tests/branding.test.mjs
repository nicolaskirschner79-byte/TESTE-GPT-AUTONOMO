import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBranding, safeLogoUrl, contrastText, accentText, applyBranding, brandMarkup } from '../src/branding.js';

test('dados públicos e administrativos produzem a mesma identidade, com fallback para instalações antigas', () => {
  const branding = { tagline: 'Seu estilo', logo_url: 'https://example.com/logo.png', accent_color: '#2255AA', header_color: '#FFFFFF', background_color: '#F6F6F3', font: 'serif' };
  const catalog = normalizeBranding({ shop_name: 'Minha Barbearia', branding });
  assert.deepEqual(catalog, normalizeBranding({ id: true, shop_name: 'Minha Barbearia', branding, cancellation_minutes: 120 }));
  assert.equal(catalog.accent_color, '#2255aa');
  assert.equal(normalizeBranding({ shop_name: 'Nome existente' }).shop_name, 'Nome existente');
  assert.equal(normalizeBranding({ font: 'url(evil)', accent_color: 'red; color:transparent' }).font, 'inter');
});
test('logos rejeitam URLs executáveis, credenciais e arquivos locais; nomes e frases são escapados', () => {
  for (const url of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'http://example.com/logo.png', 'https://user:pass@example.com/logo.png', 'file:///tmp/logo.png']) assert.equal(safeLogoUrl(url), '');
  applyBranding({ shop_name: '<img onerror=alert(1)>', tagline: '<script>alert(1)</script>' });
  const markup = brandMarkup();
  assert.ok(!markup.includes('<img onerror'));
  assert.ok(!markup.includes('<script>'));
  assert.ok(markup.includes('&lt;script&gt;'));
});
test('cores claras e escuras mantêm contraste de pelo menos 4,5:1 no botão e no cabeçalho', () => {
  const luminance = hex => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
  };
  for (const background of ['#ffffff', '#000000', '#777777', '#d83737', '#00ff00', '#ffff00', '#2255aa']) {
    const text = contrastText(background), a = luminance(background), b = luminance(text);
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, background);
    assert.ok(1.05 / (luminance(accentText(background)) + .05) >= 4.5);
  }
});
