import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice, parseCount, parseRating, detectCurrency, resolveCurrency, toCOP, buildQuery, cleanTitle } from '../src/util.js';
import { matchProduct, chooseMatch, pickBest, decideAlert } from '../src/rules.js';

const OPTS = { minSimilarity: 0.45, minPriceRatio: 0.4, minRating: 4, minReviews: 20, dropPct: 3, realertPct: 2 };

test('parsePrice entiende formatos COP y USD', () => {
  assert.equal(parsePrice('$1.299.900'), 1299900);
  assert.equal(parsePrice('US$1,299.50'), 1299.5);
  assert.equal(parsePrice('$ 19,99'), 19.99);
  assert.equal(parsePrice('COP 450.000'), 450000);
  assert.equal(parsePrice('$1,299'), 1299);
  assert.equal(parsePrice('sin precio'), null);
});

test('moneda: explícita, por tienda, o pesos si el número es enorme', () => {
  assert.equal(detectCurrency('COP1.234.567'), 'COP');
  assert.equal(detectCurrency('US $12.99'), 'USD');
  assert.equal(detectCurrency('$12.99'), null);
  assert.equal(resolveCurrency(12.99, null, 'USD'), 'USD');
  assert.equal(resolveCurrency(459900, null, 'USD'), 'COP'); // AliExpress mostrando pesos
  assert.equal(toCOP(10, 'USD', 4000), 40000);
  assert.equal(toCOP(10, 'EUR', 4000), null);
});

test('rating y reseñas', () => {
  assert.equal(parseRating('4,7 de 5 estrellas'), 4.7);
  assert.equal(parseCount('(2,3 mil)'), 2300);
  assert.equal(parseCount('1.234 calificaciones'), 1234);
  assert.equal(parseCount('10K+ vendidos'), 10000);
});

test('buildQuery conserva el modelo', () => {
  const q = buildQuery('Apple iPhone 15 de 128 GB - Negro, nuevo con garantía oficial Apple Colombia');
  assert.match(q, /iphone/);
  assert.match(q, /15/);
  assert.match(q, /128gb/);
});

const SRC = 'Apple iPhone 15 (128 GB) - Negro';

test('mismo producto con otro título: se acepta', () => {
  const r = matchProduct(SRC, 'iPhone 15 128GB Negro Apple Nuevo', 3_900_000, 4_200_000, OPTS);
  assert.equal(r.ok, true, r.reason);
});

test('funda para el mismo modelo: se descarta', () => {
  const r = matchProduct(SRC, 'Funda Silicona Para iPhone 15 Negro', 3_900_000, 4_200_000, OPTS);
  assert.equal(r.ok, false);
  assert.match(r.reason, /accesorio/);
});

test('otra capacidad: se descarta', () => {
  const r = matchProduct(SRC, 'Apple iPhone 15 256GB Negro', 3_900_000, 4_200_000, OPTS);
  assert.equal(r.ok, false);
  assert.match(r.reason, /variante/);
});

test('otro modelo: se descarta', () => {
  const r = matchProduct(SRC, 'Apple iPhone 14 128GB Negro', 3_000_000, 4_200_000, OPTS);
  assert.equal(r.ok, false);
  assert.match(r.reason, /modelo/);
});

test('códigos de modelo distintos: se descarta', () => {
  const r = matchProduct('Sony WH-1000XM5 audífonos', 'Sony WH-1000XM4 audífonos', 900_000, 1_400_000, OPTS);
  assert.equal(r.ok, false);
});

// Caso real: título largo de Amazon vs título corto de AliExpress.
const AMZ = 'Sony Auriculares inalámbricos con cancelación de ruido - Batería de 30 horas de duración - Estilo sobre la oreja - Optimizado para Alexa y Google Assistant - Micrófono integrado para llamadas - WH-1000XM5B.CE7 - Edición limitada - Negro carbón';

test('caso real Amazon → AliExpress: XM5B y XM5 son el mismo', () => {
  const r = matchProduct(AMZ, 'Auriculares Sony WH-1000XM5, inalámbricos, con cancelación de ruido, 40 horas', 903_209, 990_552, OPTS);
  assert.equal(r.ok, true, r.reason);
});

test('caso real: XM4 sigue siendo otro modelo', () => {
  const r = matchProduct(AMZ, 'Sony WH-1000XM4 Auriculares inalámbricos cancelación de ruido', 700_000, 990_552, OPTS);
  assert.equal(r.ok, false);
});

test('caso real: almohadillas para XM5 se descartan', () => {
  const r = matchProduct(AMZ, 'Sony WH-1000XM5 Almohadillas de malla transpirable', 31_375, 990_552, OPTS);
  assert.equal(r.ok, false);
});

test('buildQuery pone la marca y el modelo primero', () => {
  assert.match(buildQuery(AMZ), /^sony wh 1000xm5 /);
});

// Caso real: ATTACK SHARK L80 de AliExpress buscado en Amazon.
const L80_ALI = 'Auriculares Inalámbricos para Juegos ATTACK SHARK L80, Auriculares para Juegos USB de 2.4 GHz con Bluetooth 5.2, Batería de 50 Horas, Micrófono con Cancelación de Ruido';
const L80_AMZ = 'ATTACK SHARK L80 Auriculares inalámbricos para juegos, auriculares USB de 2.4 GHz para juegos con Bluetooth 5.2, batería de 50 horas, micrófono con cancelación de ruido, cable de 0.138 in, auriculares inalámbricos para PC, Nintendo Switch, PS5, PS4, Mac (negro)';
const AOC = 'AOC Auriculares inalámbricos para juegos de 2.4 GHz para PS5, PS4, PC';

test('L80: la búsqueda lleva marca y modelo, no "2.4ghz"', () => {
  assert.equal(buildQuery(L80_ALI), 'attack shark l80 auriculares inalambricos');
});

test('L80: el mismo producto en Amazon se acepta (aunque mencione PS5 y cable)', () => {
  const r = matchProduct(L80_ALI, L80_AMZ, 109_659, 119_868, OPTS);
  assert.equal(r.ok, true, r.reason);
});

test('L80: el AOC genérico se descarta', () => {
  const r = matchProduct(L80_ALI, AOC, 166_167, 119_868, OPTS);
  assert.equal(r.ok, false);
});

test('chooseMatch devuelve todas las publicaciones del mismo producto, de la más barata a la más cara', () => {
  const { matches } = chooseMatch(L80_ALI, 119_868, [
    { title: AOC, url: 'aoc', priceCop: 166_167 },
    { title: L80_AMZ, url: 'l80-b', priceCop: 125_000, rating: 4.5, reviews: 300 },
    { title: 'ATTACK SHARK L80 Auriculares inalámbricos para juegos 2.4 GHz', url: 'l80-a', priceCop: 109_659 },
    { title: L80_AMZ, url: 'l80-b', priceCop: 125_000 }, // repetida
    { title: 'ATTACK SHARK L90 Auriculares inalámbricos', url: 'l90', priceCop: 93_737 },
  ], OPTS);
  assert.deepEqual(matches.map((m) => m.url), ['l80-a', 'l80-b']);
});

test('L80: con ambos resultados gana el L80 de Amazon', () => {
  const { chosen } = chooseMatch(L80_ALI, 119_868, [
    { title: AOC, url: 'aoc', priceCop: 166_167, rating: 4.5, reviews: 1870 },
    { title: L80_AMZ, url: 'l80', priceCop: 109_659, rating: 4.1, reviews: 54 },
  ], OPTS);
  assert.equal(chosen?.url, 'l80');
});

test('mencionar "almohadillas" como característica no lo vuelve accesorio', () => {
  const r = matchProduct(
    'Razer BlackShark V2 X Auriculares para juegos',
    'Razer BlackShark V2 X Auriculares para juegos sonido envolvente 7.1 controladores de 50 mm almohadillas de espuma',
    150_000, 160_000, OPTS,
  );
  assert.equal(r.ok, true, r.reason);
});

// Caso real: GAN 17 MagDrive de AliExpress vs GAN V100 en Amazon.
const GAN17 = '[JudyCube] GAN 17 MagDrive UV 3x3 Cubo Mágico Magnético Gan17 Nuevo Cubo Profesional sin Adhesivos Juguetes Antiestrés Cubo Mágico - AliExpress 26';

test('GAN 17: el GAN V100 es otro modelo aunque ambos digan 3x3', () => {
  const r = matchProduct(GAN17, 'GAN V100 Maglev esmerilado, cubo de velocidad 3x3 regalo magnético para', 116_307, 268_889, OPTS);
  assert.equal(r.ok, false);
  assert.match(r.reason, /otro modelo/);
});

test('GAN 17: "GAN 17 MagDrive" escrito distinto sí es el mismo', () => {
  const r = matchProduct(GAN17, 'GAN 17 MagDrive UV Cubo de velocidad magnético 3x3 sin pegatinas', 230_000, 268_889, OPTS);
  assert.equal(r.ok, true, r.reason);
});

test('GAN 17: un cubo sin modelo se descarta', () => {
  const r = matchProduct(GAN17, 'Cubo mágico magnético 3x3 profesional sin adhesivos', 200_000, 268_889, OPTS);
  assert.equal(r.ok, false);
  assert.match(r.reason, /no menciona el modelo/);
});

test('medidas distintas son otra variante: 3x3 vs 4x4', () => {
  const r = matchProduct(GAN17, 'GAN 17 MagDrive 4x4 cubo magnético', 230_000, 268_889, OPTS);
  assert.equal(r.ok, false);
  assert.match(r.reason, /variante \(4x4\)/);
});

test('el título se limpia: sin [tienda] ni "- AliExpress 26"', () => {
  assert.equal(buildQuery(GAN17), 'gan 17 magdrive uv cubo');
});

test('modelo escrito separado: "Oster 4 litros" coincide con "Oster Digital 4 Litros"', () => {
  const r = matchProduct('Freidora de aire Oster 4 litros', 'Freidora de Aire Oster Digital 4 Litros Negra', 300_000, 320_000, OPTS);
  assert.equal(r.ok, true, r.reason);
});

// Caso real: pantalones HUEFORM de Shein (ropa: tiene marca pero no código de modelo).
const HUEFORM = 'HUEFORM Pantalones de traje marrón café para hombre, pantalones rectos holgados casuales';

test('ropa con marca: otra marca se descarta', () => {
  const r = matchProduct(HUEFORM, 'JMIERR Pantalones de traje elásticos ajustados para hombre', 109_659, 89_900, OPTS);
  assert.equal(r.ok, false);
  assert.match(r.reason, /otra marca/);
});

test('ropa con marca: genérico sin la marca se descarta', () => {
  const r = matchProduct(HUEFORM, 'Pantalones rectos holgados para hombre, pantalón informal de algodón', 66_205, 89_900, OPTS);
  assert.equal(r.ok, false);
});

test('ropa con marca: la misma marca y prenda se acepta', () => {
  const r = matchProduct(HUEFORM, 'HUEFORM Pantalones de traje para hombre marrón café rectos holgados', 80_000, 89_900, OPTS);
  assert.equal(r.ok, true, r.reason);
});

test('sin marca ni modelo: un título parecido pero distinto se descarta', () => {
  const r = matchProduct('pantalones de verano con cordón en la cintura pierna ancha casuales',
    'Pantalones rectos holgados para hombre de verano', 40_000, 50_000, OPTS);
  assert.equal(r.ok, false);
});

// Producto genérico de Temu (sin marca ni modelo): la foto decide.
const DOMINADAS = 'Barra de dominadas ajustable de alta resistencia para montaje en puerta sin taladro, gimnasio en casa';
const DOMINADAS_AMZ = 'Barra de dominadas para puerta, barra de ejercicio sin tornillos, ajustable, para gimnasio en casa';

test('sin marca: misma foto y mismo tipo de producto se acepta', () => {
  const r = matchProduct(DOMINADAS, DOMINADAS_AMZ, 80_000, 91_954, { ...OPTS, imageDistance: 4 });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.imageMatch, true);
});

test('sin marca: foto distinta se descarta', () => {
  const r = matchProduct(DOMINADAS, DOMINADAS_AMZ, 80_000, 91_954, { ...OPTS, imageDistance: 30 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /foto no coincide/);
});

test('misma foto pero otro producto (foto de catálogo reutilizada) se descarta', () => {
  const r = matchProduct(DOMINADAS, 'Bandas elásticas de resistencia set de 5 para yoga', 30_000, 91_954, { ...OPTS, imageDistance: 2 });
  assert.equal(r.ok, false);
});

test('con marca: la misma foto confirma aunque el vendedor no ponga la marca', () => {
  const r = matchProduct(HUEFORM, 'Pantalones de traje marrón café para hombre rectos holgados casuales', 80_000, 89_900, { ...OPTS, imageDistance: 6 });
  assert.equal(r.ok, true, r.reason);
});

test('la foto no cambia nada cuando hay código de modelo', () => {
  const r = matchProduct(GAN17, 'GAN V100 Maglev esmerilado cubo 3x3', 116_307, 268_889, { ...OPTS, imageDistance: 0 });
  assert.equal(r.ok, false);
});

test('limpieza de títulos de Shein y Temu', () => {
  assert.equal(
    cleanTitle('HUEFORM Pantalones de traje marrón café para hombre | Moda de Mujer | SHEIN Colombia'),
    'HUEFORM Pantalones de traje marrón café para hombre',
  );
  assert.equal(cleanTitle('pantalones verano cordón cintura - Temu Colombia'), 'pantalones verano cordón cintura');
});

test('precio absurdamente bajo: se descarta', () => {
  const r = matchProduct(SRC, 'Apple iPhone 15 128GB Negro', 500_000, 4_200_000, OPTS);
  assert.equal(r.ok, false);
  assert.match(r.reason, /barato/);
});

test('chooseMatch: entre publicaciones del mismo producto gana la más barata', () => {
  const { chosen } = chooseMatch(AMZ, 990_552, [
    { title: 'Audífonos Sony WH-1000XM5 Cancelación de Ruido Premium', url: 'a', priceCop: 1_183_948 },
    { title: 'Auriculares Sony WH-1000XM5, inalámbricos, con cancelación de ruido', url: 'b', priceCop: 903_209 },
    { title: 'Sony WH-1000XM5 Almohadillas de repuesto', url: 'c', priceCop: 31_000 },
  ], OPTS);
  assert.equal(chosen.url, 'b');
});

test('chooseMatch no elige una publicación sin la capacidad del original', () => {
  const { chosen } = chooseMatch(SRC, 4_200_000, [
    { title: 'Funda iPhone 15', url: 'u1', priceCop: 40_000 },
    { title: 'iPhone 15 128GB Negro Apple', url: 'u2', priceCop: 3_950_000 },
    { title: 'iPhone 15 Negro', url: 'u3', priceCop: 3_100_000 },
  ], OPTS);
  assert.equal(chosen.url, 'u2');
});

test('pickBest: otra tienda solo si es el mismo, confiable y más barato', () => {
  const source = { store: 'amazon', priceCop: 4_200_000 };
  const offers = [
    { store: 'temu', priceCop: 3_000_000, matched: true, rating: 3.5, reviews: 5 },          // no confiable
    { store: 'aliexpress', priceCop: 2_000_000, matched: false, rating: 4.9, reviews: 900 }, // no es el mismo
    { store: 'mercadolibre', priceCop: 3_900_000, matched: true, rating: 4.8, reviews: 320 },
  ];
  const r = pickBest(source, offers, OPTS);
  assert.equal(r.fromSource, false);
  assert.equal(r.best.store, 'mercadolibre');

  const none = pickBest(source, offers.slice(0, 2), OPTS);
  assert.equal(none.fromSource, true);
});

test('alerta sin objetivo: bajadas lentas se acumulan', () => {
  assert.equal(decideAlert({ metric: 100, baseline: null }, OPTS).send, false);
  assert.equal(decideAlert({ metric: 98, baseline: 100 }, OPTS).send, false);
  assert.equal(decideAlert({ metric: 96, baseline: 100 }, OPTS).send, true);
  assert.equal(decideAlert({ metric: 95, baseline: 100, lastAlerted: 96 }, OPTS).send, false);
  assert.equal(decideAlert({ metric: 93, baseline: 100, lastAlerted: 96 }, OPTS).send, true);
});

test('alerta con objetivo: avisa al llegar y no repite salvo nueva baja', () => {
  assert.equal(decideAlert({ metric: 110, target: 100 }, OPTS).send, false);
  assert.equal(decideAlert({ metric: 100, target: 100 }, OPTS).send, true);
  assert.equal(decideAlert({ metric: 99, target: 100, lastAlerted: 100 }, OPTS).send, false);
  assert.equal(decideAlert({ metric: 97, target: 100, lastAlerted: 100 }, OPTS).send, true);
});
