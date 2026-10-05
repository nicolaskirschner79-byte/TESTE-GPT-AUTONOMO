import test from 'node:test';
import assert from 'node:assert/strict';
import { HERO_DEFAULTS, HERO_STYLES, HERO_PRESETS, normalizeHero, heroHighlightMarkup } from '../src/hero-art.js';
import { normalizeBranding } from '../src/branding.js';
import { safeImageUrl, validImageFile } from '../src/image-utils.js';

test('instalações antigas mantêm a tesoura e os textos atuais; valores inválidos usam opções seguras', () => {
  assert.deepEqual(normalizeHero({ shop_name: 'Marca existente' }), HERO_DEFAULTS);
  const invalid = normalizeHero({ hero_mode: 'custom', hero_style: 'x" onload="evil()', hero_preset: 'evil', hero_position: 'left' });
  assert.equal(invalid.hero_style, 'rounded'); assert.equal(invalid.hero_preset, 'scissors');
  assert.equal(invalid.hero_mode, 'preset'); assert.equal(invalid.hero_position, 'center');
  assert.equal(normalizeHero({ hero_title: 'x'.repeat(100) }).hero_title.length, 60);
});

test('destaque usa a foto, o recorte e os quatro estilos disponíveis com textos escapados', () => {
  for (const style of Object.keys(HERO_STYLES)) {
    const markup = heroHighlightMarkup({ shop_name: 'A & B', branding: { hero_mode: 'image', hero_image_url: 'https://example.com/photo.webp', hero_style: style, hero_position: 'top', hero_title: '<script>evil()</script>', hero_subtitle: 'Meu corte' } });
    assert.ok(markup.includes('hero-photo')); assert.ok(markup.includes(`hero-style-${style}`));
    assert.ok(markup.includes('data-position="top"')); assert.ok(markup.includes('alt="Imagem de destaque de A &amp; B"'));
    assert.ok(!markup.includes('<script>')); assert.ok(markup.includes('&lt;script&gt;')); assert.ok(markup.includes('Meu corte'));
  }
});

test('artes prontas incluem as iniciais da marca e não descartam a foto salva ao alternar', () => {
  for (const preset of Object.keys(HERO_PRESETS)) {
    const settings = { shop_name: 'FLÁVIO BARBER', hero_mode: 'preset', hero_preset: preset, hero_image_url: 'https://example.com/saved.jpg' };
    const markup = heroHighlightMarkup(settings);
    assert.ok(markup.includes('hero-preset')); assert.ok(!markup.includes('<img'));
    if (preset === 'monogram') assert.ok(markup.includes('>FB</span>'));
    assert.equal(normalizeBranding(settings).hero_image_url, settings.hero_image_url);
  }
  assert.ok(!heroHighlightMarkup({ hero_title: '', hero_subtitle: '' }).includes('hero-caption'));
});

test('URL pública rejeita scripts e credenciais; blobs só entram na prévia local explícita', () => {
  for (const url of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'http://example.com/a.png', 'https://user:secret@example.com/a.png', 'blob:local', 'file:///tmp/a.png']) {
    assert.equal(safeImageUrl(url), '');
    assert.ok(!heroHighlightMarkup({ hero_mode: 'image', hero_image_url: url }).includes('<img'));
  }
  assert.ok(heroHighlightMarkup({ hero_mode: 'image' }, { previewUrl: 'blob:local-preview' }).includes('src="blob:local-preview"'));
  assert.ok(!heroHighlightMarkup({ hero_mode: 'image' }, { previewUrl: 'javascript:alert(1)' }).includes('<img'));
});

test('upload aceita somente PNG, JPEG e WebP não vazios de até 5 MB', () => {
  const max = 5 * 1024 * 1024;
  for (const type of ['image/png', 'image/jpeg', 'image/webp']) assert.equal(validImageFile({ type, size: max }, max), true);
  for (const file of [{ type: 'image/svg+xml', size: 100 }, { type: 'image/png', size: 0 }, { type: 'image/png', size: max + 1 }, null]) assert.equal(validImageFile(file, max), false);
});
