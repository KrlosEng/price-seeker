// Reglas de decisión puras (sin navegador ni base de datos), fáciles de probar.
import { config } from './config.js';
import { tokens, UNIT_RE, DIM_RE, isModelCode, modelCodes, sourceBrand } from './util.js';

// Sin marca ni modelo (ropa genérica, típico de Temu) solo se acepta un título casi idéntico…
const GENERIC_MIN_SCORE = 0.8;
// …o la misma foto: huellas a 10 bits o menos de distancia (de 64) son la misma imagen
// reescalada o comprimida. Con foto coincidente basta un título del mismo tipo de producto.
export const IMAGE_MAX_DISTANCE = 10;
const IMAGE_MIN_SCORE = 0.3;

/** ¿Hace falta comparar fotos? Solo cuando el título no trae código de modelo que decida. */
export const needsImageCheck = (title) => modelCodes(tokens(title)).length === 0;

// Palabras que delatan un accesorio "para" el producto y no el producto. Solo cuentan al
// inicio del título ("Almohadillas para Sony XM5"), porque muchos productos las mencionan
// como característica ("con almohadillas de espuma", "incluye cable USB").
const ACCESSORY = new Set([
  'funda', 'fundas', 'case', 'carcasa', 'cover', 'protector', 'mica', 'vidrio', 'templado', 'tempered',
  'glass', 'cable', 'cargador', 'charger', 'adaptador', 'adapter', 'soporte', 'holder', 'estuche',
  'sticker', 'skin', 'correa', 'strap', 'repuesto', 'replacement', 'compatible', 'pelicula', 'film',
  'lamina', 'manga', 'sleeve', 'bolso', 'bag', 'kit', 'almohadillas', 'almohadilla', 'earpads', 'pads',
  'repuestos', 'tapa', 'protectora',
]);

// Estas delatan accesorio en cualquier parte del título.
const STRONG_ACCESSORY = new Set(['compatible', 'replacement', 'repuesto', 'repuestos']);
const ACCESSORY_WINDOW = 5; // primeras palabras útiles del título

const isCode = isModelCode; // l80, s23, 1000xm5 (no ps5, 4k, 2.4ghz)
const isNumber = (t) => /^\d+(?:_\d+)?$/.test(t); // 15, 6_1
// 1000xm5 y 1000xm5b son el mismo modelo (la letra final suele ser el color); 1000xm4 no.
const codeEq = (a, b) => {
  if (a === b) return true;
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.length - short.length === 1 && long.startsWith(short) && /[a-z]$/.test(long) && /\d$/.test(short);
};

// Palabras que marcan una variante de un modelo. Solo cuentan pegadas al modelo
// ("5060 ti", "iphone 15 pro max", "s23 ultra", "5060ti"), no sueltas ("auriculares pro gaming").
const VARIANT_WORDS = new Set(['ti', 'super', 'pro', 'max', 'plus', 'ultra', 'mini', 'lite', 'xl', 'xs', 'slim']);
const VARIANT_SUFFIX = /^([a-z]*\d+)(ti|super|pro|max|plus|ultra|mini|lite|xl)$/;

function variantsOf(list) {
  const out = new Set();
  let afterModel = false;
  for (const t of list) {
    const glued = t.match(VARIANT_SUFFIX);
    if (glued) { out.add(glued[2]); afterModel = true; continue; }
    if (VARIANT_WORDS.has(t) && afterModel) { out.add(t); continue; } // "pro max": la cadena sigue
    afterModel = /\d/.test(t) && !UNIT_RE.test(t) && !DIM_RE.test(t);
  }
  return out;
}

// Un código "letras+número" (gan17, oster4) también cuenta si el título trae ambas partes por separado.
const codeIn = (code, set, codes) => {
  if (codes.some((c) => codeEq(code, c))) return true;
  const m = code.match(/^([a-z]{2,})(\d{1,4})$/);
  return !!m && set.has(m[1]) && set.has(m[2]);
};

// Especificaciones por tipo: { gb: {128}, x: {3x3} }. Los valores se guardan ya legibles.
function unitsByKind(list) {
  const map = new Map();
  const add = (kind, label) => {
    if (!map.has(kind)) map.set(kind, new Set());
    map.get(kind).add(label);
  };
  for (const t of list) {
    if (DIM_RE.test(t)) { add('medida', t); continue; }
    const m = t.match(UNIT_RE);
    if (m) add(m[2], m[1].replace('_', '.') + m[2]);
  }
  return map;
}

/**
 * ¿Es candTitle el mismo producto que srcTitle?
 * Devuelve { ok, score, reason }. Es estricto a propósito: la app solo debe
 * proponer otra tienda cuando vende LO MISMO más barato.
 */
export function matchProduct(srcTitle, candTitle, candPriceCop, srcPriceCop, opts = {}) {
  const minSimilarity = opts.minSimilarity ?? config.minSimilarity;
  const minPriceRatio = opts.minPriceRatio ?? config.minPriceRatio;

  const S = tokens(srcTitle);
  const C = tokens(candTitle);
  if (!S.length || !C.length) return { ok: false, score: 0, reason: 'sin título' };
  const sSet = new Set(S);
  const cSet = new Set(C);

  // 1) Accesorios: la palabra aparece en el resultado pero no en el original.
  const acc = C.find((t, i) => !sSet.has(t)
    && (STRONG_ACCESSORY.has(t) || (ACCESSORY.has(t) && i < ACCESSORY_WINDOW)));
  if (acc) return { ok: false, score: 0, reason: `parece un accesorio ("${acc}")` };

  // 2) Especificaciones con unidad que chocan: 128gb vs 256gb, 20000mah vs 10000mah.
  const sUnits = unitsByKind(S);
  const cUnits = unitsByKind(C);
  for (const [unit, cVals] of cUnits) {
    const sVals = sUnits.get(unit);
    if (!sVals) continue;
    const clash = [...cVals].find((v) => !sVals.has(v));
    if (clash && ![...cVals].some((v) => sVals.has(v))) {
      return { ok: false, score: 0, reason: `otra variante (${clash})` };
    }
  }

  // 3a) Variantes del mismo modelo: 5060 vs 5060 Ti, iPhone 15 vs 15 Pro, S23 vs S23 Ultra.
  const sVar = variantsOf(S);
  const cVar = variantsOf(C);
  const extraVar = [...cVar].find((v) => !sVar.has(v));
  if (extraVar) return { ok: false, score: 0, reason: `otra variante (${extraVar})` };
  const missingVar = [...sVar].find((v) => !cVar.has(v));
  if (missingVar) return { ok: false, score: 0, reason: `otra variante (sin ${missingVar})` };

  // 3) Códigos de modelo (s23, gan17, wh1000xm5). Si el original tiene modelo, el resultado
  //    debe nombrar ese mismo modelo: ni otro (GAN V100 vs GAN 17) ni ninguno (cubo genérico).
  const sCodes = modelCodes(S);
  const cCodes = modelCodes(C);
  const sharedCode = sCodes.some((s) => codeIn(s, cSet, cCodes)) || cCodes.some((c) => codeIn(c, sSet, sCodes));
  if (sCodes.length && !sharedCode) {
    return {
      ok: false,
      score: 0,
      // El código más largo suele ser el modelo completo (rtx3060 antes que v1).
      reason: cCodes.length
        ? `otro modelo (${[...cCodes].sort((a, b) => b.length - a.length)[0]})`
        : `no menciona el modelo (${sCodes[0]})`,
    };
  }

  // 3b) Sin código de modelo: la marca es lo único que identifica el producto (ropa, hogar).
  //     Si el original tiene marca (HUEFORM), el resultado debe tenerla; si no tiene ninguna,
  //     solo se acepta un título casi idéntico (ver el paso 5).
  //     Una foto idéntica también confirma, aunque el vendedor no ponga la marca en el título.
  const imageDistance = opts.imageDistance ?? null;
  const imageMatch = imageDistance != null && imageDistance <= IMAGE_MAX_DISTANCE;
  let genericOnly = false;
  if (!sCodes.length) {
    const brand = sourceBrand(srcTitle);
    if (brand && !cSet.has(brand) && !imageMatch) {
      return { ok: false, score: 0, reason: `otra marca (no dice ${brand.toUpperCase()})` };
    }
    genericOnly = !brand;
  }

  // 4) Números sueltos (iPhone 15 vs 14): solo si no hay códigos de modelo que decidan,
  //    porque en títulos largos los números suelen ser otra cosa (30 horas, 2 piezas).
  const sNums = S.filter(isNumber);
  const cNums = C.filter(isNumber);
  if (!sharedCode && sNums.length && cNums.length && !cNums.some((t) => sSet.has(t))) {
    return { ok: false, score: 0, reason: `otro modelo (${cNums[0].replace('_', '.')})` };
  }

  // 5) Parecido de palabras: promedio de Dice y coeficiente de solapamiento.
  // La descripción del original (si llegó con el botón) también cuenta como palabras del producto.
  const extra = new Set(opts.srcExtra ? tokens(opts.srcExtra) : []);
  let common = 0;
  for (const t of cSet) {
    if (sSet.has(t) || extra.has(t) || (isCode(t) && sCodes.some((s) => codeEq(s, t)))) common++;
  }
  const dice = (2 * common) / (sSet.size + cSet.size);
  const overlap = common / Math.min(sSet.size, cSet.size);
  let score = (dice + overlap) / 2;
  // Compartir el código de modelo es la señal más fuerte de que es el mismo producto.
  if (sharedCode) score = Math.min(1, score + 0.2);
  // Le falta una especificación del original (128GB, 20000mAh): podría ser otra variante.
  const missingSpecs = [...sUnits.keys()].filter((u) => !cUnits.has(u)).length;
  score -= Math.min(0.4, missingSpecs * 0.2);
  score = Math.round(score * 100) / 100;
  if (imageMatch) {
    // Misma foto: basta con que el título sea del mismo tipo de producto (evita fotos de catálogo reutilizadas).
    if (score < IMAGE_MIN_SCORE) return { ok: false, score, reason: 'misma foto, pero el título es de otro producto' };
  } else {
    if (score < minSimilarity) return { ok: false, score, reason: 'poco parecido' };
    if (genericOnly && score < GENERIC_MIN_SCORE) {
      return {
        ok: false,
        score,
        reason: imageDistance != null
          ? 'sin marca ni modelo y la foto no coincide'
          : 'sin marca ni modelo: no puedo confirmar que sea el mismo',
      };
    }
  }

  // 6) Precio sospechosamente bajo: casi seguro es otra cosa.
  if (candPriceCop != null && srcPriceCop != null && candPriceCop < srcPriceCop * minPriceRatio) {
    return { ok: false, score, reason: 'demasiado barato para ser el mismo' };
  }

  return { ok: true, score, reason: null, imageMatch };
}

/**
 * Entre los resultados de una tienda elige el que es el mismo producto.
 * Entre los que son claramente el mismo producto (a 0.15 o menos del más parecido),
 * gana el más barato, prefiriendo los que tienen rating confiable.
 * results: [{ title, url, priceCop, rating, reviews }]
 */
export function chooseMatch(srcTitle, srcPriceCop, results, opts = {}) {
  const evaluated = results
    .filter((r) => r && r.title && r.url)
    .map((r) => ({
      ...r,
      ...matchProduct(srcTitle, r.title, r.priceCop, srcPriceCop, { ...opts, imageDistance: r.imageDistance }),
      imageMatch: r.imageDistance != null && r.imageDistance <= IMAGE_MAX_DISTANCE,
    }));
  const ok = evaluated.filter((r) => r.ok && r.priceCop != null).sort((a, b) => b.score - a.score);
  if (!ok.length) {
    const closest = [...evaluated].sort((a, b) => b.score - a.score)[0] || null;
    return { chosen: null, closest, evaluated, matches: [] };
  }
  const top = ok[0].score;
  const same = ok.filter((r) => r.score >= top - 0.15);
  const cheapest = (list) => [...list].sort((a, b) => a.priceCop - b.priceCop)[0];
  const qualified = same.filter((r) => isQualified(r, opts));
  const chosen = cheapest(qualified.length ? qualified : same);
  // Todas las publicaciones que pasaron el filtro de "mismo producto", sin repetir, de la más barata a la más cara.
  const seen = new Set();
  const matches = [...ok]
    .sort((a, b) => a.priceCop - b.priceCop)
    .filter((r) => !seen.has(r.url) && seen.add(r.url));
  return { chosen, closest: chosen, evaluated, matches };
}

/**
 * Barra de búsqueda: separa los resultados en exactos y similares.
 * - Con modelo, número o marca en la búsqueda ("rtx 5060 8gb"): exacto = pasa las reglas de
 *   "mismo producto"; similar = misma categoría pero otra variante o modelo (con el motivo).
 * - Solo descripción ("audifonos inalambricos con cancelacion de ruido"): exacto = contiene casi
 *   todas tus palabras (o tiene la misma foto); similar = contiene parte de ellas.
 * results: [{ title, url, priceCop, rating, reviews, store, image, imageDistance? }]
 */
export function classifySearch(query, results, opts = {}) {
  const Q = tokens(query);
  if (!Q.length) return { mode: 'descripcion', exact: [], similar: [] };
  const qSet = new Set(Q);
  const hasModel = modelCodes(Q).length > 0 || Q.some(isNumber) || !!sourceBrand(query);
  const exact = [];
  const similar = [];
  const seen = new Set();

  for (const r of results) {
    if (!r || !r.title || !r.url || seen.has(r.url)) continue;
    seen.add(r.url);
    const C = tokens(r.title);
    const cSet = new Set(C);
    // Accesorios fuera, salvo que los estés buscando ("funda iphone 15").
    const acc = C.find((t, i) => !qSet.has(t)
      && (STRONG_ACCESSORY.has(t) || (ACCESSORY.has(t) && i < ACCESSORY_WINDOW)));
    if (acc) continue;

    // Qué parte de tu búsqueda aparece en el título ("5060" cuenta dentro de "5060ti").
    const hit = (t) => cSet.has(t) || (t.length >= 3 && C.some((c) => c.startsWith(t)));
    const coverage = Math.round((Q.filter(hit).length / Q.length) * 100) / 100;
    const imageMatch = r.imageDistance != null && r.imageDistance <= IMAGE_MAX_DISTANCE;

    let isExact;
    let reason = null;
    if (hasModel) {
      const m = matchProduct(query, r.title, null, null, { ...opts, imageDistance: r.imageDistance });
      isExact = m.ok;
      reason = m.ok ? null : m.reason;
    } else {
      isExact = coverage >= 0.75 || (imageMatch && coverage >= IMAGE_MIN_SCORE);
      if (!isExact) reason = 'parecido a tu descripción';
    }

    const item = { ...r, coverage, imageMatch, reason };
    if (isExact) exact.push(item);
    else if (coverage >= 0.3 || imageMatch) similar.push(item);
  }

  const byPrice = (a, b) => (a.priceCop ?? Infinity) - (b.priceCop ?? Infinity);
  exact.sort(byPrice);
  similar.sort((a, b) => b.coverage - a.coverage || byPrice(a, b));
  return { mode: hasModel ? 'modelo' : 'descripcion', exact, similar };
}

export function isQualified(offer, opts = {}) {
  const minRating = opts.minRating ?? config.minRating;
  const minReviews = opts.minReviews ?? config.minReviews;
  return offer.rating != null && offer.rating >= minRating
    && offer.reviews != null && offer.reviews >= minReviews;
}

/**
 * Mejor opción para comprar: el mismo producto, en otra tienda, con rating
 * confiable y más barato que el link original. Si no existe, el original.
 * source: { store, priceCop }, offers: [{ store, priceCop, matched, rating, reviews }]
 */
export function pickBest(source, offers, opts = {}) {
  let bestAlt = null;
  for (const o of offers) {
    if (!o.matched || o.priceCop == null || !isQualified(o, opts)) continue;
    if (!bestAlt || o.priceCop < bestAlt.priceCop) bestAlt = o;
  }
  if (bestAlt && (source.priceCop == null || bestAlt.priceCop < source.priceCop)) {
    return { best: bestAlt, fromSource: false };
  }
  return { best: source, fromSource: true };
}

/**
 * ¿Hay que mandar correo?
 * - Con precio objetivo: cuando metric <= objetivo, sin repetir salvo nueva baja de realertPct.
 * - Sin objetivo: cuando metric baja dropPct% frente a la referencia, que es el
 *   precio de la última alerta o, si nunca se avisó, el primer precio medido.
 *   Así las bajadas lentas se acumulan y sí terminan avisando.
 */
export function decideAlert({ metric, target, lastAlerted, baseline }, opts = {}) {
  const dropPct = opts.dropPct ?? config.dropPct;
  const realertPct = opts.realertPct ?? config.realertPct;
  if (metric == null) return { send: false };

  if (target != null) {
    if (metric > target) return { send: false };
    if (lastAlerted != null && metric > lastAlerted * (1 - realertPct / 100)) return { send: false };
    return { send: true, reason: 'target' };
  }

  const ref = lastAlerted ?? baseline;
  if (ref == null) return { send: false };
  if (metric <= ref * (1 - dropPct / 100)) return { send: true, reason: 'drop', reference: ref };
  return { send: false };
}
