import { config } from './config.js';
import { db, tx, now } from './db.js';
import { withPage } from './browser.js';
import { STORES, storeFor, storeById } from './stores/index.js';
import { gotoSoft, assertNotBlocked } from './stores/common.js';
import { parsePrice, parseRating, parseCount, detectCurrency, resolveCurrency, toCOP, buildQuery, jitter } from './util.js';
import { chooseMatch, isQualified, pickBest, decideAlert, needsImageCheck, classifySearch } from './rules.js';
import { hashImages, hamming } from './imageHash.js';
import { sendPriceAlert } from './notify.js';

export class UserError extends Error {}

/** Lee un link de producto y devuelve su título, imagen y precio en COP. */
export async function scrapeLink(url) {
  const store = storeFor(url);
  if (!store) throw new UserError('Tienda no soportada. Usa Amazon, Mercado Libre, AliExpress, Temu o Shein.');
  if (store.manualOnly) {
    throw new UserError(`${store.name} bloquea la lectura automática. Abre el producto en tu navegador y usa el botón "Enviar a Price Seeker".`);
  }
  const read = store.api?.available()
    ? () => store.api.product(url) // API oficial: sin navegador
    : () => withPage(async (page) => {
      await gotoSoft(page, url);
      await assertNotBlocked(page, store.name);
      return store.product(page, url);
    });
  const p = await read();
  {
    if (!p?.title) throw new Error(`No pude leer el título en ${store.name}`);
    if (p.price == null) throw new Error(`No pude leer el precio en ${store.name}`);
    const currency = resolveCurrency(p.price, p.currency, store.currency);
    const priceCop = toCOP(p.price, currency);
    if (priceCop == null) throw new Error(`Moneda no soportada (${currency}) en ${store.name}`);
    return {
      store: store.id,
      url,
      title: p.title.trim(),
      image: p.image || null,
      priceCop,
      rating: p.rating ?? null,
      reviews: p.reviews ?? null,
    };
  }
}

/** Busca un texto en una tienda y devuelve los resultados con precio en COP, rating y reseñas. */
async function fetchStoreResults(store, query) {
  const raw = store.api?.available()
    ? (await store.api.search(query)) || []
    : await withPage(async (page) => (await store.search(page, query)) || []);
  return raw.map((r) => {
    const price = parsePrice(r.priceText);
    const currency = resolveCurrency(price, detectCurrency(r.priceText), store.currency);
    return {
      store: store.id,
      title: r.title,
      url: r.url,
      image: r.image || null,
      priceCop: toCOP(price, currency),
      rating: parseRating(r.ratingText),
      reviews: parseCount(r.reviewsText),
    };
  });
}

/** Compara la foto de referencia con la de cada resultado y guarda la distancia (r.imageDistance). */
async function addImageDistances(store, refImage, results) {
  try {
    const urls = [refImage, ...results.map((r) => r.image).filter(Boolean)];
    const hashes = await hashImages(urls);
    const refHash = hashes.get(refImage);
    if (refHash) for (const r of results) r.imageDistance = hamming(refHash, hashes.get(r.image));
  } catch (e) {
    console.warn(`[${store.id}] no se pudieron comparar las fotos: ${e.message}`);
  }
}

/**
 * Barra de búsqueda: busca el texto en todas las tiendas automáticas y separa
 * los resultados en exactos y similares (ver classifySearch en rules.js).
 * image (opcional): link o recorte para confirmar por foto.
 */
export async function searchProducts(query, { image = null } = {}) {
  const all = [];
  const errors = {};
  const searched = [];
  for (const store of STORES) {
    if (store.manualOnly || (store.searchEnabled && !store.searchEnabled())) continue;
    searched.push(store.id);
    try {
      const results = await fetchStoreResults(store, query);
      if (image) await addImageDistances(store, image, results);
      all.push(...results);
    } catch (e) {
      errors[store.id] = e.message || String(e);
      console.warn(`[búsqueda ${store.id}] falló: ${errors[store.id]}`);
    }
    await jitter(500, 1200);
  }
  const r = classifySearch(query, all.map((x) => ({ ...x, qualified: isQualified(x) })));
  return { query, ...r, searched, errors };
}

/** Busca el mismo producto en una tienda y devuelve la mejor coincidencia (o la más cercana descartada). */
async function searchStore(store, source) {
  const query = buildQuery(source.title);
  const results = await fetchStoreResults(store, query);

  // Sin código de modelo, la foto ayuda a confirmar que es el mismo producto (ver rules.js).
  if (source.image && needsImageCheck(source.title)) await addImageDistances(store, source.image, results);

  const { evaluated, matches } = chooseMatch(source.title, source.priceCop, results, { srcExtra: source.description });
  if (!evaluated.length) return [];
  if (!matches.length) {
    // Ninguno es el mismo producto: se guarda solo como constancia, sin precio ni link útil.
    return [{
      store: store.id,
      title: `Revisé ${evaluated.length} resultados y ninguno es el mismo producto`,
      url: null,
      image: null,
      priceCop: null,
      rating: null,
      reviews: null,
      similarity: null,
      matched: false,
      rejectReason: `búsqueda: "${query}"`,
    }];
  }
  return matches.slice(0, Math.max(1, config.offersPerStore)).map((m) => ({
    store: store.id,
    title: m.title,
    url: m.url,
    image: m.image,
    priceCop: m.priceCop,
    rating: m.rating,
    reviews: m.reviews,
    similarity: m.score,
    matched: true,
    imageMatch: !!m.imageMatch,
    rejectReason: null,
  }));
}

/** Busca en todas las tiendas menos la del link. Una tienda que falla no tumba las demás. */
export async function searchOtherStores(source) {
  const offers = [];
  const errors = {};
  for (const store of STORES) {
    if (store.id === source.store || store.manualOnly) continue; // Temu y Shein no se buscan solas
    if (store.searchEnabled && !store.searchEnabled()) continue; // p. ej. Mercado Libre sin API conectada
    try {
      const found = await searchStore(store, source);
      if (found.length) offers.push(...found);
      else errors[store.id] = 'sin resultados';
    } catch (e) {
      errors[store.id] = e.message || String(e);
      console.warn(`[${store.id}] búsqueda falló: ${errors[store.id]}`);
    }
    await jitter();
  }
  return { offers, errors };
}

const getProduct = (id) => db.prepare('SELECT * FROM products WHERE id = ?').get(id);

/**
 * Revisa un producto: lee el link, busca en las otras tiendas, guarda, decide y avisa.
 * prefetched: resultado de scrapeLink si ya se leyó (al crear el producto).
 */
export async function refreshProduct(id, prefetched = null) {
  const product = getProduct(id);
  if (!product) return;
  const checkedAt = now();

  let source;
  try {
    source = prefetched
      || (product.manual
        // Producto enviado con el botón: su precio es el último que enviaste; las otras tiendas sí se buscan.
        ? {
          store: product.store,
          url: product.url,
          title: product.title,
          image: product.image,
          priceCop: product.source_price,
          rating: product.source_rating,
          reviews: product.source_reviews,
          description: product.description,
        }
        : await scrapeLink(product.url));
  } catch (e) {
    db.prepare('UPDATE products SET last_error = ?, last_checked = ? WHERE id = ?')
      .run(e.message || String(e), checkedAt, id);
    console.warn(`[producto ${id}] no se pudo leer: ${e.message}`);
    return;
  }

  const { offers, errors } = await searchOtherStores(source);
  for (const o of offers) o.qualified = o.matched && isQualified(o);

  const { best, fromSource } = pickBest(source, offers);
  const metric = best.priceCop;
  const metricStore = fromSource ? source.store : best.store;

  tx(() => {
    db.prepare(`UPDATE products SET title = ?, image = COALESCE(?, image), source_price = ?,
      last_metric = ?, last_metric_store = ?, last_checked = ?, last_error = NULL, store_errors = ?,
      baseline_metric = COALESCE(baseline_metric, ?) WHERE id = ?`)
      .run(source.title, source.image, source.priceCop, metric, metricStore, checkedAt,
        JSON.stringify(errors), metric, id);

    // Se reemplaza la foto de tu link y de cada tienda que respondió. Las que fallaron conservan la anterior.
    const answered = [...new Set(offers.map((o) => o.store))];
    db.prepare('DELETE FROM offers WHERE product_id = ? AND is_source = 1').run(id);
    const delStore = db.prepare('DELETE FROM offers WHERE product_id = ? AND store = ? AND is_source = 0');
    for (const s of answered) delStore.run(id, s);

    const ins = db.prepare(`INSERT INTO offers
      (product_id, store, title, url, image, price_cop, rating, reviews, similarity, is_source, matched, qualified,
       image_match, reject_reason, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    ins.run(id, source.store, source.title, source.url, source.image, source.priceCop, source.rating,
      source.reviews, 1, 1, 1, 1, 0, null, checkedAt);
    for (const o of offers) {
      ins.run(id, o.store, o.title, o.url, o.image, o.priceCop, o.rating, o.reviews, o.similarity,
        0, o.matched ? 1 : 0, o.qualified ? 1 : 0, o.imageMatch ? 1 : 0, o.rejectReason, checkedAt);
    }
    // Una tienda que esta vez no respondió deja de figurar como coincidencia vigente.
    for (const storeId of Object.keys(errors)) {
      db.prepare(`UPDATE offers SET matched = 0, qualified = 0, reject_reason = ?
        WHERE product_id = ? AND store = ? AND is_source = 0`).run(`no disponible: ${errors[storeId]}`, id, storeId);
    }

    const insPrice = db.prepare('INSERT INTO prices (product_id, store, price_cop, is_source, checked_at) VALUES (?, ?, ?, ?, ?)');
    insPrice.run(id, source.store, source.priceCop, 1, checkedAt);
    // Historial: solo la publicación más barata del mismo producto en cada tienda.
    const cheapestByStore = new Map();
    for (const o of offers) {
      if (!o.matched || o.priceCop == null) continue;
      const cur = cheapestByStore.get(o.store);
      if (!cur || o.priceCop < cur.priceCop) cheapestByStore.set(o.store, o);
    }
    for (const o of cheapestByStore.values()) insPrice.run(id, o.store, o.priceCop, 0, checkedAt);
  });

  const decision = decideAlert({
    metric,
    target: product.target_price,
    lastAlerted: product.last_alerted_price,
    baseline: product.baseline_metric, // null en la primera revisión: no avisa, solo fija la referencia
  });

  if (decision.send) {
    const fresh = getProduct(id);
    try {
      await sendPriceAlert({
        product: fresh,
        best: { ...best, url: best.url || source.url },
        fromSource,
        reason: decision.reason,
        reference: decision.reference,
        storeName: storeById(metricStore)?.name || metricStore,
      });
      db.prepare('UPDATE products SET last_alerted_price = ? WHERE id = ?').run(metric, id);
    } catch (e) {
      console.error(`[producto ${id}] no se pudo enviar el correo: ${e.message}`);
    }
  }
}
