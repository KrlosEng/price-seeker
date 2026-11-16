import { config } from './config.js';

// ---------- Precios y monedas ----------

/**
 * Convierte un texto de precio en número.
 * "$1.299.900" -> 1299900, "US$1,299.50" -> 1299.5, "19,99 €" -> 19.99
 * Regla: si hay "." y "," el último es el decimal. Si hay un solo tipo de
 * separador seguido de exactamente 3 dígitos (o repetido), es de miles.
 */
export function parsePrice(text) {
  if (text == null) return null;
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  const m = String(text).replace(/\s| /g, '').match(/\d[\d.,]*/);
  if (!m) return null;
  let s = m[0].replace(/[.,]+$/, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot > -1 && lastComma > -1) {
    const dec = Math.max(lastDot, lastComma);
    s = s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1);
  } else if (lastDot > -1 || lastComma > -1) {
    const parts = s.split(lastDot > -1 ? '.' : ',');
    const last = parts[parts.length - 1];
    s = parts.length > 2 || last.length === 3
      ? parts.join('')
      : parts.slice(0, -1).join('') + '.' + last;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Detecta la moneda escrita en un texto. Devuelve null si no es explícita. */
export function detectCurrency(text) {
  if (!text) return null;
  const t = String(text).toUpperCase();
  // Sin \b al final: "COP1.234.567" también cuenta.
  if (/(^|[^A-Z])COP|COL\s?\$/.test(t)) return 'COP';
  if (/(^|[^A-Z])USD|US\s?\$|U\$S/.test(t)) return 'USD';
  if (/€|(^|[^A-Z])EUR/.test(t)) return 'EUR';
  if (/(^|[^A-Z])MXN/.test(t)) return 'MXN';
  return null;
}

/**
 * Decide la moneda real de un precio: primero la explícita, si no la de la
 * tienda. Si la tienda dice USD pero el número es enorme (>= 20.000), casi
 * seguro la página se mostró en pesos por estar en Colombia.
 */
export function resolveCurrency(amount, explicit, storeDefault) {
  if (explicit) return explicit;
  if (storeDefault === 'USD' && amount != null && amount >= 20000) return 'COP';
  return storeDefault;
}

/** Convierte a pesos colombianos. Devuelve null si la moneda no se soporta. */
export function toCOP(amount, currency, usdCop = config.usdCop) {
  if (amount == null) return null;
  if (currency === 'COP') return Math.round(amount);
  if (currency === 'USD') return Math.round(amount * usdCop);
  return null;
}

/** "4.5 de 5 estrellas" -> 4.5, "4,7" -> 4.7. Solo valores entre 0 y 5. */
export function parseRating(text) {
  if (text == null) return null;
  if (typeof text === 'number') return text >= 0 && text <= 5 ? text : null;
  const m = String(text).match(/(\d(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  return n >= 0 && n <= 5 ? n : null;
}

/** "1.234 reseñas" -> 1234, "(2,3 mil)" -> 2300, "1.2K" -> 1200, "10k+ vendidos" -> 10000 */
export function parseCount(text) {
  if (text == null) return null;
  if (typeof text === 'number') return Math.round(text);
  const t = String(text).toLowerCase().replace(/ /g, ' ');
  const m = t.match(/(\d[\d.,]*)\s*(k|mil|m\b|millones)?/);
  if (!m) return null;
  let raw = m[1].replace(/[.,]+$/, '');
  let mult = 1;
  if (m[2] === 'k' || m[2] === 'mil') mult = 1000;
  else if (m[2] === 'm' || m[2] === 'millones') mult = 1_000_000;
  let n;
  if (mult > 1) n = parseFloat(raw.replace(',', '.'));
  else n = parseInt(raw.replace(/[.,]/g, ''), 10);
  return Number.isFinite(n) ? Math.round(n * mult) : null;
}

// ---------- Texto ----------

const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'y', 'o', 'para', 'con', 'sin', 'en', 'por', 'un', 'una', 'al',
  'the', 'for', 'with', 'and', 'of', 'a', 'an', 'to', 'in', 'on', 'by',
  'nuevo', 'nueva', 'new', 'original', 'envio', 'gratis', 'free', 'shipping', 'oferta', 'sale',
  'hot', 'best', 'mejor', 'calidad', 'alta', 'high', 'quality', 'version', 'modelo', 'model',
  '2023', '2024', '2025', '2026', 'unidad', 'pcs', 'pieza',
]);

const UNITS = 'gb|tb|mb|mah|w|mm|cm|m|ml|l|kg|g|hz|mhz|ghz|in|pulgadas|pulg|v|mp|oz|lb|k';

export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/(\d)[.,](\d)/g, '$1_$2') // conserva 6.1 como 6_1
    .replace(new RegExp(`(\\d)\\s+(${UNITS})\\b`, 'g'), '$1$2') // "128 gb" -> "128gb"
    .replace(/[^a-z0-9_]+/g, ' ')
    .trim();
}

/**
 * Quita del título lo que no describe el producto: etiquetas de tienda entre corchetes
 * ("[JudyCube]") y el sufijo de la página ("- AliExpress 26", "| Temu", ": Amazon.com").
 */
export function cleanTitle(title) {
  return String(title || '')
    .replace(/^\s*(\[[^\]]{1,40}\]\s*)+/, '')
    .replace(/\s*\|\s*[^|]{1,40}\|\s*shein[^|]*$/i, '') // "… | Moda de Mujer | SHEIN Colombia"
    .replace(/\s*[-|:]\s*(aliexpress|temu|shein|amazon(\.[a-z.]+)?|mercado ?libre)(\s*\d+)?[^-|:]*$/i, '')
    .trim();
}

/** Palabras útiles de un título, sin repetir, en orden. */
export function tokens(title) {
  const out = [];
  const seen = new Set();
  for (const w of normalize(cleanTitle(title)).split(/\s+/)) {
    if (!w || STOPWORDS.has(w) || (w.length < 2 && !/\d/.test(w)) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

/** Similitud simple por palabras (Jaccard). Se mantiene por compatibilidad. */
export function similarity(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / (A.size + B.size - common);
}

// Especificación con unidad: 128gb, 2_4ghz, 20000mah. No es un código de modelo.
export const UNIT_RE = new RegExp(`^(\\d+(?:_\\d+)?)(${UNITS}|pulgadas|horas|h|hrs|piezas|pzs)$`);

// Códigos que indican compatibilidad o una característica, no el modelo del producto.
const FEATURE_CODES = new Set([
  'ps3', 'ps4', 'ps5', 'xbox360', 'x1', '4k', '8k', '2k', '5g', '4g', '3g', 'wifi6', 'wifi6e', 'wifi7',
  'bt5', 'usb2', 'usb3', 'usb3_0', 'hdmi2', 'hdmi2_1', 'type_c', 'i5', 'i7', 'i9', 'i3', 'm1', 'm2', 'm3', 'm4',
  'a1', 'mp3', 'mp4', 'h264', 'h265', 'ip67', 'ip68', 'ipx4', 'ipx5', 'ipx7', '1080p', '720p', '1440p', '2160p',
  'tws', 'enc', 'anc',
]);

// Medidas tipo 3x3, 4x4x4, 1920x1080: son una especificación, no el modelo.
export const DIM_RE = /^\d+x\d+(x\d+)?$/;

/** ¿Es un código de modelo (l80, s23, 1000xm5)? Letras y dígitos, sin ser unidad, medida ni característica. */
export const isModelCode = (w) => /[a-z]/.test(w) && /\d/.test(w)
  && !UNIT_RE.test(w) && !DIM_RE.test(w) && !FEATURE_CODES.has(w);

/**
 * Códigos de modelo de una lista de palabras, incluyendo los escritos separados:
 * "gan 17" -> gan17 (igual que "Gan17"), "galaxy s23" ya es s23.
 */
export function modelCodes(list) {
  const out = new Set(list.filter(isModelCode));
  for (let i = 0; i < list.length - 1; i++) {
    if (/^[a-z]{2,}$/.test(list[i]) && /^\d{1,4}$/.test(list[i + 1])) {
      const joined = list[i] + list[i + 1];
      if (isModelCode(joined)) out.add(joined);
    }
  }
  return [...out];
}

// Palabras de categoría: si el título empieza con una de ellas, no es la marca.
const GENERIC_FIRST = new Set([
  'auriculares', 'audifonos', 'auricular', 'cascos', 'diadema', 'headset', 'headphones', 'earbuds', 'parlante',
  'altavoz', 'bocina', 'speaker', 'reloj', 'smartwatch', 'teclado', 'keyboard', 'mouse', 'raton', 'cargador',
  'cable', 'funda', 'celular', 'telefono', 'smartphone', 'tablet', 'portatil', 'laptop', 'camara', 'freidora',
  'licuadora', 'aspiradora', 'silla', 'lampara', 'zapatillas', 'tenis', 'mochila', 'monitor', 'control', 'mando',
  'microfono', 'consola', 'juego', 'kit', 'set', 'paquete', 'combo', 'gaming', 'gamer', 'inalambricos', 'inalambrico',
  'wireless', 'bluetooth', 'mini', 'portable', 'portatiles',
]);

/**
 * Marca escrita EN MAYÚSCULAS al inicio del título ("HUEFORM Pantalones…", "ATTACK SHARK L80…").
 * Solo se reconoce en mayúsculas para no confundir palabras comunes con marcas. null si no hay.
 */
export function sourceBrand(title) {
  const raw = cleanTitle(title).split(/[^A-Za-zÀ-ÿ0-9&]+/).filter(Boolean).slice(0, 3);
  for (const w of raw) {
    if (!/^[A-ZÀ-Ý][A-ZÀ-Ý0-9&]{2,}$/.test(w) || !/[A-ZÀ-Ý]{3}/.test(w)) continue;
    const n = normalize(w);
    if (STOPWORDS.has(n) || GENERIC_FIRST.has(n) || isModelCode(n)) continue;
    return n;
  }
  return null;
}

/**
 * Consulta de búsqueda. Si hay código de modelo: marca + modelo + 2 palabras de categoría
 * ("attack shark l80 auriculares inalambricos", "sony wh 1000xm5 auriculares inalambricos").
 * La marca se toma de las palabras EN MAYÚSCULAS justo antes del modelo (ATTACK SHARK L80,
 * WH-1000XM5) o de la primera palabra del título si no es genérica.
 * Sin código: las primeras 7 palabras útiles.
 */
export function buildQuery(title, max = 7) {
  const t = tokens(title);
  if (!t.length) return '';
  const fmt = (q) => q.map((w) => w.replace(/_/g, '.')).join(' ');

  const codes = modelCodes(t);
  if (!codes.length) return fmt(t.slice(0, max));

  // Palabras originales (con mayúsculas) para reconocer la marca.
  const raw = cleanTitle(title)
    .replace(/(\d)[.,](\d)/g, '$1_$2')
    .split(/[^A-Za-zÀ-ÿ0-9_]+/)
    .filter(Boolean);
  const rawNorm = raw.map((w) => normalize(w));

  // El código elegido: el que tenga palabras en mayúsculas antes (suele ser marca + modelo); si no, el más largo.
  const capsBefore = (i) => {
    const out = [];
    for (let j = i - 1; j >= 0 && out.length < 2; j--) {
      const w = raw[j];
      if (/^[A-ZÀ-Ý]{2,}$/.test(w) && !STOPWORDS.has(rawNorm[j])) out.unshift(rawNorm[j]);
      else break;
    }
    return out;
  };
  let best = null;
  for (const c of codes) {
    const i = rawNorm.indexOf(c);
    const brand = i >= 0 ? capsBefore(i) : [];
    const rank = brand.length * 100 + c.length;
    if (!best || rank > best.rank) best = { code: c, brand, rank };
  }

  let code = best.code.replace(/(\d)[a-z]$/, '$1'); // 1000xm5b -> 1000xm5 (letra de color)
  const q = [];
  if (!GENERIC_FIRST.has(t[0]) && !best.brand.includes(t[0]) && t[0] !== best.code) q.push(t[0]);
  q.push(...best.brand);
  // "gan17" / "iphone15": si en el título venían separados, se buscan separados ("gan 17").
  const split = code.match(/^([a-z]+)(\d+)$/);
  if (split && t.includes(split[1])) {
    if (!q.includes(split[1])) q.push(split[1]);
    code = split[2];
  }
  q.push(code);
  // La capacidad (128gb, 1tb) distingue variantes: va en la búsqueda.
  const storage = t.find((w) => /^\d+(gb|tb)$/.test(w));
  if (storage) q.push(storage);
  for (const w of t) {
    if (q.length >= 5) break;
    if (!q.includes(w) && w !== best.code && !/\d/.test(w)) q.push(w);
  }
  return fmt(q);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const jitter = (min = 800, max = 2200) => sleep(min + Math.random() * (max - min));
