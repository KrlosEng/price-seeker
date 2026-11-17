// Price Seeker — © 2026 Carlos David Aguirre Angulo — https://github.com/KrlosEng/price-seeker
// Licencia PolyForm Noncommercial 1.0.0 (ver LICENSE): uso no comercial; conserva este aviso. Huella PS-CDAA-2026-42dcad1c
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const ml = await import('../src/mlApi.js');

test('idsFromUrl: publicación normal', () => {
  const r = ml.idsFromUrl('https://articulo.mercadolibre.com.co/MCO-1234567890-audifonos-sony-wh-1000xm5-_JM');
  assert.deepEqual(r, { itemId: 'MCO1234567890', productId: null });
});

test('idsFromUrl: producto de catálogo con item en la URL', () => {
  const r = ml.idsFromUrl('https://www.mercadolibre.com.co/sony-wh-1000xm5/p/MCO19615305?item_id=MCO-987654321');
  assert.equal(r.productId, 'MCO19615305');
  assert.equal(r.itemId, 'MCO987654321');
});

test('idsFromUrl: producto de catálogo solo', () => {
  const r = ml.idsFromUrl('https://www.mercadolibre.com.co/sony-wh-1000xm5/p/MCO19615305');
  assert.deepEqual(r, { itemId: null, productId: 'MCO19615305' });
});

test('parseCodeInput acepta la URL completa o solo el código', () => {
  assert.deepEqual(ml.parseCodeInput('https://localhost:3000/api/ml/callback?code=TG-abc&state=xyz'), { code: 'TG-abc', state: 'xyz' });
  assert.deepEqual(ml.parseCodeInput('  TG-abc  '), { code: 'TG-abc', state: null });
});

test('sin credenciales: no configurado ni conectado', () => {
  const s = ml.status();
  assert.equal(s.connected, false);
  assert.throws(() => ml.authUrl(), /ML_CLIENT_ID/);
});
